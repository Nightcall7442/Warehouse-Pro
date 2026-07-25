import { z } from "zod";
import { createRouter, fieldSalesQuery, supervisorQuery, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { calculateAgentKpi, calculateAllAgentsKpi, calculateSalary } from "./services/kpi";

export const kpiRouter = createRouter({
  /** Agent's own KPI dashboard */
  agentKpi: fieldSalesQuery
    .input(z.object({
      period: z.enum(["week", "month", "quarter"]).default("month"),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const period = input?.period ?? "month";
      const { periodStart, periodEnd } = getPeriod(period);

      return calculateAgentKpi(db, ctx.user.id, ctx.tenant.id, periodStart, periodEnd);
    }),

  /** Supervisor: all agents' KPIs */
  supervisorKpi: supervisorQuery
    .input(z.object({
      period: z.enum(["week", "month", "quarter"]).default("month"),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const period = input?.period ?? "month";
      const { periodStart, periodEnd } = getPeriod(period);

      return calculateAllAgentsKpi(db, ctx.tenant.id, periodStart, periodEnd);
    }),

  /** Agent's salary calculation */
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

  /** Supervisor: all agents' salaries */
  salaryReport: supervisorQuery
    .input(z.object({
      period: z.enum(["week", "month", "quarter"]).default("month"),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const period = input?.period ?? "month";
      const { periodStart, periodEnd } = getPeriod(period);

      // Get all agents
      const { users } = await import("@db/schema");
      const { eq: eqFn } = await import("drizzle-orm");
      const agentsList = await db.select({ id: users.id, name: users.name })
        .from(users)
        .where(eqFn(users.tenantId, ctx.tenant.id) && eqFn(users.role, "agent") && eqFn(users.status, "active"));

      const salaries = [];
      for (const agent of agentsList) {
        const salary = await calculateSalary(db, agent.id, ctx.tenant.id, periodStart, periodEnd);
        salary.agentName = agent.name;
        salaries.push(salary);
      }

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
    // month
    periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  return { periodStart, periodEnd };
}
