import { sql, eq, and, gte, lte, inArray, isNull, desc } from "drizzle-orm";
import { REVENUE_ORDER_STATUSES, revenueOrderConditions } from "../lib/order-status";
import { orders, dailyPlans, returns, shops, salesTargets, commissions, agentLocations, visitReports, users, payments } from "@db/schema";
import { calculateFraudMetrics } from "./anti-fraud";
import { logger } from "../lib/logger";
import { untilDate } from "../lib/date-range";

type DrizzleInstance = ReturnType<typeof import("../queries/connection").getDb>;

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

  /*
    Курьерская часть. Заполняется только у курьера и только тогда, когда ему
    назначена ставка: у остальных ролей эти поля остаются пустыми, и экран по
    ним же решает, какую разбивку показывать.
  */
  deliveryRate: number;
  deliveredCount: number;
  deliveryPay: number;

  totalSalary: number;

  breakdown: {
    base: number;
    commission: number;
    bonus: number;
    fraudDeduction: number;
    /** Оплата за доставки: ставка × довезённые заказы. */
    delivery: number;
  };
}

/**
 * Показатели курьера.
 *
 * ── Зачем отдельно от агента ────────────────────────────────────────────────
 *
 * Расчёт агента меряет визиты, планы и оформленные заказы. У курьера нет ни
 * одного из них: заказы он не оформляет (orders.agentId у него пуст), планов
 * визитов ему не ставят. Прогнав курьера через агентский расчёт, получаешь
 * ноль по всем строкам и оценку «F» — не потому что он плохо работает, а
 * потому что меряли не тем.
 *
 * Здесь меряется то, что курьер действительно делает: довёз, не довёз, привёз
 * ли деньги.
 */
export interface CourierStats {
  courierId: number;
  courierName: string;
  /** Довезённые заказы — за них и платят. */
  delivered: number;
  /** Сорванные: магазин закрыт, отказ, не дозвонились. */
  failed: number;
  /** Довезены, но товар вернулся — полностью или частью. */
  returned: number;
  /** Сумма довезённых заказов. */
  deliveredAmount: number;
  /** Наличные, привезённые курьером в кассу. */
  cashCollected: number;
  /** Доля довезённого от всего назначенного, в процентах. */
  successRate: number;
}

