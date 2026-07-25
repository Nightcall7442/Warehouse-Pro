/**
 * Agent KPI Service — calculates performance metrics from existing data.
 *
 * KPI Metrics:
 * - Visit completion rate (visited plans / total plans)
 * - Order count (period)
 * - Revenue (period)
 * - Conversion rate (orders / visits)
 * - Average order value
 * - Return rate (returns / orders)
 * - Debt collection ratio
 * - Composite KPI score (weighted)
 */

import { sql, eq, and, gte, lte } from "drizzle-orm";
import type { DrizzleInstance } from "../queries/connection";
import { orders, dailyPlans, returns, shops, salesTargets, commissions } from "@db/schema";

export interface AgentKpiData {
  agentId: number;
  agentName: string;
  period: string;

  // Visit metrics
  totalPlans: number;
  visitedPlans: number;
  skippedPlans: number;
  visitCompletionRate: number; // 0-100

  // Order metrics
  orderCount: number;
  revenue: number;
  avgOrderValue: number;

  // Return metrics
  returnCount: number;
  returnRate: number; // 0-100

  // Shop metrics
  assignedShops: number;
  totalDebt: number;
  debtCollectionRate: number; // 0-100

  // Composite score
  kpiScore: number; // 0-100
  kpiGrade: "A" | "B" | "C" | "D" | "F";
}

export interface SalaryData {
  agentId: number;
  agentName: string;
  period: string;

  // Base salary
  baseSalary: number;

  // Commission
  commissionRate: number;
  salesAmount: number;
  commissionAmount: number;

  // Bonus (from KPI achievement)
  kpiScore: number;
  bonusAmount: number;

  // Total
  totalSalary: number;

  // Breakdown
  breakdown: {
    base: number;
    commission: number;
    bonus: number;
  };
}

// KPI scoring weights (configurable)
const KPI_WEIGHTS = {
  visitCompletion: 0.30,
  revenue: 0.25,
  conversion: 0.20,
  returnRate: 0.15,
  debtCollection: 0.10,
};

// KPI grade thresholds
const GRADE_THRESHOLDS = [
  { min: 90, grade: "A" as const },
  { min: 75, grade: "B" as const },
  { min: 60, grade: "C" as const },
  { min: 40, grade: "D" as const },
  { min: 0, grade: "F" as const },
];

/**
 * Calculate all KPIs for a single agent in a given period.
 */
