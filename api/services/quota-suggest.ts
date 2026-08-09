import { eq, and, gte, lte, sql , inArray, isNull } from "drizzle-orm";
import { REVENUE_ORDER_STATUSES } from "../lib/order-status";
import { orders, dailyPlans, users } from "@db/schema";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

export interface QuotaSuggestion {
  userId: number;
  userName: string;
  suggestedRevenue: number;
  suggestedOrderCount: number;
  suggestedVisitPct: number;
  basedOn: {
    avgMonthlyRevenue: number;
    avgMonthlyOrders: number;
    avgVisitCompletion: number;
    monthsOfData: number;
  };
}

function calcGrowthFactor(monthlyData: { total: number }[]): number {
  if (monthlyData.length < 2) return 1.10;
  const last = monthlyData[monthlyData.length - 1].total;
  const prev = monthlyData[monthlyData.length - 2].total;
  if (prev === 0) return 1.15;
  const growth = (last - prev) / prev;
  if (growth > 0.20) return 1.20;
  if (growth < 0.10) return 1.10;
  return 1 + growth;
}

export async function suggestQuotas(
  db: Db,
  tenantId: number,
  targetMonth: string,
): Promise<QuotaSuggestion[]> {
  const end = new Date(targetMonth);
  const start = new Date(end);
  start.setMonth(start.getMonth() - 3);
  const startStr = start.toISOString().split("T")[0];
  const endStr = new Date(end.getTime() - 86_400_000).toISOString().split("T")[0];
  const periodStart = new Date(`${startStr}T00:00:00Z`);
  const periodEnd = new Date(`${endStr}T23:59:59Z`);

  const agents = await db.select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.role, "agent"), eq(users.status, "active")));

  const suggestions: QuotaSuggestion[] = [];

  for (const agent of agents) {
    const monthlyRevenue = await db.select({
      month: sql<string>`DATE_FORMAT(${orders.createdAt}, '%Y-%m-01')`,
      total: sql<string>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL(14,2))), 0)`,
    }).from(orders)
      .where(and(
        eq(orders.tenantId, tenantId), isNull(orders.deletedAt),
        eq(orders.agentId, agent.id),
        inArray(orders.status, REVENUE_ORDER_STATUSES),
        gte(orders.createdAt, periodStart),
        lte(orders.createdAt, periodEnd),
      ))
      .groupBy(sql`DATE_FORMAT(${orders.createdAt}, '%Y-%m-01')`);

    const monthlyOrders = await db.select({
      month: sql<string>`DATE_FORMAT(${orders.createdAt}, '%Y-%m-01')`,
      count: sql<string>`COUNT(*)`,
    }).from(orders)
      .where(and(
        eq(orders.tenantId, tenantId), isNull(orders.deletedAt),
        eq(orders.agentId, agent.id),
        inArray(orders.status, REVENUE_ORDER_STATUSES),
        gte(orders.createdAt, periodStart),
        lte(orders.createdAt, periodEnd),
      ))
      .groupBy(sql`DATE_FORMAT(${orders.createdAt}, '%Y-%m-01')`);

    const monthlyVisits = await db.select({
      month: sql<string>`DATE_FORMAT(${dailyPlans.planDate}, '%Y-%m-01')`,
      total: sql<string>`COUNT(*)`,
      completed: sql<string>`SUM(CASE WHEN ${dailyPlans.status} = 'visited' THEN 1 ELSE 0 END)`,
    }).from(dailyPlans)
      .where(and(
        eq(dailyPlans.tenantId, tenantId),
        eq(dailyPlans.agentId, agent.id),
        gte(dailyPlans.planDate, periodStart),
        lte(dailyPlans.planDate, periodEnd),
      ))
      .groupBy(sql`DATE_FORMAT(${dailyPlans.planDate}, '%Y-%m-01')`);

    const monthsOfData = Math.max(monthlyRevenue.length, 1);
    const avgRevenue = monthlyRevenue.reduce((s, m) => s + Number(m.total), 0) / monthsOfData;
    const avgOrders = monthlyOrders.reduce((s, m) => s + Number(m.count), 0) / monthsOfData;
    const avgVisitPct = monthlyVisits.length > 0
      ? monthlyVisits.reduce((s, m) => s + (Number(m.total) > 0 ? (Number(m.completed) / Number(m.total)) * 100 : 0), 0) / monthlyVisits.length
      : 80;

    const revenueData = monthlyRevenue.map(m => ({ total: Number(m.total) }));
    const growthFactor = calcGrowthFactor(revenueData);

    suggestions.push({
      userId: agent.id,
      userName: agent.name,
      suggestedRevenue: Math.round(avgRevenue * growthFactor),
      suggestedOrderCount: Math.round(avgOrders * growthFactor),
      suggestedVisitPct: Math.min(100, Math.round(avgVisitPct * (growthFactor * 0.5 + 0.5))),
      basedOn: {
        avgMonthlyRevenue: Math.round(avgRevenue),
        avgMonthlyOrders: Math.round(avgOrders),
        avgVisitCompletion: Math.round(avgVisitPct * 10) / 10,
        monthsOfData,
      },
    });
  }

  return suggestions;
}
