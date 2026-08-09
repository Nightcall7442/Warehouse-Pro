import { z } from "zod";
import { createRouter, fieldSalesQuery, supervisorQuery } from "./middleware";
import { orders, warehouseStock, users, shops, agentLocations, dailyPlans, orderItems, products } from "@db/schema";
import { eq, and, sql, desc, isNull , inArray } from "drizzle-orm";
import { REVENUE_ORDER_STATUSES, deliveredQty } from "./lib/order-status";
import { subDays } from "date-fns";
import { cache, CacheKeys, CacheTTL } from "./lib/cache";
import { onDay, onDate, sinceDay } from "./lib/date-range";

type DashboardKpis = {
  todayOrders:  number;
  todayRevenue: number;
  activeAgents: number;
  totalStock:   number;
  customerDebt: number;
  grossMargin:  number;
};

export const dashboardRouter = createRouter({
  kpis: supervisorQuery.query(async ({ ctx }) => {
    const tenantId = ctx.tenant.id;
    const cacheKey = CacheKeys.dashboardKpis(tenantId);
    const cached = cache.get<DashboardKpis>(cacheKey);
    if (cached) return cached;

    const db       = ctx.db;
    const today    = new Date().toISOString().split("T")[0];

    const [todaysOrders, todaysRevenue, activeAgents, totalStock, customerDebt, revenueResult, costResult] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), onDay(orders.createdAt, today), isNull(orders.deletedAt))),
      db.select({ total: sql<string>`COALESCE(SUM(${orders.total}), 0)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), onDay(orders.createdAt, today), inArray(orders.status, REVENUE_ORDER_STATUSES), isNull(orders.deletedAt))),
      db.select({ count: sql<number>`count(*)` }).from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.role, "agent"), eq(users.status, "active"))),
      db.select({ total: sql<string>`COALESCE(SUM(${warehouseStock.currentStock}), 0)` }).from(warehouseStock)
        .where(eq(warehouseStock.tenantId, tenantId)),
      db.select({ total: sql<string>`COALESCE(SUM(${shops.debt}), 0)` }).from(shops)
        .where(eq(shops.tenantId, tenantId)),
      db.select({
        totalRevenue: sql<string>`COALESCE(SUM(CASE WHEN ${orders.status} = 'delivered' THEN ${orders.total} ELSE 0 END), 0)`,
      }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt))),
      db.select({
        // Себестоимость берётся из строки заказа и по доставленному количеству.
        //
        // products.costPrice — цена товара СЕГОДНЯ, а не в момент продажи:
        // подняли закупку — и вся прошлая прибыль пересчиталась задним числом.
        // В строке заказа себестоимость зафиксирована при оформлении.
        //
        // Количество — доставленное: при частичной доставке выручка
        // уменьшается, и себестоимость обязана уменьшиться вместе с ней.
        totalCost: sql<string>`COALESCE(SUM(CASE WHEN ${orders.status} = 'delivered' THEN ${deliveredQty()} * ${orderItems.costPrice} ELSE 0 END), 0)`,
      }).from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .innerJoin(products, eq(orderItems.productId, products.id))
        .where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt))),
    ]);

    const totalRev = Number(revenueResult[0]?.totalRevenue ?? 0);
    const totalCostVal = Number(costResult[0]?.totalCost ?? 0);
    const grossMargin = totalRev > 0 ? ((totalRev - totalCostVal) / totalRev) * 100 : 0;

    const result: DashboardKpis = {
      todayOrders:  Number(todaysOrders[0]?.count ?? 0),
      todayRevenue: Number(todaysRevenue[0]?.total ?? 0),
      activeAgents: Number(activeAgents[0]?.count ?? 0),
      totalStock:   Number(totalStock[0]?.total ?? 0),
      customerDebt: Number(customerDebt[0]?.total ?? 0),
      grossMargin:  Math.round(grossMargin * 10) / 10,
    };

    cache.set(cacheKey, result, CacheTTL.kpis);
    return result;
  }),

  trends: supervisorQuery
    .input(z.object({ range: z.enum(["7d", "30d", "month"]) }))
    .query(async ({ input, ctx }) => {
      const db        = ctx.db;
      const tenantId  = ctx.tenant.id;
      const days      = input.range === "7d" ? 7 : 30;
      const startDate = subDays(new Date(), days).toISOString().split("T")[0];

      return db.select({
        date:       sql<string>`DATE(${orders.createdAt})`,
        orderCount: sql<number>`count(*)`,
        revenue:    sql<string>`COALESCE(SUM(CASE WHEN ${orders.status} = 'delivered' THEN ${orders.total} ELSE 0 END), 0)`,
      })
        .from(orders)
        .where(and(eq(orders.tenantId, tenantId), sinceDay(orders.createdAt, startDate), isNull(orders.deletedAt)))
        .groupBy(sql`DATE(${orders.createdAt})`).orderBy(sql`DATE(${orders.createdAt})`);
    }),

  statusBreakdown: supervisorQuery.query(async ({ ctx }) => {
    return ctx.db.select({ status: orders.status, count: sql<number>`count(*)` })
      .from(orders).where(and(eq(orders.tenantId, ctx.tenant.id), isNull(orders.deletedAt))).groupBy(orders.status);
  }),

  activity: supervisorQuery.query(async ({ ctx }) => {
    return ctx.db.select({
      id: orders.id, orderNumber: orders.orderNumber, status: orders.status,
      total: orders.total, createdAt: orders.createdAt, shopName: shops.name, agentName: users.name,
    })
      .from(orders)
      .leftJoin(shops, eq(orders.shopId, shops.id))
      .leftJoin(users, eq(orders.agentId, users.id))
      .where(and(eq(orders.tenantId, ctx.tenant.id), isNull(orders.deletedAt)))
      .orderBy(desc(orders.createdAt)).limit(10);
  }),

  agentDashboard: fieldSalesQuery.query(async ({ ctx }) => {
    const db       = ctx.db;
    const tenantId = ctx.tenant.id;
    const userId   = ctx.user.id;
    const today    = new Date().toISOString().split("T")[0];

    const [agentOrders, assignedShops] = await Promise.all([
      db.select({ count: sql<number>`count(*)`, total: sql<string>`COALESCE(SUM(${orders.total}), 0)` })
        .from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.agentId, userId), onDay(orders.createdAt, today), isNull(orders.deletedAt))),
      db.select({ count: sql<number>`count(*)` }).from(shops)
        .where(and(eq(shops.tenantId, tenantId), eq(shops.agentId, userId))),
    ]);

    return {
      todayOrders:   Number(agentOrders[0]?.count ?? 0),
      todayRevenue:  Number(agentOrders[0]?.total ?? 0),
      assignedShops: Number(assignedShops[0]?.count ?? 0),
    };
  }),

  supervisorDashboard: supervisorQuery.query(async ({ ctx }) => {
    const db       = ctx.db;
    const tenantId = ctx.tenant.id;
    const today    = new Date().toISOString().split("T")[0];
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const [todaysOrders, todaysRevenue, activeAgents, onlineAgents, pendingPlans] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), onDay(orders.createdAt, today), isNull(orders.deletedAt))),
      db.select({ total: sql<string>`COALESCE(SUM(${orders.total}), 0)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), onDay(orders.createdAt, today), inArray(orders.status, REVENUE_ORDER_STATUSES), isNull(orders.deletedAt))),
      db.select({ count: sql<number>`count(*)` }).from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.role, "agent"), eq(users.status, "active"))),
      db.select({ count: sql<number>`count(distinct ${agentLocations.agentId})` }).from(agentLocations)
        .where(and(eq(agentLocations.tenantId, tenantId), sql`${agentLocations.createdAt} >= ${tenMinAgo}`)),
      db.select({ count: sql<number>`count(*)` }).from(dailyPlans)
        // plan_date is a DATE column — DATE() around it is a no-op that still blocks idx_plans_tenant_date
        .where(and(eq(dailyPlans.tenantId, tenantId), onDate(dailyPlans.planDate, today), eq(dailyPlans.status, "planned"))),
    ]);

    return {
      todayOrders:   Number(todaysOrders[0]?.count ?? 0),
      todayRevenue:  Number(todaysRevenue[0]?.total ?? 0),
      activeAgents:  Number(activeAgents[0]?.count ?? 0),
      onlineAgents:  Number(onlineAgents[0]?.count ?? 0),
      pendingPlans:  Number(pendingPlans[0]?.count ?? 0),
    };
  }),

  /** Revenue trend for sparkline — last N days daily revenue */
  revenueTrend: fieldSalesQuery
    .input(z.object({ days: z.number().default(7) }).optional())
    .query(async ({ input, ctx }) => {
      const db = ctx.db;
      const tenantId = ctx.tenant.id;
      const days = input?.days ?? 7;
      const startDate = subDays(new Date(), days).toISOString().split("T")[0];

      const rows = await db.select({
        date: sql<string>`DATE(${orders.createdAt})`,
        revenue: sql<string>`COALESCE(SUM(CASE WHEN ${orders.status} = 'delivered' THEN ${orders.total} ELSE 0 END), 0)`,
      })
        .from(orders)
        .where(and(
          eq(orders.tenantId, tenantId),
          sinceDay(orders.createdAt, startDate),
          isNull(orders.deletedAt),
          // This feeds the sparkline on the agent's own home screen, and the
          // guard admits agents. Unscoped, every agent's phone drew the
          // company's daily revenue.
          ...(["ceo", "operator", "supervisor", "superadmin"].includes(ctx.user.role)
            ? []
            : [eq(orders.agentId, ctx.user.id)]),
        ))
        .groupBy(sql`DATE(${orders.createdAt})`)
        .orderBy(sql`DATE(${orders.createdAt})`);

      // Fill missing days with 0
      const result: number[] = [];
      for (let i = 0; i < days; i++) {
        const d = subDays(new Date(), days - 1 - i).toISOString().split("T")[0];
        const found = rows.find(r => r.date === d);
        result.push(Number(found?.revenue ?? 0));
      }
      return result;
    }),
});