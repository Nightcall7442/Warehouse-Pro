import { eq, and, sql, desc, gte, lte, isNull } from "drizzle-orm";
import { shops, orders, payments, visitReports, dailyPlans } from "@db/schema";
import type { DrizzleInstance } from "../queries/connection";

/**
 * Shop Intelligence — Health Score & Analytics
 *
 * Calculates a composite "health score" (0-100) for each shop based on:
 * - Order frequency (30-day window)
 * - Payment reliability (on-time payment ratio)
 * - Debt level (relative to order volume)
 * - Visit compliance (planned vs actual visits)
 * - Order value trend (growing or declining)
 *
 * Score ranges:
 *   90-100: Excellent — loyal, pays on time, orders regularly
 *   70-89:  Good — reliable with minor issues
 *   50-69:  Average — needs attention
 *   30-49:  At Risk — declining engagement or growing debt
 *   0-29:   Critical — likely to churn
 */

export interface ShopIntelligence {
  shopId: number;
  shopName: string;
  healthScore: number;
  healthLabel: string;
  healthColor: string;
  metrics: {
    orderFrequency: { score: number; detail: string };
    paymentReliability: { score: number; detail: string };
    debtLevel: { score: number; detail: string };
    visitCompliance: { score: number; detail: string };
    orderValueTrend: { score: number; detail: string };
  };
  insights: string[];
  recommendations: string[];
  churnRisk: "low" | "medium" | "high";
  lastOrderDaysAgo: number | null;
  totalOrders30d: number;
  totalRevenue30d: number;
  currentDebt: number;
}

const WEIGHTS = {
  orderFrequency: 0.25,
  paymentReliability: 0.25,
  debtLevel: 0.20,
  visitCompliance: 0.15,
  orderValueTrend: 0.15,
};

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function scoreToLabel(score: number): { label: string; color: string } {
  if (score >= 90) return { label: "Отлично", color: "#16a34a" };
  if (score >= 70) return { label: "Хорошо", color: "#3b82f6" };
  if (score >= 50) return { label: "Средне", color: "#f59e0b" };
  if (score >= 30) return { label: "На грани", color: "#f97316" };
  return { label: "Критично", color: "#ef4444" };
}

