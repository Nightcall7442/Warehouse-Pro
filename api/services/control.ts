import { and, eq, gte, lt, isNull, isNotNull, inArray, desc, sql } from "drizzle-orm";
import { orders, shops, users, settings, auditLog } from "@db/schema";
import { badRequest } from "../lib/errors";
import { sanitizeString } from "../lib/sanitize";

/*
  Контроль.

  ── Слово магазина ─────────────────────────────────────────────────────────

  Всё, что знает система о доставке, записал сотрудник. Контроль добавляет
  вторую сторону: по ссылке из чека (QR на ленте, ссылка в мессенджере)
  магазин сам говорит «получил» или «не сходится» — и пишет, что именно.
  Подтверждённая доставка спорить не о чем. Спорная — директору в Telegram
  сразу и балл риска тому, кто её провёл. Слово даётся один раз: второе
  нажатие ничего не меняет — переиграть «не сходится» в «получил» нельзя.

  ── Индекс риска ───────────────────────────────────────────────────────────

  Не «вор / не вор», а «куда смотреть сначала». Баллы за то, что уже лежит
  в учёте: недостачи при расчёте заказов, наличные на руках дольше суток,
  безнал без выписки, спорные и неподтверждённые доставки,
  возвраты, заказы, переигранные после доставки, скидки в каждом втором
  заказе, подозрительные визиты. Каждый балл объясним одной строкой и
  ведёт к документу. Веса — в RISK; чистая функция riskScore — под стражем.
*/

type Db = ReturnType<typeof import("../queries/connection").getDb>;
const round2 = (n: number) => Math.round(n * 100) / 100;
const HOUR = 3_600_000;
const CONTROL_PLANS = new Set(["trial", "pro", "exclusive"]);
export const FIELD_ROLES = ["agent", "courier", "merchandiser", "supervisor"] as const;

export function planAllowsControl(plan: string): boolean {
  return CONTROL_PLANS.has(plan);
}

export async function controlEnabled(db: Db, tenantId: number): Promise<boolean> {
  const [row] = await db.select({ on: settings.controlEnabled }).from(settings).where(eq(settings.tenantId, tenantId)).limit(1);
  return Boolean(row?.on);
}

export async function assertControl(db: Db, tenantId: number, plan: string): Promise<void> {
  if (!planAllowsControl(plan)) throw badRequest("Контроль доступен на тарифах Pro и Exclusive");
  if (!(await controlEnabled(db, tenantId))) throw badRequest("Контроль выключен — включите его в Настройках");
}

/* ── Слово магазина ──────────────────────────────────────────────────────── */

export type ShopWordState = "none" | "confirmed" | "disputed";
export const shopWordOf = (o: { shopConfirmedAt: Date | null; shopDisputedAt: Date | null }): ShopWordState =>
  o.shopDisputedAt ? "disputed" : o.shopConfirmedAt ? "confirmed" : "none";

/**
 * Магазин по ссылке из чека сказал своё слово. Только по доставленному
 * заказу и только при включённом контроле; повтор — тишина, не перезапись.
 */
