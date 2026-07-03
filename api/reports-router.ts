import { z } from "zod";
import { createRouter, reportsQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { orders, users, dailyPlans, agentLocations, subscriptions } from "@db/schema";
import { eq, and, sql, gte, desc } from "drizzle-orm";
import { subDays, format } from "date-fns";

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
        .where(and(eq(dailyPlans.tenantId, tenantId), sql`DATE(${dailyPlans.planDate}) = ${today}`, eq(dailyPlans.status, "visited"))),

      db.select({ count: sql<number>`count(*)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), gte(orders.createdAt, new Date(d30ago)))),

      db.select({ total: sql<string>`COALESCE(SUM(${orders.total}), 0)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), eq(orders.status, "completed"), gte(orders.createdAt, new Date(d30ago)))),

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
          .where(and(eq(orders.tenantId, tenantId), gte(orders.createdAt, since)))
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

      return db.select({
        agentId:     users.id,
        agentName:   users.name,
        visits:      sql<number>`COALESCE(COUNT(DISTINCT ${dailyPlans.id}), 0)`,
        orders:      sql<number>`COALESCE(COUNT(DISTINCT ${orders.id}), 0)`,
        revenue:     sql<string>`COALESCE(SUM(${orders.total}), 0)`,
      })
        .from(users)
        .leftJoin(dailyPlans, and(
          eq(dailyPlans.agentId, users.id),
          eq(dailyPlans.status, "visited"),
          gte(dailyPlans.planDate, since),
        ))
        .leftJoin(orders, and(
          eq(orders.agentId, users.id),
          gte(orders.createdAt, since),
        ))
        .where(and(eq(users.tenantId, tenantId), eq(users.role, "agent")))
        .groupBy(users.id)
        .orderBy(desc(sql`COALESCE(COUNT(DISTINCT ${dailyPlans.id}), 0)`))
        .limit(10);
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
      .where(and(eq(dailyPlans.tenantId, tenantId), sql`DATE(${dailyPlans.planDate}) = ${today}`))
      .groupBy(dailyPlans.agentId);

    return rows.map(r => ({
      ...r,
      pct: r.total > 0 ? Math.round((Number(r.visited) / Number(r.total)) * 100) : 0,
    }));
  }),
});