export async function calculateShopIntelligence(
  db: DrizzleInstance,
  tenantId: number,
  shopId: number,
): Promise<ShopIntelligence | null> {
  const now = new Date();
  const daysAgo30 = new Date(now.getTime() - 30 * 86_400_000);
  const daysAgo90 = new Date(now.getTime() - 90 * 86_400_000);

  // Get shop
  const [shop] = await db.select()
    .from(shops)
    .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId)))
    .limit(1);

  if (!shop) return null;

  // ── 1. Order frequency (30 days) ──────────────────────────────────────
  const [orderStats] = await db.select({
    count: sql<number>`COUNT(*)`,
    total: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
    lastOrder: sql<Date>`MAX(${orders.createdAt})`,
  })
    .from(orders)
    .where(and(
      eq(orders.shopId, shopId),
      eq(orders.tenantId, tenantId),
      isNull(orders.deletedAt),
      gte(orders.createdAt, daysAgo30),
    ));

  const orderCount = Number(orderStats?.count ?? 0);
  const totalRevenue = Number(orderStats?.total ?? 0);
  const lastOrderDate = orderStats?.lastOrder;
  const lastOrderDaysAgo = lastOrderDate
    ? Math.floor((now.getTime() - new Date(lastOrderDate).getTime()) / 86_400_000)
    : null;

  // Score: 0 orders = 0, 1-2 = 40, 3-5 = 60, 6-10 = 80, 11+ = 100
  const orderFrequencyScore = clamp(
    orderCount === 0 ? 0 : orderCount <= 2 ? 40 : orderCount <= 5 ? 60 : orderCount <= 10 ? 80 : 100,
    0, 100
  );
  const orderFrequencyDetail = orderCount === 0
    ? "Нет заказов за 30 дней"
    : `${orderCount} заказ${orderCount > 1 ? "а" : ""} за 30 дней`;

  // ── 2. Payment reliability ────────────────────────────────────────────
  const [paymentStats] = await db.select({
    count: sql<number>`COUNT(*)`,
    total: sql<string>`COALESCE(SUM(${payments.amount}), 0)`,
  })
    .from(payments)
    .where(and(
      eq(payments.shopId, shopId),
      eq(payments.tenantId, tenantId),
      gte(payments.createdAt, daysAgo90),
    ));

  const paymentCount = Number(paymentStats?.count ?? 0);
  const paymentTotal = Number(paymentStats?.total ?? 0);

  // Ratio: payments to orders (higher = more reliable)
  const paymentRatio = totalRevenue > 0 ? paymentTotal / totalRevenue : (paymentCount > 0 ? 1 : 0);
  const paymentReliabilityScore = clamp(Math.round(paymentRatio * 100), 0, 100);
  const paymentReliabilityDetail = paymentCount === 0
    ? "Нет оплат за 90 дней"
    : `${paymentCount} оплат на ${(paymentRatio * 100).toFixed(0)}% от заказов`;

  // ── 3. Debt level ─────────────────────────────────────────────────────
  const currentDebt = Number(shop.debt ?? 0);
  const debtToRevenueRatio = totalRevenue > 0 ? currentDebt / totalRevenue : (currentDebt > 0 ? 2 : 0);
  // Score: no debt = 100, <30% of revenue = 70, <60% = 40, <100% = 20, >100% = 0
  const debtLevelScore = clamp(
    currentDebt === 0 ? 100 :
    debtToRevenueRatio < 0.3 ? 70 :
    debtToRevenueRatio < 0.6 ? 40 :
    debtToRevenueRatio < 1 ? 20 : 0,
    0, 100
  );
  const debtLevelDetail = currentDebt === 0
    ? "Нет долга"
    : `Долг: ${currentDebt.toLocaleString("ru")} сум (${(debtToRevenueRatio * 100).toFixed(0)}% от выручки)`;

  // ── 4. Visit compliance (30 days) ─────────────────────────────────────
  const [visitStats] = await db.select({
    planned: sql<number>`COUNT(*)`,
  })
    .from(dailyPlans)
    .where(and(
      eq(dailyPlans.shopId, shopId),
      gte(dailyPlans.date, daysAgo30.toISOString().slice(0, 10)),
    ));

  const [reportStats] = await db.select({
    completed: sql<number>`COUNT(*)`,
  })
    .from(visitReports)
    .where(and(
      eq(visitReports.shopId, shopId),
      gte(visitReports.createdAt, daysAgo30),
    ));

  const plannedVisits = Number(visitStats?.planned ?? 0);
  const completedVisits = Number(reportStats?.completed ?? 0);
  const visitRatio = plannedVisits > 0 ? completedVisits / plannedVisits : (completedVisits > 0 ? 1 : 0);
  const visitComplianceScore = clamp(Math.round(visitRatio * 100), 0, 100);
  const visitComplianceDetail = plannedVisits === 0
    ? "Нет запланированных визитов"
    : `${completedVisits}/${plannedVisits} визитов выполнено`;

  // ── 5. Order value trend (30d vs previous 30d) ───────────────────────
  const daysAgo60 = new Date(now.getTime() - 60 * 86_400_000);
  const [prevStats] = await db.select({
    total: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
  })
    .from(orders)
    .where(and(
      eq(orders.shopId, shopId),
      eq(orders.tenantId, tenantId),
      isNull(orders.deletedAt),
      gte(orders.createdAt, daysAgo60),
      lte(orders.createdAt, daysAgo30),
    ));

  const prevRevenue = Number(prevStats?.total ?? 0);
  const trendRatio = prevRevenue > 0 ? totalRevenue / prevRevenue : (totalRevenue > 0 ? 2 : 0);
  // Growing = 100, stable = 70, declining = 40, steep decline = 10
  const orderValueTrendScore = clamp(
    trendRatio >= 1.5 ? 100 :
    trendRatio >= 1 ? 70 :
    trendRatio >= 0.5 ? 40 :
    trendRatio > 0 ? 10 : 50, // no data = neutral
    0, 100
  );
  const trendPercent = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue * 100).toFixed(0) : "—";
  const orderValueTrendDetail = prevRevenue === 0 && totalRevenue === 0
    ? "Нет данных"
    : `${trendPercent > "0" ? "+" : ""}${trendPercent}% к прошлому месяцу`;

  // ── Composite score ───────────────────────────────────────────────────
  const healthScore = Math.round(
    orderFrequencyScore * WEIGHTS.orderFrequency +
    paymentReliabilityScore * WEIGHTS.paymentReliability +
    debtLevelScore * WEIGHTS.debtLevel +
    visitComplianceScore * WEIGHTS.visitCompliance +
    orderValueTrendScore * WEIGHTS.orderValueTrend
  );

  const { label: healthLabel, color: healthColor } = scoreToLabel(healthScore);

  // ── Insights ──────────────────────────────────────────────────────────
  const insights: string[] = [];
  if (orderCount === 0) insights.push("Нет заказов за последний месяц");
  if (currentDebt > 0 && debtToRevenueRatio > 0.5) insights.push("Долг превышает 50% от выручки");
  if (lastOrderDaysAgo !== null && lastOrderDaysAgo > 14) insights.push(`Последний заказ был ${lastOrderDaysAgo} дней назад`);
  if (visitRatio < 0.5 && plannedVisits > 0) insights.push("Менее 50% визитов выполнено");
  if (trendRatio < 0.5 && prevRevenue > 0) insights.push("Выручка упала более чем в 2 раза");

  // ── Recommendations ───────────────────────────────────────────────────
  const recommendations: string[] = [];
  if (orderCount === 0) recommendations.push("Назначить визит для выяснения причин");
  if (currentDebt > 0) recommendations.push("При визите напомнить о долге");
  if (trendRatio < 0.7 && prevRevenue > 0) recommendations.push("Предложить акцию или скидку");
  if (visitRatio < 0.5) recommendations.push("Увеличить частоту визитов");
  if (orderCount > 10 && currentDebt === 0) recommendations.push("Надёжный клиент — можно увеличить лимит");

  // ── Churn risk ────────────────────────────────────────────────────────
  const churnRisk: "low" | "medium" | "high" =
    healthScore >= 70 ? "low" :
    healthScore >= 40 ? "medium" : "high";

  return {
    shopId,
    shopName: shop.name,
    healthScore,
    healthLabel,
    healthColor,
    metrics: {
      orderFrequency: { score: orderFrequencyScore, detail: orderFrequencyDetail },
      paymentReliability: { score: paymentReliabilityScore, detail: paymentReliabilityDetail },
      debtLevel: { score: debtLevelScore, detail: debtLevelDetail },
      visitCompliance: { score: visitComplianceScore, detail: visitComplianceDetail },
      orderValueTrend: { score: orderValueTrendScore, detail: orderValueTrendDetail },
    },
    insights,
    recommendations,
    churnRisk,
    lastOrderDaysAgo,
    totalOrders30d: orderCount,
    totalRevenue30d: totalRevenue,
    currentDebt,
  };
}