export async function shopWord(db: Db, orderId: number, input: { action: "confirm" | "dispute"; note?: string | null; now?: Date }) {
  const now = input.now ?? new Date();
  const [o] = await db.select({
    id: orders.id, tenantId: orders.tenantId, number: orders.orderNumber, status: orders.status, shopId: orders.shopId, courierId: orders.courierId,
    shopConfirmedAt: orders.shopConfirmedAt, shopDisputedAt: orders.shopDisputedAt, total: orders.total,
  }).from(orders).where(and(eq(orders.id, orderId), isNull(orders.deletedAt))).limit(1);
  if (!o) throw badRequest("Такого заказа нет");
  if (!(await controlEnabled(db, o.tenantId))) throw badRequest("Подтверждение доставки у этого поставщика не включено");
  if (o.status !== "delivered") throw badRequest("Подтвердить можно только доставленный заказ");
  const current = shopWordOf(o);
  if (current !== "none") return { state: current, changed: false };
  const note = input.action === "dispute" ? sanitizeString(input.note ?? "").slice(0, 300) : "";
  if (input.action === "dispute" && !note) throw badRequest("Напишите, что именно не сходится");
  await db.update(orders).set(input.action === "confirm" ? { shopConfirmedAt: now } : { shopDisputedAt: now, shopDisputeNote: note }).where(eq(orders.id, o.id));
  const [shop] = await db.select({ name: shops.name }).from(shops).where(eq(shops.id, o.shopId)).limit(1);
  const { recordAudit } = await import("./audit-log");
  await recordAudit(db, {
    tenantId: o.tenantId, actorName: `Магазин «${shop?.name ?? "?"}»`, action: input.action === "confirm" ? "control.shop_confirmed" : "control.shop_disputed",
    targetType: "order", targetId: o.id, targetLabel: o.number, meta: input.action === "dispute" ? { note } : {},
  });
  if (input.action === "dispute") {
    const [courier] = o.courierId ? await db.select({ name: users.name }).from(users).where(eq(users.id, o.courierId)).limit(1) : [null];
    const { notifyTenantRole } = await import("../lib/telegram");
    await notifyTenantRole(o.tenantId, "ceo", `⚠️ Магазин «${shop?.name ?? "?"}» оспорил доставку ${o.number} на ${Math.round(Number(o.total)).toLocaleString("ru-RU")}${courier ? ` (доставил ${courier.name})` : ""}:\n«${note}»`).catch(() => undefined);
  }
  return { state: input.action === "confirm" ? "confirmed" as const : "disputed" as const, changed: true };
}

/* ── Индекс риска ────────────────────────────────────────────────────────── */

/** Веса — одно место. Балл за фактор не растёт бесконечно: у каждого потолок. */
export const RISK = {
  shortage:    { each: 15, cap: 45 },  // недостачи при закрытии заказов за срок (заказов)
  cashLate:    { points: 15, hours: 24 }, // наличные на руках дольше суток
  nonCash:     { base: 10, each: 2, cap: 20 }, // безнал без выписки дольше срока
  dispute:     { each: 20, cap: 40 },
  unconfirmed: { points: 10, share: 0.5, min: 5, hours: 48 }, // доставки без слова магазина
  reopened:    { each: 5, cap: 20 },   // заказ переигран после доставки
  returns:     { points: 10, share: 0.2, min: 3 },
  discounts:   { points: 10, share: 0.5, min: 5 },
  visits:      { points: 15, share: 0.3, min: 5 }, // подозрительные визиты (GPS, длительность)
  levels:      { watch: 25, act: 60 },
} as const;

export type RiskCode = "shortage" | "cashLate" | "nonCash" | "dispute" | "unconfirmed" | "reopened" | "returns" | "discounts" | "visits";
export interface RiskFactor { code: RiskCode; points: number; count?: number; money?: number; share?: number; hours?: number }
export type RiskLevel = "calm" | "watch" | "act";

export interface RiskSignals {
  shortageCount: number; shortageMoney: number;
  /** Наличные на руках и с какого момента самая старая запись. */
  onHand: number; onHandSince: Date | null;
  nonCashOverdueCount: number; nonCashOverdueMoney: number;
  delivered: number; deliveredOld: number; unconfirmed: number; disputed: number;
  reopened: number; returned: number;
  agentOrders: number; discounted: number;
  visits: number; suspiciousVisits: number;
}

export const levelOf = (score: number): RiskLevel => (score >= RISK.levels.act ? "act" : score >= RISK.levels.watch ? "watch" : "calm");

