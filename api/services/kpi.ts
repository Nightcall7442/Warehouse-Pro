import { sql, eq, and, gte, lte, inArray, isNull } from "drizzle-orm";
import type { DrizzleInstance } from "../queries/connection";
import { orders, dailyPlans, returns, shops, salesTargets, commissions, agentLocations, visitReports, users, payments } from "@db/schema";
import { calculateFraudMetrics } from "./anti-fraud";

export interface AgentKpiData {
  agentId: number;
  agentName: string;
  period: string;

  totalPlans: number;
  visitedPlans: number;
  skippedPlans: number;
  visitCompletionRate: number;

  orderCount: number;
  revenue: number;
  avgOrderValue: number;

  returnCount: number;
  returnRate: number;

  deliveryCount: number;
  deliveredCount: number;
  failedCount: number;
  deliverySuccessRate: number;
  cashCollected: number;

  assignedShops: number;
  totalDebt: number;
  debtCollectionRate: number;

  kpiScore: number;
  kpiGrade: "A" | "B" | "C" | "D" | "F";

  gpsPings: number;
  lastGpsTime: string | null;
  isOnline: boolean;

  visitReportCount: number;
  lastReportTime: string | null;

  suspiciousVisits: number;
  fraudRate: number;
  avgVisitDuration: number;

  targetRevenue: number;
  targetProgress: number;
}

export interface SalaryData {
  agentId: number;
  agentName: string;
  period: string;

  baseSalary: number;
  commissionRate: number;
  salesAmount: number;
  commissionAmount: number;

  kpiScore: number;
  bonusAmount: number;

  totalSalary: number;

  breakdown: {
    base: number;
    commission: number;
    bonus: number;
    fraudDeduction: number;
  };
}

export interface AgentListEntry {
  agentId: number;
  agentName: string;
  orderCount: number;
  revenue: number;
  totalPlans: number;
  visitedPlans: number;
  kpiScore: number;
  kpiGrade: "A" | "B" | "C" | "D" | "F";
  suspiciousVisits: number;
  fraudRate: number;
}

const KPI_WEIGHTS = {
  visitCompletion: 0.30,
  revenue: 0.25,
  conversion: 0.20,
  returnRate: 0.15,
  debtCollection: 0.10,
};

const GRADE_THRESHOLDS = [
  { min: 90, grade: "A" as const },
  { min: 75, grade: "B" as const },
  { min: 60, grade: "C" as const },
  { min: 40, grade: "D" as const },
  { min: 0, grade: "F" as const },
];

