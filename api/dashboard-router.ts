import { z } from "zod";
import { createRouter, operatorQuery, fieldSalesQuery, supervisorQuery } from "./middleware";
import { orders, warehouseStock, users, shops, agentLocations, dailyPlans, orderItems, products } from "@db/schema";
import { eq, and, sql, desc, isNull } from "drizzle-orm";
import { subDays } from "date-fns";
import { cache, CacheKeys, CacheTTL } from "./lib/cache";

export const dashboardRouter = createRouter({
  kpis: operatorQuery.query(async ({ ctx }) => {
    const tenantId = ctx.tenant.id;
    const cacheKey = CacheKeys.dashboardKpis(tenantId);
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const db       = ctx.db;
    const today    = new Date().toISOString().split("T")[0];

    const [todaysOrders, todaysRevenue, activeAgents, totalStock, customerDebt, revenueResult, costResult] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), sql`DATE(${orders.createdAt}) = ${today}`, isNull(orders.deletedAt))),
      db.select({ total: sql<string>`COALESCE(SUM(${orders.total}), 0)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), sql`DATE(${orders.createdAt}) = ${today}`, eq(orders.status, "completed"), isNull(orders.deletedAt))),
      db.select({ count: sql<number>`count(*)` }).from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.role, "agent"), eq(users.status, "active"))),
      db.select({ total: sql<string>`COALESCE(SUM(${warehouseStock.currentStock}), 0)` }).from(warehouseStock)
        .where(eq(warehouseStock.tenantId, tenantId)),
      db.select({ total: sql<string>`COALESCE(SUM(${shops.debt}), 0)` }).from(shops)
        .where(eq(shops.tenantId, tenantId)),
      db.select({
        totalRevenue: sql<string>`COALESCE(SUM(CASE WHEN ${orders.status} = 'completed' THEN ${orders.total} ELSE 0 END), 0)`,
      }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt))),
      db.select({
        totalCost: sql<string>`COALESCE(SUM(CASE WHEN ${orders.status} = 'completed' THEN ${orderItems.quantity} * ${products.costPrice} ELSE 0 END), 0)`,
      }).from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .innerJoin(products, eq(orderItems.productId, products.id))
        .where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt))),
    ]);

    const totalRev = Number(revenueResult[0]?.totalRevenue ?? 0);
    const totalCostVal = Number(costResult[0]?.totalCost ?? 0);
    const grossMargin = totalRev > 0 ? ((totalRev - totalCostVal) / totalRev) * 100 : 0;

    const result = {
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

  trends: operatorQuery
    .input(z.object({ range: z.enum(["7d", "30d", "month"]) }))
    .query(async ({ input, ctx }) => {
      const db        = ctx.db;
      const tenantId  = ctx.tenant.id;
      const days      = input.range === "7d" ? 7 : 30;
      const startDate = subDays(new Date(), days).toISOString().split("T")[0];

      return db.select({
        date:       sql<string>`DATE(${orders.createdAt})`,
        orderCount: sql<number>`count(*)`,
        revenue:    sql<string>`COALESCE(SUM(CASE WHEN ${orders.status} = 'completed' THEN ${orders.total} ELSE 0 END), 0)`,
      })
        .from(orders)
        .where(and(eq(orders.tenantId, tenantId), sql`DATE(${orders.createdAt}) >= ${startDate}`, isNull(orders.deletedAt)))
        .groupBy(sql`DATE(${orders.createdAt})`).orderBy(sql`DATE(${orders.createdAt})`);
    }),

  statusBreakdown: operatorQuery.query(async ({ ctx }) => {
    return ctx.db.select({ status: orders.status, count: sql<number>`count(*)` })
      .from(orders).where(and(eq(orders.tenantId, ctx.tenant.id), isNull(orders.deletedAt))).groupBy(orders.status);
  }),

  activity: operatorQuery.query(async ({ ctx }) => {
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
        .from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.agentId, userId), sql`DATE(${orders.createdAt}) = ${today}`, isNull(orders.deletedAt))),
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
        .where(and(eq(orders.tenantId, tenantId), sql`DATE(${orders.createdAt}) = ${today}`, isNull(orders.deletedAt))),
      db.select({ total: sql<string>`COALESCE(SUM(${orders.total}), 0)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), sql`DATE(${orders.createdAt}) = ${today}`, eq(orders.status, "completed"), isNull(orders.deletedAt))),
      db.select({ count: sql<number>`count(*)` }).from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.role, "agent"), eq(users.status, "active"))),
      db.select({ count: sql<number>`count(distinct ${agentLocations.agentId})` }).from(agentLocations)
        .where(and(eq(agentLocations.tenantId, tenantId), sql`${agentLocations.createdAt} >= ${tenMinAgo}`)),
      db.select({ count: sql<number>`count(*)` }).from(dailyPlans)
        .where(and(eq(dailyPlans.tenantId, tenantId), sql`DATE(${dailyPlans.planDate}) = ${today}`, eq(dailyPlans.status, "planned"))),
    ]);

    return {
      todayOrders:   Number(todaysOrders[0]?.count ?? 0),
      todayRevenue:  Number(todaysRevenue[0]?.total ?? 0),
      activeAgents:  Number(activeAgents[0]?.count ?? 0),
      onlineAgents:  Number(onlineAgents[0]?.count ?? 0),
      pendingPlans:  Number(pendingPlans[0]?.count ?? 0),
    };
  }),
});