/** Чистая функция: сигналы → баллы с объяснением. Порядок факторов — по весу. */
export function riskScore(s: RiskSignals, now: Date): { score: number; level: RiskLevel; factors: RiskFactor[] } {
  const f: RiskFactor[] = [];
  if (s.disputed > 0) f.push({ code: "dispute", points: Math.min(RISK.dispute.cap, s.disputed * RISK.dispute.each), count: s.disputed });
  if (s.shortageCount > 0) f.push({ code: "shortage", points: Math.min(RISK.shortage.cap, s.shortageCount * RISK.shortage.each), count: s.shortageCount, money: round2(s.shortageMoney) });
  if (s.onHand > 0 && s.onHandSince) {
    const hours = (now.getTime() - s.onHandSince.getTime()) / HOUR;
    if (hours > RISK.cashLate.hours) f.push({ code: "cashLate", points: RISK.cashLate.points, money: round2(s.onHand), hours: Math.floor(hours) });
  }
  if (s.nonCashOverdueCount > 0) f.push({ code: "nonCash", points: Math.min(RISK.nonCash.cap, RISK.nonCash.base + s.nonCashOverdueCount * RISK.nonCash.each), count: s.nonCashOverdueCount, money: round2(s.nonCashOverdueMoney) });
  if (s.reopened > 0) f.push({ code: "reopened", points: Math.min(RISK.reopened.cap, s.reopened * RISK.reopened.each), count: s.reopened });
  if (s.deliveredOld >= RISK.unconfirmed.min && s.unconfirmed / s.deliveredOld >= RISK.unconfirmed.share) f.push({ code: "unconfirmed", points: RISK.unconfirmed.points, count: s.unconfirmed, share: round2(s.unconfirmed / s.deliveredOld) });
  if (s.returned >= RISK.returns.min && s.delivered + s.returned > 0 && s.returned / (s.delivered + s.returned) >= RISK.returns.share) f.push({ code: "returns", points: RISK.returns.points, count: s.returned, share: round2(s.returned / (s.delivered + s.returned)) });
  if (s.agentOrders >= RISK.discounts.min && s.discounted / s.agentOrders >= RISK.discounts.share) f.push({ code: "discounts", points: RISK.discounts.points, count: s.discounted, share: round2(s.discounted / s.agentOrders) });
  if (s.visits >= RISK.visits.min && s.suspiciousVisits / s.visits >= RISK.visits.share) f.push({ code: "visits", points: RISK.visits.points, count: s.suspiciousVisits, share: round2(s.suspiciousVisits / s.visits) });
  f.sort((a, b) => b.points - a.points);
  const score = Math.min(100, f.reduce((t, x) => t + x.points, 0));
  return { score, level: levelOf(score), factors: f };
}

