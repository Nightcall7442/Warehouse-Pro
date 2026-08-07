import { z } from "zod";
import { createRouter, reportsQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { orders, users, dailyPlans, agentLocations, subscriptions, shops, products, stockMovements } from "@db/schema";
import { eq, and, sql, gte, desc , inArray, isNull } from "drizzle-orm";
import { REVENUE_ORDER_STATUSES } from "./lib/order-status";
import { subDays, format } from "date-fns";
import { onDate } from "./lib/date-range";

export const reportsRouter = createRouter({
  /** KPI summary for the Reports page */
  getDashboardSummary: reportsQuery.query(async ({ ctx }) => {
    const db       = getDb();
    const tenantId = ctx.tenant.id;
    const now      = new Date();
    const today    = format(now, "yyyy-MM-dd");
    const d30ago   = subDays(now, 30).toISOString();

    const [
      agentCount, visitsToday, ordersMonth,
      revenueMonth, sub,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.role, "agent"), eq(users.status, "active"))),

      db.select({ count: sql<number>`count(*)` }).from(dailyPlans)
        .where(and(eq(dailyPlans.tenantId, tenantId), onDate(dailyPlans.planDate, today), eq(dailyPlans.status, "visited"))),

      db.select({ count: sql<number>`count(*)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt), inArray(orders.status, REVENUE_ORDER_STATUSES), gte(orders.createdAt, new Date(d30ago)))),

      db.select({ total: sql<string>`COALESCE(SUM(${orders.total}), 0)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt), inArray(orders.status, REVENUE_ORDER_STATUSES), gte(orders.createdAt, new Date(d30ago)))),

      db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1),
    ]);

    // Active agents today (those with location pings in last 2h)
    const activeNow = await db.select({ agentId: agentLocations.agentId })
      .from(agentLocations)
      .where(and(
        eq(agentLocations.tenantId, tenantId),
        gte(agentLocations.createdAt, new Date(now.getTime() - 2 * 3600_000)),
      ))
      .groupBy(agentLocations.agentId);

    const agentTotal = Number(agentCount[0]?.count ?? 0);
    const ordersM    = Number(ordersMonth[0]?.count ?? 0);

    return {
      totalAgents:    agentTotal,
      activeNow:      activeNow.length,
      visitsToday:    Number(visitsToday[0]?.count ?? 0),
      ordersMonth:    ordersM,
      revenueMonth:   Number(revenueMonth[0]?.total ?? 0),
      avgOrdersPerAgent: agentTotal > 0 ? +(ordersM / agentTotal).toFixed(1) : 0,
      subscription:   sub[0] ?? null,
    };
  }),

  /** Daily visit/order chart for a date range */
  getVisitChart: reportsQuery
    .input(z.object({ days: z.number().default(30) }))
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const since    = subDays(new Date(), input.days);

      const [visits, ordersData] = await Promise.all([
        db.select({
          date:  sql<string>`DATE(${dailyPlans.planDate})`,
          count: sql<number>`count(*)`,
        })
          .from(dailyPlans)
          .where(and(eq(dailyPlans.tenantId, tenantId), gte(dailyPlans.planDate, since)))
          .groupBy(sql`DATE(${dailyPlans.planDate})`)
          .orderBy(sql`DATE(${dailyPlans.planDate})`),

        db.select({
          date:    sql<string>`DATE(${orders.createdAt})`,
          count:   sql<number>`count(*)`,
          revenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
        })
          .from(orders)
          .where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt), gte(orders.createdAt, since)))
          .groupBy(sql`DATE(${orders.createdAt})`)
          .orderBy(sql`DATE(${orders.createdAt})`),
      ]);

      // Merge by date
      const dateMap: Record<string, { date: string; visits: number; orders: number; revenue: number }> = {};
      visits.forEach(v => {
        dateMap[v.date] = { date: v.date, visits: Number(v.count), orders: 0, revenue: 0 };
      });
      ordersData.forEach(o => {
        if (!dateMap[o.date]) dateMap[o.date] = { date: o.date, visits: 0, orders: 0, revenue: 0 };
        dateMap[o.date].orders  = Number(o.count);
        dateMap[o.date].revenue = Number(o.revenue);
      });

      return Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
    }),

  /** Top-10 agents by visits/orders */
  getAgentPerformance: reportsQuery
    .input(z.object({ days: z.number().default(30) }))
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const since    = subDays(new Date(), input.days);

      // Визиты и деньги считаются РАЗНЫМИ запросами и сшиваются по агенту.
      //
      // Одним запросом было нельзя. Присоединение daily_plans размножает строку
      // заказа по числу визитов, и SUM(orders.total) поверх такого набора
      // складывает каждый заказ столько раз, сколько у агента отмечено визитов.
      // visits и orders от этого защищены через COUNT(DISTINCT), а revenue —
      // нет: агент с 22 визитами и 5 заказами на 13 221 250 показывался как
      // 290 867 500, ровно в 22 раза больше. Ошибка росла вместе с
      // прилежностью — чем добросовестнее агент отмечал визиты, тем сильнее
      // раздувалась его выручка, и это же число уходило в выгрузку отчёта.
      const visitRows = await db.select({
        agentId:   users.id,
        agentName: users.name,
        visits:    sql<number>`COALESCE(COUNT(DISTINCT ${dailyPlans.id}), 0)`,
      })
        .from(users)
        .leftJoin(dailyPlans, and(
          eq(dailyPlans.agentId, users.id),
          eq(dailyPlans.status, "visited"),
          gte(dailyPlans.planDate, since),
        ))
        .where(and(eq(users.tenantId, tenantId), eq(users.role, "agent")))
        .groupBy(users.id)
        .orderBy(desc(sql`COALESCE(COUNT(DISTINCT ${dailyPlans.id}), 0)`))
        .limit(10);

      if (visitRows.length === 0) return [];

      const moneyRows = await db.select({
        agentId: orders.agentId,
        orders:  sql<number>`COUNT(DISTINCT ${orders.id})`,
        revenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
      })
        .from(orders)
        .where(and(
          eq(orders.tenantId, tenantId),
          isNull(orders.deletedAt),
          gte(orders.createdAt, since),
          inArray(orders.agentId, visitRows.map(r => r.agentId)),
        ))
        .groupBy(orders.agentId);

      const moneyByAgent = new Map(moneyRows.map(r => [r.agentId, r]));

      return visitRows.map(r => ({
        agentId:   r.agentId,
        agentName: r.agentName,
        visits:    r.visits,
        orders:    Number(moneyByAgent.get(r.agentId)?.orders ?? 0),
        revenue:   moneyByAgent.get(r.agentId)?.revenue ?? "0",
      }));
    }),

  /** Today's plan completion per agent */
  getPlanCompletion: reportsQuery.query(async ({ ctx }) => {
    const db       = getDb();
    const tenantId = ctx.tenant.id;
    const today    = format(new Date(), "yyyy-MM-dd");

    const rows = await db.select({
      agentId:   dailyPlans.agentId,
      agentName: users.name,
      total:     sql<number>`count(*)`,
      visited:   sql<number>`count(CASE WHEN ${dailyPlans.status} = 'visited' THEN 1 END)`,
      planned:   sql<number>`count(CASE WHEN ${dailyPlans.status} = 'planned' THEN 1 END)`,
      skipped:   sql<number>`count(CASE WHEN ${dailyPlans.status} = 'skipped' THEN 1 END)`,
    })
      .from(dailyPlans)
      .leftJoin(users, eq(dailyPlans.agentId, users.id))
      .where(and(eq(dailyPlans.tenantId, tenantId), onDate(dailyPlans.planDate, today)))
      .groupBy(dailyPlans.agentId);

    return rows.map(r => ({
      ...r,
      pct: r.total > 0 ? Math.round((Number(r.visited) / Number(r.total)) * 100) : 0,
    }));
  }),

  /**
   * Every planned visit in a period, one row each.
   *
   * The other visit endpoints here answer "how many" — this one answers "which
   * ones", which is what somebody reaches for when a shop says nobody came.
   * Photo and note presence rather than their contents: a visit photo is a
   * multi-megabyte blob and no spreadsheet wants it, but whether one exists is
   * exactly the question being asked.
   */
  getVisitsLog: reportsQuery
    .input(z.object({
      dateFrom: z.string(),
      dateTo: z.string(),
      agentId: z.number().int().positive().optional(),
      shopId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(10000).default(1000),
    }))
    .query(async ({ input, ctx }) => {
      const conditions = [
        eq(dailyPlans.tenantId, ctx.tenant.id),
        sql`${dailyPlans.planDate} >= ${input.dateFrom}`,
        sql`${dailyPlans.planDate} <= ${input.dateTo}`,
      ];
      if (input.agentId) conditions.push(eq(dailyPlans.agentId, input.agentId));
      if (input.shopId) conditions.push(eq(dailyPlans.shopId, input.shopId));

      return getDb().select({
        planDate: dailyPlans.planDate,
        status: dailyPlans.status,
        visitedAt: dailyPlans.visitedAt,
        agentName: users.name,
        shopName: shops.name,
        shopCity: shops.city,
        shopAddress: shops.address,
        // Presence, not payload — photo_url holds a data URL up to several MB.
        hasPhoto: sql<number>`CASE WHEN ${dailyPlans.photoUrl} IS NULL OR ${dailyPlans.photoUrl} = '' THEN 0 ELSE 1 END`,
        notes: dailyPlans.notes,
      })
        .from(dailyPlans)
        .leftJoin(users, eq(dailyPlans.agentId, users.id))
        .leftJoin(shops, eq(dailyPlans.shopId, shops.id))
        .where(and(...conditions))
        .orderBy(desc(dailyPlans.planDate))
        .limit(input.limit);
    }),

  /**
   * Warehouse-wide stock movement log.
   *
   * warehouse.movements answers for one product at a time — it takes a
   * productId — so there was no way to export what moved through the warehouse
   * over a period, which is the version an accountant asks for.
   */
  getStockMovements: reportsQuery
    .input(z.object({
      dateFrom: z.string(),
      dateTo: z.string(),
      type: z.enum(["in", "out", "adjustment"]).optional(),
      limit: z.number().int().min(1).max(10000).default(1000),
    }))
    .query(async ({ input, ctx }) => {
      const conditions = [
        eq(stockMovements.tenantId, ctx.tenant.id),
        sql`${stockMovements.createdAt} >= ${input.dateFrom}`,
        sql`${stockMovements.createdAt} <= ${input.dateTo + " 23:59:59"}`,
      ];
      if (input.type) conditions.push(eq(stockMovements.type, input.type));

      return getDb().select({
        createdAt: stockMovements.createdAt,
        type: stockMovements.type,
        quantity: stockMovements.quantity,
        productName: products.name,
        productCode: products.code,
        referenceType: stockMovements.referenceType,
        referenceId: stockMovements.referenceId,
        notes: stockMovements.notes,
      })
        .from(stockMovements)
        .leftJoin(products, eq(stockMovements.productId, products.id))
        .where(and(...conditions))
        .orderBy(desc(stockMovements.createdAt))
        .limit(input.limit);
    }),
});
