import { z } from "zod";
import { createRouter, fieldSalesQuery, supervisorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { calculateAgentKpi, calculateAllAgentsKpi, calculateSalary, getAgentList } from "./services/kpi";
import { cache, CacheTTL } from "./lib/cache";
import { shops, users } from "@db/schema";
import { eq, and, sql } from "drizzle-orm";

export const kpiRouter = createRouter({
  agentKpi: fieldSalesQuery
    .input(z.object({
      period: z.enum(["week", "month", "quarter"]).default("month"),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const period = input?.period ?? "month";
      const { periodStart, periodEnd } = getPeriod(period);
      const cacheKey = `kpi:agent:${ctx.tenant.id}:${ctx.user.id}:${period}`;

      const cached = cache.get(cacheKey);
      if (cached) return cached;

      const result = await calculateAgentKpi(db, ctx.user.id, ctx.tenant.id, periodStart, periodEnd);
      cache.set(cacheKey, result, CacheTTL.kpis);
      return result;
    }),

  supervisorKpi: supervisorQuery
    .input(z.object({
      period: z.enum(["week", "month", "quarter"]).default("month"),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const period = input?.period ?? "month";
      const { periodStart, periodEnd } = getPeriod(period);
      const cacheKey = `kpi:supervisor:${ctx.tenant.id}:${period}`;

      const cached = cache.get(cacheKey);
      if (cached) return cached;

      const result = await calculateAllAgentsKpi(db, ctx.tenant.id, periodStart, periodEnd);
      cache.set(cacheKey, result, CacheTTL.kpis);
      return result;
    }),

  agentList: supervisorQuery
    .input(z.object({
      period: z.enum(["week", "month", "quarter"]).default("month"),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const period = input?.period ?? "month";
      const { periodStart, periodEnd } = getPeriod(period);

      return getAgentList(db, ctx.tenant.id, periodStart, periodEnd);
    }),

  agentDetail: supervisorQuery
    .input(z.object({
      agentId: z.number().int().positive(),
      period: z.enum(["week", "month", "quarter"]).default("month"),
    }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const { periodStart, periodEnd } = getPeriod(input.period);

      return calculateAgentKpi(db, input.agentId, ctx.tenant.id, periodStart, periodEnd);
    }),

  territoryKpi: supervisorQuery
    .input(z.object({
      territoryId: z.number().int().positive(),
      period: z.enum(["week", "month", "quarter"]).default("month"),
    }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const { periodStart, periodEnd } = getPeriod(input.period);

      // Get unique agents in this territory
      const territoryAgentRows = await db.select({ agentId: shops.agentId })
        .from(shops)
        .where(and(
          eq(shops.tenantId, ctx.tenant.id),
          eq(shops.territoryId, input.territoryId),
          eq(shops.status, "active"),
          sql`${shops.agentId} IS NOT NULL`,
        ))
        .groupBy(shops.agentId);

      const agentIds = territoryAgentRows.map(r => r.agentId).filter(Boolean) as number[];

      if (agentIds.length === 0) {
        return {
          territoryId: input.territoryId,
          agentCount: 0,
          avgScore: 0,
          totalRevenue: 0,
          totalOrders: 0,
          totalVisits: 0,
          agents: [],
        };
      }

      const allKpi = await Promise.all(
        agentIds.map(id => calculateAgentKpi(db, id, ctx.tenant.id, periodStart, periodEnd))
      );

      const totalRevenue = allKpi.reduce((s, k) => s + k.revenue, 0);
      const totalOrders = allKpi.reduce((s, k) => s + k.orderCount, 0);
      const totalVisits = allKpi.reduce((s, k) => s + k.visitedPlans, 0);
      const avgScore = allKpi.length > 0 ? Math.round(allKpi.reduce((s, k) => s + k.kpiScore, 0) / allKpi.length) : 0;

      return {
        territoryId: input.territoryId,
        agentCount: allKpi.length,
        avgScore,
        totalRevenue,
        totalOrders,
        totalVisits,
        agents: allKpi.sort((a, b) => b.kpiScore - a.kpiScore),
      };
    }),

  salary: fieldSalesQuery
    .input(z.object({
      period: z.enum(["week", "month", "quarter"]).default("month"),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const period = input?.period ?? "month";
      const { periodStart, periodEnd } = getPeriod(period);

      return calculateSalary(db, ctx.user.id, ctx.tenant.id, periodStart, periodEnd);
    }),

  salaryReport: supervisorQuery
    .input(z.object({
      period: z.enum(["week", "month", "quarter"]).default("month"),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const period = input?.period ?? "month";
      const { periodStart, periodEnd } = getPeriod(period);

      const agentsList = await db.select({ id: users.id, name: users.name })
        .from(users)
        .where(and(eq(users.tenantId, ctx.tenant.id), eq(users.role, "agent"), eq(users.status, "active")));

      const kpis = await calculateAllAgentsKpi(db, ctx.tenant.id, periodStart, periodEnd);

      const kpiMap = new Map(kpis.map(k => [k.agentId, k]));

      const salaries = await Promise.all(
        agentsList.map(agent =>
          calculateSalary(db, agent.id, ctx.tenant.id, periodStart, periodEnd, kpiMap.get(agent.id))
            .then(salary => { salary.agentName = agent.name; return salary; })
        )
      );

      return salaries;
    }),
});

function getPeriod(period: string): { periodStart: Date; periodEnd: Date } {
  const now = new Date();
  const periodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  let periodStart: Date;
  if (period === "week") {
    periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  } else if (period === "quarter") {
    const quarter = Math.floor(now.getMonth() / 3);
    periodStart = new Date(now.getFullYear(), quarter * 3, 1);
  } else {
    periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  return { periodStart, periodEnd };
}