export async function calculateAgentKpi(
  db: DrizzleInstance,
  agentId: number,
  tenantId: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<AgentKpiData> {
  // 1. Visit metrics from dailyPlans
  const [planStats] = await db.select({
    total: sql<number>`count(*)`,
    visited: sql<number>`count(CASE WHEN status = 'visited' THEN 1 END)`,
    skipped: sql<number>`count(CASE WHEN status = 'skipped' THEN 1 END)`,
  }).from(dailyPlans)
    .where(and(
      eq(dailyPlans.tenantId, tenantId),
      eq(dailyPlans.agentId, agentId),
      gte(dailyPlans.planDate, periodStart),
      lte(dailyPlans.planDate, periodEnd),
    ));

  const totalPlans = Number(planStats?.total ?? 0);
  const visitedPlans = Number(planStats?.visited ?? 0);
  const skippedPlans = Number(planStats?.skipped ?? 0);
  const visitCompletionRate = totalPlans > 0 ? Math.round((visitedPlans / totalPlans) * 100) : 0;

  // 2. Order metrics
  const [orderStats] = await db.select({
    count: sql<number>`count(*)`,
    revenue: sql<string>`COALESCE(SUM(CAST(total AS DECIMAL(10,2))), 0)`,
  }).from(orders)
    .where(and(
      eq(orders.tenantId, tenantId),
      eq(orders.agentId, agentId),
      eq(orders.status, "completed"),
      gte(orders.createdAt, periodStart),
      lte(orders.createdAt, periodEnd),
    ));

  const orderCount = Number(orderStats?.count ?? 0);
  const revenue = Number(orderStats?.revenue ?? 0);
  const avgOrderValue = orderCount > 0 ? Math.round(revenue / orderCount) : 0;

  // 3. Return metrics
  const [returnStats] = await db.select({
    count: sql<number>`count(*)`,
  }).from(returns)
    .where(and(
      eq(returns.tenantId, tenantId),
      eq(returns.agentId, agentId),
      gte(returns.createdAt, periodStart),
      lte(returns.createdAt, periodEnd),
    ));

  const returnCount = Number(returnStats?.count ?? 0);
  const returnRate = orderCount > 0 ? Math.round((returnCount / orderCount) * 100) : 0;

  // 4. Shop metrics
  const [shopStats] = await db.select({
    count: sql<number>`count(*)`,
    totalDebt: sql<string>`COALESCE(SUM(CAST(debt AS DECIMAL(10,2))), 0)`,
  }).from(shops)
    .where(and(
      eq(shops.tenantId, tenantId),
      eq(shops.agentId, agentId),
      eq(shops.status, "active"),
    ));

  const assignedShops = Number(shopStats?.count ?? 0);
  const totalDebt = Number(shopStats?.totalDebt ?? 0);

  // Debt collection rate: (revenue / (revenue + debt)) * 100
  const totalOwed = revenue + totalDebt;
  const debtCollectionRate = totalOwed > 0 ? Math.round((revenue / totalOwed) * 100) : 100;

  // 5. Composite KPI score
  const kpiScore = calculateCompositeScore({
    visitCompletion: visitCompletionRate,
    revenue,
    conversion: orderCount > 0 && totalPlans > 0 ? Math.round((orderCount / totalPlans) * 100) : 0,
    returnRate: 100 - returnRate, // Invert: lower return rate = higher score
    debtCollection: debtCollectionRate,
  });

  const kpiGrade = getGrade(kpiScore);

  // Get agent name
  const [agent] = await db.select({ name: sql<string>`name` })
    .from(await import("@db/schema").then(m => m.users))
    .where(eq((await import("@db/schema")).users.id, agentId))
    .limit(1);

  const periodLabel = `${periodStart.toISOString().slice(0, 10)} — ${periodEnd.toISOString().slice(0, 10)}`;

  return {
    agentId,
    agentName: String(agent?.name ?? "Agent"),
    period: periodLabel,
    totalPlans,
    visitedPlans,
    skippedPlans,
    visitCompletionRate,
    orderCount,
    revenue,
    avgOrderValue,
    returnCount,
    returnRate,
    assignedShops,
    totalDebt,
    debtCollectionRate,
    kpiScore,
    kpiGrade,
  };
}

/**
 * Calculate KPIs for ALL agents in a tenant (supervisor view).
 */
export async function calculateAllAgentsKpi(
  db: DrizzleInstance,
  tenantId: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<AgentKpiData[]> {
  // Get all agents in tenant
  const agentsList = await db.select({
    id: sql<number>`id`,
    name: sql<string>`name`,
  }).from((await import("@db/schema")).users)
    .where(and(
      eq((await import("@db/schema")).users.tenantId, tenantId),
      eq((await import("@db/schema")).users.role, "agent"),
      eq((await import("@db/schema")).users.status, "active"),
    ));

  const results: AgentKpiData[] = [];
  for (const agent of agentsList) {
    const kpi = await calculateAgentKpi(db, agent.id, tenantId, periodStart, periodEnd);
    kpi.agentName = agent.name;
    results.push(kpi);
  }

  // Sort by KPI score descending
  results.sort((a, b) => b.kpiScore - a.kpiScore);

  return results;
}

/**
 * Calculate salary for an agent in a given period.
 */
export async function calculateSalary(
  db: DrizzleInstance,
  agentId: number,
  tenantId: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<SalaryData> {
  // Get commission rate from commissions table
  const [commissionRecord] = await db.select({
    commissionRate: sql<string>`commission_rate`,
  }).from(commissions)
    .where(and(
      eq(commissions.tenantId, tenantId),
      eq(commissions.userId, agentId),
    ))
    .limit(1);

  const commissionRate = Number(commissionRecord?.commissionRate ?? 0);

  // Get sales amount from completed orders
  const [salesStats] = await db.select({
    salesAmount: sql<string>`COALESCE(SUM(CAST(total AS DECIMAL(10,2))), 0)`,
  }).from(orders)
    .where(and(
      eq(orders.tenantId, tenantId),
      eq(orders.agentId, agentId),
      eq(orders.status, "completed"),
      gte(orders.createdAt, periodStart),
      lte(orders.createdAt, periodEnd),
    ));

  const salesAmount = Number(salesStats?.salesAmount ?? 0);
  const commissionAmount = Math.round(salesAmount * (commissionRate / 100));

  // Get KPI score for bonus calculation
  const kpi = await calculateAgentKpi(db, agentId, tenantId, periodStart, periodEnd);
  const bonusAmount = calculateBonus(kpi.kpiScore, salesAmount);

  // Base salary from salesTargets or default
  const [targetRecord] = await db.select({
    targetAmount: sql<string>`target_amount`,
  }).from(salesTargets)
    .where(and(
      eq(salesTargets.tenantId, tenantId),
      eq(salesTargets.userId, agentId),
    ))
    .limit(1);

  const baseSalary = Number(targetRecord?.targetAmount ?? 0);
  const totalSalary = baseSalary + commissionAmount + bonusAmount;

  const periodLabel = `${periodStart.toISOString().slice(0, 10)} — ${periodEnd.toISOString().slice(0, 10)}`;

  // Get agent name
  const [agent] = await db.select({ name: sql<string>`name` })
    .from((await import("@db/schema")).users)
    .where(eq((await import("@db/schema")).users.id, agentId))
    .limit(1);

  return {
    agentId,
    agentName: String(agent?.name ?? "Agent"),
    period: periodLabel,
    baseSalary,
    commissionRate,
    salesAmount,
    commissionAmount,
    kpiScore: kpi.kpiScore,
    bonusAmount,
    totalSalary,
    breakdown: {
      base: baseSalary,
      commission: commissionAmount,
      bonus: bonusAmount,
    },
  };
}

/**
 * Calculate composite KPI score from individual metrics.
 * Each metric is normalized to 0-100, then weighted.
 */
function calculateCompositeScore(metrics: {
  visitCompletion: number;
  revenue: number;
  conversion: number;
  returnRate: number;
  debtCollection: number;
}): number {
  // Normalize revenue to 0-100 (assuming 10M max monthly revenue)
  const maxRevenue = 10_000_000;
  const revenueNormalized = Math.min(100, (metrics.revenue / maxRevenue) * 100);

  const score =
    metrics.visitCompletion * KPI_WEIGHTS.visitCompletion +
    revenueNormalized * KPI_WEIGHTS.revenue +
    metrics.conversion * KPI_WEIGHTS.conversion +
    metrics.returnRate * KPI_WEIGHTS.returnRate +
    metrics.debtCollection * KPI_WEIGHTS.debtCollection;

  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * Get letter grade from numeric score.
 */
function getGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  for (const t of GRADE_THRESHOLDS) {
    if (score >= t.min) return t.grade;
  }
  return "F";
}

/**
 * Calculate bonus based on KPI score.
 * Bonus = baseBonus * (kpiScore / 100)
 */
function calculateBonus(kpiScore: number, revenue: number): number {
  const baseBonus = Math.round(revenue * 0.02); // 2% of revenue as base bonus
  return Math.round(baseBonus * (kpiScore / 100));
}