export const ControlService = {
  /** Индекс риска по каждому полевому сотруднику за срок; спорные и неподтверждённые — сводкой. */
  async overview(db: Db, tenantId: number, input: { from: Date; to: Date }, now = new Date()) {
    const { OrderCloseService } = await import("./order-close");
    const { NonCashService } = await import("./noncash");
    const { calculateFraudMetrics } = await import("./anti-fraud");
    const oldEdge = new Date(now.getTime() - RISK.unconfirmed.hours * HOUR);
    const [people, hands, nonCash, ords, reopens, shortages] = await Promise.all([
      db.select({ id: users.id, name: users.name, role: users.role }).from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.status, "active"), inArray(users.role, [...FIELD_ROLES]))),
      OrderCloseService.onHands(db, tenantId),
      NonCashService.summary(db, tenantId, now),
      db.select({
        courierId: orders.courierId, agentId: orders.agentId, status: orders.status, deliveredAt: orders.deliveredAt, createdAt: orders.createdAt,
        confirmed: orders.shopConfirmedAt, disputed: orders.shopDisputedAt, discount: orders.discount,
      }).from(orders).where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt), gte(orders.createdAt, input.from), lt(orders.createdAt, input.to))),
      db.select({ actorId: auditLog.actorId, n: sql<number>`count(*)` }).from(auditLog)
        .where(and(eq(auditLog.tenantId, tenantId), inArray(auditLog.action, ["order.reopened", "order.revenue_reversed"]), gte(auditLog.createdAt, input.from), lt(auditLog.createdAt, input.to), isNotNull(auditLog.actorId)))
        .groupBy(auditLog.actorId),
      db.select({ userId: orders.shortageUserId, n: sql<number>`count(*)`, s: sql<number>`coalesce(sum(${orders.courierShortage}), 0)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), sql`${orders.courierShortage} > 0`, isNotNull(orders.closedAt), gte(orders.closedAt, input.from), lt(orders.closedAt, input.to)))
        .groupBy(orders.shortageUserId),
    ]);
    const holder = new Map(hands.map(h => [h.userId, h]));
    const bank = new Map(nonCash.byEmployee.map(e => [e.id, e]));
    const reopened = new Map(reopens.map(r => [Number(r.actorId), Number(r.n)]));
    const short = new Map(shortages.map(r => [Number(r.userId), { n: Number(r.n), s: Number(r.s) }]));
    const fraud = new Map<number, { visits: number; suspicious: number }>();
    await Promise.all(people.filter(p => p.role === "agent").map(async p => {
      try { const m = await calculateFraudMetrics(db, p.id, tenantId, input.from, input.to); fraud.set(p.id, { visits: m.totalVisits, suspicious: m.suspiciousVisits }); }
      catch { fraud.set(p.id, { visits: 0, suspicious: 0 }); }
    }));

    const employees = people.map(p => {
      const mine = ords.filter(o => o.courierId === p.id);
      const delivered = mine.filter(o => o.status === "delivered");
      const old = delivered.filter(o => o.deliveredAt && o.deliveredAt < oldEdge);
      const agentOrders = ords.filter(o => o.agentId === p.id && o.status !== "cancelled");
      const h = holder.get(p.id), b = bank.get(p.id), sh = short.get(p.id), fr = fraud.get(p.id);
      const signals: RiskSignals = {
        shortageCount: sh?.n ?? 0, shortageMoney: sh?.s ?? 0,
        onHand: h?.amount ?? 0, onHandSince: h?.since ?? null,
        nonCashOverdueCount: b?.overdueCount ?? 0, nonCashOverdueMoney: b?.overdueTotal ?? 0,
        delivered: delivered.length, deliveredOld: old.length, unconfirmed: old.filter(o => !o.confirmed && !o.disputed).length, disputed: mine.filter(o => o.disputed).length,
        reopened: reopened.get(p.id) ?? 0, returned: mine.filter(o => o.status === "returned").length,
        agentOrders: agentOrders.length, discounted: agentOrders.filter(o => Number(o.discount) > 0).length,
        visits: fr?.visits ?? 0, suspiciousVisits: fr?.suspicious ?? 0,
      };
      const r = riskScore(signals, now);
      return { id: p.id, name: p.name, role: p.role, ...r, delivered: delivered.length, confirmed: delivered.filter(o => o.confirmed).length, disputed: signals.disputed, unconfirmed: signals.unconfirmed, onHand: signals.onHand, shortage: signals.shortageMoney };
    }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ru"));

    const deliveredAll = ords.filter(o => o.status === "delivered");
    return {
      employees,
      totals: {
        disputed: ords.filter(o => o.disputed).length,
        unconfirmed: deliveredAll.filter(o => o.deliveredAt && o.deliveredAt < oldEdge && !o.confirmed && !o.disputed).length,
        confirmed: deliveredAll.filter(o => o.confirmed).length,
        delivered: deliveredAll.length,
        atRisk: employees.filter(e => e.level !== "calm").length,
      },
    };
  },

  /** Спорные доставки за срок — что сказал магазин и кто вёз. */
  async disputes(db: Db, tenantId: number, input: { from: Date; to: Date }) {
    const rows = await db.select({
      id: orders.id, number: orders.orderNumber, total: orders.total, deliveredAt: orders.deliveredAt, disputedAt: orders.shopDisputedAt, note: orders.shopDisputeNote,
      shopId: orders.shopId, shopName: shops.name, courierId: orders.courierId, courierName: users.name,
    }).from(orders).innerJoin(shops, eq(shops.id, orders.shopId)).leftJoin(users, eq(users.id, orders.courierId))
      .where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt), isNotNull(orders.shopDisputedAt), gte(orders.shopDisputedAt, input.from), lt(orders.shopDisputedAt, input.to)))
      .orderBy(desc(orders.shopDisputedAt)).limit(200);
    return rows.map(r => ({ ...r, total: Number(r.total) }));
  },
};