export async function calculateCourierStats(
  db: DrizzleInstance,
  courierId: number,
  tenantId: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<CourierStats> {
  /*
    Считается по дате ДОСТАВКИ, а не создания заказа.

    Заказ мог быть оформлен в конце месяца, а доехать в начале следующего.
    Плати мы по дате создания — доставка попадала бы в тот месяц, в котором
    курьер её ещё не делал, и в свой месяц не попадала бы вовсе.
  */
  const [counts] = await db.select({
    delivered: sql<number>`SUM(CASE WHEN ${orders.deliveryStatus} = 'delivered' THEN 1 ELSE 0 END)`,
    failed: sql<number>`SUM(CASE WHEN ${orders.deliveryStatus} = 'failed' THEN 1 ELSE 0 END)`,
    returned: sql<number>`SUM(CASE WHEN ${orders.deliveryResult} IN ('returned', 'partial_returned') THEN 1 ELSE 0 END)`,
    deliveredAmount: sql<string>`COALESCE(SUM(CASE WHEN ${orders.deliveryStatus} = 'delivered' THEN CAST(${orders.total} AS DECIMAL(15,2)) ELSE 0 END), 0)`,
  }).from(orders)
    .where(and(
      eq(orders.tenantId, tenantId),
      eq(orders.courierId, courierId),
      isNull(orders.deletedAt),
      gte(sql`COALESCE(${orders.deliveredAt}, ${orders.createdAt})`, periodStart),
      lte(sql`COALESCE(${orders.deliveredAt}, ${orders.createdAt})`, periodEnd),
    ));

  /*
    Наличные — по тому, КТО их внёс.

    Курьер вносит платёж при доставке, и строка платежа хранит его в createdBy
    (см. api/courier-router.ts). Считать по заказу нельзя: тот же заказ мог
    частью погасить агент при визите, и эти деньги курьеру не приписываются.
  */
  const [cash] = await db.select({
    total: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS DECIMAL(15,2))), 0)`,
  }).from(payments)
    .where(and(
      eq(payments.tenantId, tenantId),
      eq(payments.createdBy, courierId),
      eq(payments.type, "payment"),
      gte(payments.createdAt, periodStart),
      lte(payments.createdAt, periodEnd),
    ));

  const [who] = await db.select({ name: users.name })
    .from(users).where(eq(users.id, courierId)).limit(1);

  const delivered = Number(counts?.delivered ?? 0);
  const failed = Number(counts?.failed ?? 0);
  const assigned = delivered + failed;

  return {
    courierId,
    courierName: who?.name ?? "",
    delivered,
    failed,
    returned: Number(counts?.returned ?? 0),
    deliveredAmount: Number(counts?.deliveredAmount ?? 0),
    cashCollected: Number(cash?.total ?? 0),
    // Ноль назначенных — это не «ноль процентов успеха», а «мерить нечего».
    successRate: assigned === 0 ? 0 : Number(((delivered / assigned) * 100).toFixed(1)),
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

/**
 * Во сколько обходится балл каждый процент подозрительных визитов.
 *
 * Один множитель на карточку и на список: пока он стоял числом только в
 * карточке, список считал балл вообще без штрафа.
 */
/** Дата в виде YYYY-MM-DD — как её хранят DATE-колонки. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const FRAUD_PENALTY_WEIGHT = 0.3;

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
    revenue: sql<string>`COALESCE(SUM(CAST(total AS DECIMAL(15,2))), 0)`,
  }).from(orders)
    .where(and(
      eq(orders.tenantId, tenantId),
      eq(orders.agentId, agentId),
      inArray(orders.status, REVENUE_ORDER_STATUSES),
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
    total: sql<string>`COALESCE(SUM(CAST(amount AS DECIMAL(15,2))), 0)`,
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
    totalDebt: sql<string>`COALESCE(SUM(CAST(debt AS DECIMAL(15,2))), 0)`,
  }).from(shops)
    .where(and(
      eq(shops.tenantId, tenantId),
      eq(shops.agentId, agentId),
      eq(shops.status, "active"),
    ));

  const assignedShops = Number(shopStats?.count ?? 0);
  const totalDebt = Number(shopStats?.totalDebt ?? 0);

  const totalOwed = revenue + totalDebt;
  // Debt collection rate: what % of total owed has been collected as revenue
  // A more meaningful metric: payments collected / (payments + outstanding debt)
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

  /*
    Цель — месячная и та, что действовала в показанном периоде.

    Здесь стоял просто «первый попавшийся план этого человека»: без отбора
    по типу периода, без порядка, limit 1. В salesTargets лежат планы
    дневные, недельные и месячные за все месяцы, поэтому кольцо «Цель» на
    экране KPI могло показывать выручку за месяц против ДНЕВНОГО плана —
    или против плана позапрошлого месяца. Проценты выходили любые.

    Правило то же, что у оклада в calculateSalary: последний месячный план,
    начавшийся не позже конца показанного периода.
  */
  const [targetRecord] = preloadedKpis?.targetRevenue != null ? [{ targetAmount: preloadedKpis.targetRevenue }] : await db.select({
    targetAmount: sql<string>`COALESCE(target_amount, '0')`,
  }).from(salesTargets)
    .where(and(
      eq(salesTargets.tenantId, tenantId),
      eq(salesTargets.userId, agentId),
      eq(salesTargets.periodType, "monthly"),
      untilDate(salesTargets.periodStart, ymd(periodEnd)),
    ))
    .orderBy(desc(salesTargets.periodStart))
    .limit(1);

  const targetRevenue = Number(targetRecord?.targetAmount ?? 0);
  const targetProgress = targetRevenue > 0 ? Math.min(100, Math.round((revenue / targetRevenue) * 100)) : 0;

  const kpiScore = kpiScoreOf({
    visitCompletion: visitCompletionRate,
    revenue,
    conversion: orderCount > 0 && totalPlans > 0 ? Math.round((orderCount / totalPlans) * 100) : 0,
    returnRate: 100 - returnRate,
    debtCollection: debtCollectionRate,
  }, fraudMetrics.fraudRate);

  const kpiGrade = getGrade(kpiScore);

  // Фильтр по организации обязателен и здесь: без него чужой agentId
  // возвращал ИМЯ сотрудника другого тенанта (числа-то приходили нулями —
  // их запросы организацию проверяют).
  const [agent] = preloadedKpis?.agentName != null ? [{ name: preloadedKpis.agentName }] : await db.select({ name: sql<string>`name` })
    .from(users)
    .where(and(eq(users.id, agentId), eq(users.tenantId, tenantId)))
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
  // False for a "week"/"quarter" salary view: those still compute and return
  // live numbers, but must not touch the one monthly commission record this
  // agent has. Without this, viewing the week tab overwrote periodStart/
  // periodEnd/salesAmount on the canonical monthly row with that week's
  // narrower figures.
  persist = true,
): Promise<SalaryData> {
  // Отсюда берётся ТОЛЬКО ставка комиссии агента: самая свежая назначенная
  // переносится на новые месяцы, пока её не изменят. Раньше эта же строка
  // служила и целью для записи расчёта — из-за чего расчёт августа переписывал
  // июльскую строку. Цель для записи теперь ищется отдельно, по конкретному
  // периоду (см. блок persist ниже).
  /*
    Ставка, действовавшая В ЭТОМ периоде, а не самая свежая вообще.

    Без ограничения по дате поднятая сегодня ставка задним числом делала
    дороже все закрытые месяцы: август пересчитывался по сентябрьской
    ставке и переставал сходиться с тем, что по нему уже выплатили.
  */
  const effectiveOn = `${periodEnd.getFullYear()}-${String(periodEnd.getMonth() + 1).padStart(2, "0")}-${String(periodEnd.getDate()).padStart(2, "0")}`;

  const [commissionRecord] = await db.select({
    commissionRate: sql<string>`commission_rate`,
    deliveryRate: sql<string>`delivery_rate`,
  }).from(commissions)
    .where(and(
      eq(commissions.tenantId, tenantId),
      eq(commissions.userId, agentId),
      eq(commissions.periodType, "monthly"),
      untilDate(commissions.periodStart, effectiveOn),
    ))
    .orderBy(desc(commissions.periodStart))
    .limit(1);

  const commissionRate = Number(commissionRecord?.commissionRate ?? 0);
  const deliveryRate = Number(commissionRecord?.deliveryRate ?? 0);

  const [salesStats] = await db.select({
    salesAmount: sql<string>`COALESCE(SUM(CAST(total AS DECIMAL(15,2))), 0)`,
  }).from(orders)
    .where(and(
      eq(orders.tenantId, tenantId),
      eq(orders.agentId, agentId),
      inArray(orders.status, REVENUE_ORDER_STATUSES),
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
      eq(salesTargets.periodType, "monthly"),
      // Тот же расчёт, что и у ставки: оклад берётся тот, что действовал
      // в показанном месяце.
      untilDate(salesTargets.periodStart, effectiveOn),
    ))
    .orderBy(desc(salesTargets.periodStart))
    .limit(1);

  const baseSalary = Number(targetRecord?.targetAmount ?? 0);

  const fraudDeduction = Number((baseSalary * (kpi.fraudRate / 100) * 0.5).toFixed(2));

  /*
    Курьеру платят за довезённое, а не за оформленное.

    Агентский расчёт для него бессмыслен во всех трёх слагаемых: комиссия
    считается процентом от заказов, которые человек ОФОРМИЛ (у курьера их нет —
    orders.agentId пуст), премия — от оценки по визитам и планам, которых ему
    не ставят, а вычет за подозрительные визиты вычитает за то, чего он не
    делает. На экране это выглядело как «оклад и три нуля».

    Решение владельца: фиксированная сумма за каждую довезённую заявку, срывы
    ничего не вычитают — они видны в показателях, но платят за факт.
  */
  const [whoIs] = await db.select({ role: users.role })
    .from(users).where(eq(users.id, agentId)).limit(1);
  const isCourier = whoIs?.role === "courier";

  const courier = isCourier && deliveryRate > 0
    ? await calculateCourierStats(db, agentId, tenantId, periodStart, periodEnd)
    : null;

  const deliveredCount = courier?.delivered ?? 0;
  const deliveryPay = Number((deliveredCount * deliveryRate).toFixed(2));

  const totalSalary = isCourier
    ? Math.max(0, baseSalary + deliveryPay)
    : Math.max(0, baseSalary + commissionAmount + bonusAmount - fraudDeduction);

  const periodLabel = `${periodStart.toISOString().slice(0, 10)} — ${periodEnd.toISOString().slice(0, 10)}`;

  const [agent] = preloadedKpi ? [{ name: preloadedKpi.agentName }] : await db.select({ name: sql<string>`name` })
    .from(users)
    .where(eq(users.id, agentId))
    .limit(1);

  // Auto-persist commission record to DB — only for the canonical monthly
  // view, and only while the record is still a draft. A record already
  // "approved" or "paid" has been signed off on; simply opening the salary
  // screen again must not silently rewrite figures finance already acted on.
  // `period_start`/`period_end` are `date` columns, so drizzle types them as
  // Date, but commission-router keys the period by this "YYYY-MM-DD" string —
  // handing the driver a Date instead would shift the stored day by the
  // server's UTC offset and stop the two ever matching.
  const monthStart = periodStart.toISOString().slice(0, 10);
  const monthEnd = periodEnd.toISOString().slice(0, 10);

  // Курьеру строку комиссии не пишем: salesAmount и commissionAmount у него
  // нулевые по определению, и запись означала бы «комиссия ноль» вместо
  // «комиссии нет».
  if (persist && !isCourier) {
    try {
      // Проверка и запись — В ОДНОЙ ТРАНЗАКЦИИ, под блокировкой строки.
      //
      // Это чтение и эта вставка стояли просто подряд, вне транзакции, и
      // запускались из обычного GET. Супервайзер открывал «Отчёт по зарплате»
      // ровно тогда, когда агент открывал свой экран зарплаты (или React Query
      // делал рефетч) — оба запроса не видели строки за текущий месяц и оба её
      // вставляли. У агента появлялись ДВЕ строки за один период с одинаковыми
      // суммами; проверки на дубль периода нет нигде, поэтому оператор
      // одобрял и оплачивал обе, и комиссия уходила агенту дважды.
      //
      // SELECT ... FOR UPDATE по (user_id, period_type, period_start) идёт по
      // idx_commissions_user_period. InnoDB в REPEATABLE READ берёт на этот
      // диапазон next-key lock, то есть держит и сам промежуток: вторая
      // транзакция со своим SELECT ... FOR UPDATE ждёт первую и после её
      // фиксации уже видит созданную строку — и уходит в ветку обновления
      // сумм вместо второй вставки.
      await db.transaction(async (tx) => {
        // Строка ИМЕННО за этот период, а не «последняя строка агента».
        //
        // Раньше запись выбиралась выше — последней по periodStart, без фильтра
        // периода, — и блок ниже переписывал её под текущий месяц вместе с
        // periodStart/periodEnd. Первого августа агент (или супервайзер через
        // salaryReport) открывал экран зарплаты, и июльская строка со статусом
        // pending и комиссией 2 500 000 превращалась в августовскую с почти
        // нулевыми числами. История выплат не существовала: строк по агенту
        // физически не могло быть больше одной. И всё это — от обычного открытия
        // экрана, без единой мутации.
        //
        // Вторая половина той же беды: ветка INSERT срабатывала, только когда
        // записи не было ВООБЩЕ. Как только единственная строка получала статус
        // approved или paid, внешнее условие переставало пропускать блок, и новые
        // месяцы не создавались никогда — нормальное завершение первого
        // расчётного месяца молча выключало учёт комиссий этого агента.
        const [periodRecord] = await tx.select({
          id: commissions.id,
          status: commissions.status,
        }).from(commissions)
          .where(and(
            eq(commissions.tenantId, tenantId),
            eq(commissions.userId, agentId),
            eq(commissions.periodType, "monthly"),
            sql`${commissions.periodStart} = ${monthStart}`,
          ))
          .for("update")
          .limit(1);

        if (!periodRecord) {
          // Строки за этот период нет — создаём, независимо от того, в каком
          // состоянии строки за прошлые месяцы.
          if (commissionRate > 0) {
            await tx.insert(commissions).values({
              tenantId,
              userId: agentId,
              commissionRate: commissionRate.toFixed(2),
              periodType: "monthly",
              periodStart: sql`${monthStart}`,
              periodEnd: sql`${monthEnd}`,
              salesAmount: salesAmount.toFixed(2),
              commissionAmount: commissionAmount.toFixed(2),
            });
          }
        } else if (periodRecord.status === "pending") {
          // Черновик за текущий период — обновляем только суммы. Границы периода
          // не трогаем: строка уже принадлежит этому месяцу, а их перезапись и
          // была способом угробить предыдущий.
          await tx.update(commissions)
            .set({
              salesAmount: salesAmount.toFixed(2),
              commissionAmount: commissionAmount.toFixed(2),
            })
            .where(and(eq(commissions.id, periodRecord.id), eq(commissions.status, "pending")));
        }
        // approved / paid за этот период — финансы уже подписали, не трогаем.
      });
    } catch (e) {
      // Commission persistence is non-critical but should be logged
      logger.warn("Failed to persist commission", { agentId, error: String(e) });
    }
  }

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
    deliveryRate,
    deliveredCount,
    deliveryPay,
    totalSalary,
    breakdown: {
      base: baseSalary,
      // У курьера комиссии, премии и вычета нет — не «ноль по ошибке», а не
      // применимо. Экран по этим нулям и понимает, что разбивка курьерская.
      commission: isCourier ? 0 : commissionAmount,
      bonus: isCourier ? 0 : bonusAmount,
      fraudDeduction: isCourier ? 0 : -fraudDeduction,
      delivery: deliveryPay,
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

/**
 * Балл агента: состав минус штраф за подозрительные визиты.
 *
 * Одна функция на оба экрана. Пока штраф стоял только в карточке, список
 * агентов показывал тому же человеку другой балл — и объяснить эту разницу
 * было нечем: обе цифры назывались «Балл».
 *
 * Долю фрода экраны оценивают по-разному (карточка разбирает каждый визит,
 * список смотрит только на наличие GPS-следов), и это осознанно: полный
 * разбор на список — сотни запросов. Но ФОРМУЛА одна.
 */
export function kpiScoreOf(metrics: {
  visitCompletion: number;
  revenue: number;
  conversion: number;
  returnRate: number;
  debtCollection: number;
}, fraudRate: number): number {
  return Math.max(0, calculateCompositeScore(metrics) - fraudRate * FRAUD_PENALTY_WEIGHT);
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

  const [orderRows, planRows, returnRows, fraudRows, shopDebtRows, returnedMoneyRows] = await Promise.all([
    db.select({
      agentId: orders.agentId,
      orderCount: sql<number>`count(*)`,
      revenue: sql<string>`COALESCE(SUM(CAST(total AS DECIMAL(15,2))), 0)`,
    }).from(orders)
      .where(and(
        // Через тот же помощник, что и карточка агента: он несёт и фильтр
        // удалённых заказов, которого здесь не было. Мягко удалённый заказ
        // попадал в выручку списка и не попадал в карточку — две страницы
        // одного продукта показывали разные цифры по одному человеку, и на
        // списочной считался балл KPI.
        ...revenueOrderConditions(tenantId),
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

    // Shop debt per agent
    db.select({
      agentId: shops.agentId,
      totalDebt: sql<string>`COALESCE(SUM(CAST(${shops.debt} AS DECIMAL(15,2))), 0)`,
    }).from(shops)
      .where(and(
        eq(shops.tenantId, tenantId),
        eq(shops.status, "active"),
        inArray(shops.agentId, agentIds),
      )).groupBy(shops.agentId),

    /*
      Завершённые возвраты — их вычитает карточка агента, а список нет.

      Из-за этого один и тот же человек в списке продавал больше, чем в
      своей карточке, и балл KPI считался с этой завышенной выручки. Тот же
      класс беды, что уже ловили с мягко удалёнными заказами.
    */
    db.select({
      agentId: orders.agentId,
      returned: sql<string>`COALESCE(SUM(${returns.totalAmount}), 0)`,
    }).from(returns)
      .innerJoin(orders, eq(returns.orderId, orders.id))
      .where(and(
        eq(returns.tenantId, tenantId),
        eq(returns.status, "completed"),
        isNull(orders.deletedAt),
        gte(orders.createdAt, periodStart),
        lte(orders.createdAt, periodEnd),
        inArray(orders.agentId, agentIds),
      )).groupBy(orders.agentId),
  ]);

  const orderMap = new Map(orderRows.map(r => [r.agentId, r]));
  const planMap = new Map(planRows.map(r => [r.agentId, r]));
  const returnMap = new Map(returnRows.map(r => [r.agentId, r]));
  const gpsMap = new Map(fraudRows.map(r => [r.agentId, r]));
  const debtMap = new Map(shopDebtRows.map(r => [r.agentId, r]));
  const returnedMoneyMap = new Map(returnedMoneyRows.map(r => [r.agentId, r]));

  return agents.map((agent) => {
    const orders = orderMap.get(agent.agentId);
    const plans = planMap.get(agent.agentId);
    const rets = returnMap.get(agent.agentId);
    const gps = gpsMap.get(agent.agentId);

    const orderCount = Number(orders?.orderCount ?? 0);
    // За вычетом возвращённого — ровно как в карточке агента.
    const revenue = Math.max(0, Number(orders?.revenue ?? 0) - Number(returnedMoneyMap.get(agent.agentId)?.returned ?? 0));
    const totalPlans = Number(plans?.totalPlans ?? 0);
    const visitedPlans = Number(plans?.visitedPlans ?? 0);
    const returnCount = Number(rets?.returnCount ?? 0);

    const visitCompletionRate = totalPlans > 0 ? Math.round((visitedPlans / totalPlans) * 100) : 0;
    const returnRate = orderCount > 0 ? Math.round((returnCount / orderCount) * 100) : 0;
    const conversion = orderCount > 0 && totalPlans > 0 ? Math.round((orderCount / totalPlans) * 100) : 0;
    const gpsPings = Number(gps?.gpsCount ?? 0);
    const totalDebt = Number(debtMap.get(agent.agentId)?.totalDebt ?? 0);
    const totalOwed = revenue + totalDebt;
    const debtCollection = totalOwed > 0 ? Math.round((revenue / totalOwed) * 100) : 100;

    const suspiciousVisits = gpsPings === 0 && visitedPlans > 0 ? visitedPlans : 0;
    const fraudRate = visitedPlans > 0 ? Math.round((suspiciousVisits / visitedPlans) * 100) : 0;

    /*
      Штраф за фрод — как в карточке: там балл считается тем же составом
      минус fraudRate × 0.3, и без штрафа список показывал один балл, а
      карточка того же человека — другой.

      Сама доля фрода здесь оценивается грубее: карточка разбирает каждый
      визит (расстояние до точки, дубли, время фото), а список — только по
      наличию GPS-следов за период, иначе на каждое открытие уходили бы
      сотни запросов. Поэтому числа сходятся не всегда, но считаются одной
      формулой из того, что показано рядом.
    */
    const kpiScore = kpiScoreOf({
      visitCompletion: visitCompletionRate,
      revenue,
      conversion,
      returnRate: 100 - returnRate, // invert: higher is better
      debtCollection,
    }, fraudRate);

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