export async function calculateAgentKpi(
  db: DrizzleInstance,
  agentId: number,
  tenantId: number,
  periodStart: Date,
  periodEnd: Date,
  preloadedKpis?: Partial<AgentKpiData>,
): Promise<AgentKpiData> {
  const [planStats] = preloadedKpis?.totalPlans != null ? [{ total: preloadedKpis.totalPlans, visited: preloadedKpis.visitedPlans, skipped: preloadedKpis.skippedPlans }] : await db.select({
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

  const [orderStats] = preloadedKpis?.orderCount != null ? [{ count: preloadedKpis.orderCount, revenue: preloadedKpis.revenue }] : await db.select({
    count: sql<number>`count(*)`,
    revenue: sql<string>`COALESCE(SUM(CAST(total AS DECIMAL(10,2))), 0)`,
  }).from(orders)
    .where(and(
      eq(orders.tenantId, tenantId),
      eq(orders.agentId, agentId),
      eq(orders.status, "completed"),
      isNull(orders.deletedAt),
      gte(orders.createdAt, periodStart),
      lte(orders.createdAt, periodEnd),
    ));

  const orderCount = Number(orderStats?.count ?? 0);
  const grossRevenue = Number(orderStats?.revenue ?? 0);

  // Subtract completed returns from revenue so commission/KPI reflect net sales
  const [returnRevenue] = await db.select({
    total: sql<string>`COALESCE(SUM(${returns.totalAmount}), 0)`,
  }).from(returns)
    .innerJoin(orders, eq(returns.orderId, orders.id))
    .where(and(
      eq(returns.tenantId, tenantId),
      eq(orders.agentId, agentId),
      eq(returns.status, "completed"),
      isNull(orders.deletedAt),
      gte(orders.createdAt, periodStart),
      lte(orders.createdAt, periodEnd),
    ));

  const revenue = Math.max(0, grossRevenue - Number(returnRevenue?.total ?? 0));
  const avgOrderValue = orderCount > 0 ? Math.round(revenue / orderCount) : 0;

  const [returnStats] = preloadedKpis?.returnCount != null ? [{ count: preloadedKpis.returnCount }] : await db.select({
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

  const [deliveryStats] = preloadedKpis?.deliveryCount != null ? [{ total: preloadedKpis.deliveryCount, delivered: preloadedKpis.deliveredCount, failed: preloadedKpis.failedCount }] : await db.select({
    total: sql<number>`count(*)`,
    delivered: sql<number>`count(CASE WHEN delivery_status = 'delivered' THEN 1 END)`,
    failed: sql<number>`count(CASE WHEN delivery_status = 'failed' THEN 1 END)`,
  }).from(orders)
    .where(and(
      eq(orders.tenantId, tenantId),
      eq(orders.courierId, agentId),
      sql`${orders.deliveryStatus} IN ('assigned', 'out_for_delivery', 'delivered', 'failed')`,
      gte(orders.createdAt, periodStart),
      lte(orders.createdAt, periodEnd),
    ));

  const deliveryCount = Number(deliveryStats?.total ?? 0);
  const deliveredCount = Number(deliveryStats?.delivered ?? 0);
  const failedCount = Number(deliveryStats?.failed ?? 0);
  const deliverySuccessRate = deliveryCount > 0 ? Math.round((deliveredCount / deliveryCount) * 100) : 0;

  const [cashStats] = preloadedKpis?.cashCollected != null ? [{ total: preloadedKpis.cashCollected }] : await db.select({
    total: sql<string>`COALESCE(SUM(CAST(amount AS DECIMAL(12,2))), 0)`,
  }).from(payments)
    .where(and(
      eq(payments.tenantId, tenantId),
      eq(payments.createdBy, agentId),
      eq(payments.type, "payment"),
      gte(payments.createdAt, periodStart),
      lte(payments.createdAt, periodEnd),
    ));

  const cashCollected = Number(cashStats?.total ?? 0);

  const [shopStats] = preloadedKpis?.assignedShops != null ? [{ count: preloadedKpis.assignedShops, totalDebt: preloadedKpis.totalDebt }] : await db.select({
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

  const totalOwed = revenue + totalDebt;
  const debtCollectionRate = totalOwed > 0 ? Math.round((revenue / totalOwed) * 100) : 100;

  const [gpsStats] = preloadedKpis?.gpsPings != null ? [{ pingCount: preloadedKpis.gpsPings, lastPing: preloadedKpis.lastGpsTime }] : await db.select({
    pingCount: sql<number>`count(*)`,
    lastPing: sql<string>`MAX(created_at)`,
  }).from(agentLocations)
    .where(and(
      eq(agentLocations.tenantId, tenantId),
      eq(agentLocations.agentId, agentId),
      gte(agentLocations.createdAt, periodStart),
      lte(agentLocations.createdAt, periodEnd),
    ));

  const gpsPings = Number(gpsStats?.pingCount ?? 0);
  const lastGpsTime = gpsStats?.lastPing ?? null;
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
  const isOnline = lastGpsTime ? new Date(lastGpsTime) > tenMinAgo : false;

  const [reportStats] = preloadedKpis?.visitReportCount != null ? [{ count: preloadedKpis.visitReportCount, lastReport: preloadedKpis.lastReportTime }] : await db.select({
    count: sql<number>`count(*)`,
    lastReport: sql<string>`MAX(created_at)`,
  }).from(visitReports)
    .where(and(
      eq(visitReports.tenantId, tenantId),
      eq(visitReports.userId, agentId),
      gte(visitReports.createdAt, periodStart),
      lte(visitReports.createdAt, periodEnd),
    ));

  const visitReportCount = Number(reportStats?.count ?? 0);
  const lastReportTime = reportStats?.lastReport ?? null;

  const fraudMetrics = await calculateFraudMetrics(db, agentId, tenantId, periodStart, periodEnd);

  const [targetRecord] = preloadedKpis?.targetRevenue != null ? [{ targetAmount: preloadedKpis.targetRevenue }] : await db.select({
    targetAmount: sql<string>`COALESCE(target_amount, '0')`,
  }).from(salesTargets)
    .where(and(
      eq(salesTargets.tenantId, tenantId),
      eq(salesTargets.userId, agentId),
    ))
    .limit(1);

  const targetRevenue = Number(targetRecord?.targetAmount ?? 0);
  const targetProgress = targetRevenue > 0 ? Math.min(100, Math.round((revenue / targetRevenue) * 100)) : 0;

  const fraudPenalty = fraudMetrics.fraudRate * 0.3;
  const kpiScore = Math.max(0, calculateCompositeScore({
    visitCompletion: visitCompletionRate,
    revenue,
    conversion: orderCount > 0 && totalPlans > 0 ? Math.round((orderCount / totalPlans) * 100) : 0,
    returnRate: 100 - returnRate,
    debtCollection: debtCollectionRate,
  }) - fraudPenalty);

  const kpiGrade = getGrade(kpiScore);

  const [agent] = preloadedKpis?.agentName != null ? [{ name: preloadedKpis.agentName }] : await db.select({ name: sql<string>`name` })
    .from(users)
    .where(eq(users.id, agentId))
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
    deliveryCount,
    deliveredCount,
    failedCount,
    deliverySuccessRate,
    cashCollected,
    assignedShops,
    totalDebt,
    debtCollectionRate,
    kpiScore,
    kpiGrade,
    gpsPings,
    lastGpsTime,
    isOnline,
    visitReportCount,
    lastReportTime,
    suspiciousVisits: fraudMetrics.suspiciousVisits,
    fraudRate: fraudMetrics.fraudRate,
    avgVisitDuration: fraudMetrics.avgVisitDuration,
    targetRevenue,
    targetProgress,
  };
}

export async function calculateAllAgentsKpi(
  db: DrizzleInstance,
  tenantId: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<AgentKpiData[]> {
  const agentsList = await db.select({
    id: sql<number>`id`,
    name: sql<string>`name`,
  }).from(users)
    .where(and(
      eq(users.tenantId, tenantId),
      eq(users.role, "agent"),
      eq(users.status, "active"),
    ));

  const results = await Promise.all(
    agentsList.map(agent =>
      calculateAgentKpi(db, agent.id, tenantId, periodStart, periodEnd)
        .then(kpi => { kpi.agentName = agent.name; return kpi; })
    )
  );

  results.sort((a, b) => b.kpiScore - a.kpiScore);
  return results;
}

export async function calculateSalary(
  db: DrizzleInstance,
  agentId: number,
  tenantId: number,
  periodStart: Date,
  periodEnd: Date,
  preloadedKpi?: AgentKpiData,
): Promise<SalaryData> {
  const [commissionRecord] = await db.select({
    commissionRate: sql<string>`commission_rate`,
    id: commissions.id,
  }).from(commissions)
    .where(and(
      eq(commissions.tenantId, tenantId),
      eq(commissions.userId, agentId),
    ))
    .limit(1);

  const commissionRate = Number(commissionRecord?.commissionRate ?? 0);

  const [salesStats] = await db.select({
    salesAmount: sql<string>`COALESCE(SUM(CAST(total AS DECIMAL(10,2))), 0)`,
  }).from(orders)
    .where(and(
      eq(orders.tenantId, tenantId),
      eq(orders.agentId, agentId),
      eq(orders.status, "completed"),
      isNull(orders.deletedAt),
      gte(orders.createdAt, periodStart),
      lte(orders.createdAt, periodEnd),
    ));

  const [returnSales] = await db.select({
    total: sql<string>`COALESCE(SUM(${returns.totalAmount}), 0)`,
  }).from(returns)
    .innerJoin(orders, eq(returns.orderId, orders.id))
    .where(and(
      eq(returns.tenantId, tenantId),
      eq(orders.agentId, agentId),
      eq(returns.status, "completed"),
      isNull(orders.deletedAt),
      gte(orders.createdAt, periodStart),
      lte(orders.createdAt, periodEnd),
    ));

  const salesAmount = Math.max(0, Number(salesStats?.salesAmount ?? 0) - Number(returnSales?.total ?? 0));
  const commissionAmount = Number((salesAmount * (commissionRate / 100)).toFixed(2));

  const kpi = preloadedKpi ?? await calculateAgentKpi(db, agentId, tenantId, periodStart, periodEnd);
  const bonusAmount = calculateBonus(kpi.kpiScore, salesAmount);

  const [targetRecord] = await db.select({
    targetAmount: sql<string>`target_amount`,
  }).from(salesTargets)
    .where(and(
      eq(salesTargets.tenantId, tenantId),
      eq(salesTargets.userId, agentId),
    ))
    .limit(1);

  const baseSalary = Number(targetRecord?.targetAmount ?? 0);

  const fraudDeduction = Number((baseSalary * (kpi.fraudRate / 100) * 0.5).toFixed(2));

  const totalSalary = Math.max(0, baseSalary + commissionAmount + bonusAmount - fraudDeduction);

  const periodLabel = `${periodStart.toISOString().slice(0, 10)} — ${periodEnd.toISOString().slice(0, 10)}`;

  const [agent] = preloadedKpi ? [{ name: preloadedKpi.agentName }] : await db.select({ name: sql<string>`name` })
    .from(users)
    .where(eq(users.id, agentId))
    .limit(1);

  // Auto-persist commission record to DB
  const monthStart = periodStart.toISOString().slice(0, 10);
  const monthEnd = periodEnd.toISOString().slice(0, 10);
  try {
    if (commissionRecord?.id) {
      await db.update(commissions)
        .set({
          salesAmount: salesAmount.toFixed(2),
          commissionAmount: commissionAmount.toFixed(2),
          periodStart: monthStart,
          periodEnd: monthEnd,
        })
        .where(eq(commissions.id, commissionRecord.id));
    } else if (commissionRate > 0) {
      await db.insert(commissions).values({
        tenantId,
        userId: agentId,
        commissionRate: commissionRate.toFixed(2),
        periodType: "monthly",
        periodStart: monthStart,
        periodEnd: monthEnd,
        salesAmount: salesAmount.toFixed(2),
        commissionAmount: commissionAmount.toFixed(2),
      });
    }
  } catch { /* non-critical, skip */ }

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
      fraudDeduction: -fraudDeduction,
    },
  };
}

function calculateCompositeScore(metrics: {
  visitCompletion: number;
  revenue: number;
  conversion: number;
  returnRate: number;
  debtCollection: number;
}): number {
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

function getGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  for (const t of GRADE_THRESHOLDS) {
    if (score >= t.min) return t.grade;
  }
  return "F";
}

function calculateBonus(kpiScore: number, revenue: number): number {
  const baseBonus = Math.round(revenue * 0.02);
  return Math.round(baseBonus * (kpiScore / 100));
}

export async function getAgentList(
  db: DrizzleInstance,
  tenantId: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<AgentListEntry[]> {
  const agents = await db.select({ agentId: users.id, agentName: users.name })
    .from(users)
    .where(and(
      eq(users.tenantId, tenantId),
      eq(users.role, "agent"),
      eq(users.status, "active"),
    ));

  if (agents.length === 0) return [];

  const agentIds = agents.map(a => a.agentId);

  const [orderRows, planRows, returnRows, fraudRows] = await Promise.all([
    db.select({
      agentId: orders.agentId,
      orderCount: sql<number>`count(*)`,
      revenue: sql<string>`COALESCE(SUM(CAST(total AS DECIMAL(10,2))), 0)`,
    }).from(orders)
      .where(and(
        eq(orders.tenantId, tenantId),
        eq(orders.status, "completed"),
        gte(orders.createdAt, periodStart),
        lte(orders.createdAt, periodEnd),
        inArray(orders.agentId, agentIds),
      )).groupBy(orders.agentId),

    db.select({
      agentId: dailyPlans.agentId,
      totalPlans: sql<number>`count(*)`,
      visitedPlans: sql<number>`count(CASE WHEN ${dailyPlans.status} = 'visited' THEN 1 END)`,
    }).from(dailyPlans)
      .where(and(
        eq(dailyPlans.tenantId, tenantId),
        gte(dailyPlans.planDate, periodStart),
        lte(dailyPlans.planDate, periodEnd),
        inArray(dailyPlans.agentId, agentIds),
      )).groupBy(dailyPlans.agentId),

    db.select({
      agentId: returns.agentId,
      returnCount: sql<number>`count(*)`,
    }).from(returns)
      .where(and(
        eq(returns.tenantId, tenantId),
        gte(returns.createdAt, periodStart),
        lte(returns.createdAt, periodEnd),
        inArray(returns.agentId, agentIds),
      )).groupBy(returns.agentId),

    db.select({
      agentId: agentLocations.agentId,
      gpsCount: sql<number>`count(*)`,
    }).from(agentLocations)
      .where(and(
        eq(agentLocations.tenantId, tenantId),
        gte(agentLocations.createdAt, periodStart),
        lte(agentLocations.createdAt, periodEnd),
        inArray(agentLocations.agentId, agentIds),
      )).groupBy(agentLocations.agentId),
  ]);

  const orderMap = new Map(orderRows.map(r => [r.agentId, r]));
  const planMap = new Map(planRows.map(r => [r.agentId, r]));
  const returnMap = new Map(returnRows.map(r => [r.agentId, r]));
  const gpsMap = new Map(fraudRows.map(r => [r.agentId, r]));

  return agents.map((agent) => {
    const orders = orderMap.get(agent.agentId);
    const plans = planMap.get(agent.agentId);
    const rets = returnMap.get(agent.agentId);
    const gps = gpsMap.get(agent.agentId);

    const orderCount = Number(orders?.orderCount ?? 0);
    const revenue = Number(orders?.revenue ?? 0);
    const totalPlans = Number(plans?.totalPlans ?? 0);
    const visitedPlans = Number(plans?.visitedPlans ?? 0);
    const returnCount = Number(rets?.returnCount ?? 0);

    const visitCompletionRate = totalPlans > 0 ? Math.round((visitedPlans / totalPlans) * 100) : 0;
    const returnRate = orderCount > 0 ? Math.round((returnCount / orderCount) * 100) : 0;
    const conversion = orderCount > 0 && totalPlans > 0 ? Math.round((orderCount / totalPlans) * 100) : 0;
    const gpsPings = Number(gps?.gpsCount ?? 0);

    const suspiciousVisits = gpsPings === 0 && visitedPlans > 0 ? visitedPlans : 0;
    const fraudRate = visitedPlans > 0 ? Math.round((suspiciousVisits / visitedPlans) * 100) : 0;

    const revenueNormalized = Math.min(100, (revenue / 10_000_000) * 100);
    const kpiScore = Math.max(0, Math.round(
      visitCompletionRate * 0.30 +
      revenueNormalized * 0.25 +
      conversion * 0.20 +
      (100 - returnRate) * 0.15 +
      100 * 0.10
    ));

    return {
      agentId: agent.agentId,
      agentName: agent.agentName,
      orderCount,
      revenue,
      totalPlans,
      visitedPlans,
      kpiScore,
      kpiGrade: getGrade(kpiScore),
      suspiciousVisits,
      fraudRate,
    };
  });
}
