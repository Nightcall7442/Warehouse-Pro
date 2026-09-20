import { and, eq, isNull, isNotNull, inArray, asc, gte, lt, sql } from "drizzle-orm";
import { orders, payments, users, shops } from "@db/schema";
import { badRequest } from "../lib/errors";
import { sanitizeString } from "../lib/sanitize";
import { notifyTenantRole, tgEscape, fmtMoney } from "../lib/telegram";
import { recordAudit } from "./audit-log";
import { recalcShopDebt } from "./shop-debt";
import { tiyin } from "./order-shared";

/*
  РАСЧЁТ ПО ЗАКАЗУ — вместо кассы.

  ── Что было ────────────────────────────────────────────────────────────────

  Касса: двойная запись, документы, смены, PIN, категории. Владелец
  (18.09.2026): «касса тоже надо убрать; доработай работу с заказами, чтобы
  там можно было рассчитать деньги — до получения физических денег заказ не
  закроется, или долг. Доставщик вернулся, дал 1 200 000 за заказ 1534 —
  заказ закрыть можно».

  ── Что стало ───────────────────────────────────────────────────────────────

  Деньги живут в заказе. Доставленный заказ ЖДЁТ РАСЧЁТА, пока офис не
  закроет его: пересчитал наличные из рук курьера, отметил карту/перевод,
  и остаток — либо ноль, либо явно оставлен ДОЛГОМ магазина. Тогда
  orders.closed_at. Очередь «ждут расчёта» — то, с чем оператор работает
  вечером.

  Наличный платёж, записанный в поле (курьер при доставке, агент при сборе
  долга), — это ЗАЯВЛЕНО: деньги на руках. Офис при закрытии вводит одно
  число — сколько получил. Меньше заявленного — разница остаётся на курьере
  НЕДОСТАЧЕЙ (магазин-то заплатил) и уходит в удержание из зарплаты, как
  раньше недостача по кассе. Больше — лишнее ложится платежом офиса на тот
  же заказ, в пределах его суммы. Платёж, записанный офисом, получен сразу.

  Карта и перевод — обещание, а не деньги: закрытию не мешают, но остаются
  «в пути», пока банк (выписка из 1С или кассир) не подтвердит
  (services/noncash.ts, payments.bank_confirmed_at).

  Полевой наличный платёж по уже закрытому заказу открывает расчёт заново
  (applyPartialPayment снимает closed_at): агент собрал старый долг — эти
  деньги тоже надо принять.
*/

type Db = ReturnType<typeof import("../queries/connection").getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Actor = { id: number; name: string; role: string };

/** Роли, у которых записанные наличные — уже в офисе, а не «на руках». */
export const OFFICE_ROLES = new Set(["ceo", "operator", "superadmin"]);
export const isOffice = (role: string) => OFFICE_ROLES.has(role);

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CloseInput {
  orderId: number;
  /** Сколько наличных офис получил сейчас — одно число, сверяется с заявленным. */
  cashReceived: number;
  /** Ещё принято офисом картой/переводом (или наличными сверх заявленного — тоже сюда можно). */
  extra?: Array<{ method: "cash" | "card" | "transfer"; amount: number }>;
  /** Остаток оставить долгом магазина. Без этого заказ с остатком не закрывается. */
  acceptDebt?: boolean;
  debtDueDate?: string;
  note?: string;
}

/**
 * Арифметика закрытия — чистая, под стражем.
 *
 *   claimed      — заявлено полевыми наличными и ещё не получено;
 *   cashReceived — получено офисом сейчас;
 *   paidBefore   — все платежи по заказу до закрытия;
 *   extra        — принято офисом сверх этого (карта, перевод, наличные).
 */
export function closeMath(m: { total: number; claimed: number; cashReceived: number; paidBefore: number; extra: number }) {
  if (!(m.cashReceived >= 0) || !(m.extra >= 0)) throw badRequest("Сумма не может быть отрицательной");
  const shortage = round2(Math.max(0, m.claimed - m.cashReceived));
  const surplusCash = round2(Math.max(0, m.cashReceived - m.claimed));
  const added = round2(surplusCash + m.extra);
  if (tiyin(m.paidBefore) + tiyin(added) > tiyin(m.total)) {
    throw badRequest(`Принято больше суммы заказа: по заказу ${fmtMoney(m.total)}, уже записано ${fmtMoney(m.paidBefore)}`);
  }
  const remainder = round2(Math.max(0, m.total - m.paidBefore - added));
  return { shortage, surplusCash, added, remainder };
}

const live = (tenantId: number, orderId: number) => and(
  eq(payments.tenantId, tenantId), eq(payments.orderId, orderId), eq(payments.type, "payment"),
  isNull(payments.reversalOf), sql`${payments.status} <> 'reversed'`,
);

async function paymentRows(db: Db | Tx, tenantId: number, orderId: number) {
  return db.select({
    id: payments.id, amount: payments.amount, method: payments.paymentMethod, status: payments.status, type: payments.type,
    reversalOf: payments.reversalOf, receivedAt: payments.receivedAt, bankConfirmedAt: payments.bankConfirmedAt, bankRef: payments.bankRef,
    notes: payments.notes, createdAt: payments.createdAt, paidAt: payments.paidAt,
    createdBy: payments.createdBy, createdByName: users.name, createdByRole: users.role,
  }).from(payments)
    .leftJoin(users, eq(users.id, payments.createdBy))
    .where(and(eq(payments.tenantId, tenantId), eq(payments.orderId, orderId)))
    .orderBy(asc(payments.createdAt), asc(payments.id));
}

type Row = Awaited<ReturnType<typeof paymentRows>>[number];
const isLive = (p: Row) => p.type === "payment" && p.reversalOf == null && p.status !== "reversed";
/** Заявлено полем и не получено: наличные на руках. Сторно-пары учтены суммой. */
export function onHandsOf(rows: Row[]): Row[] {
  const reversed = new Set(rows.filter(r => r.reversalOf != null).map(r => r.reversalOf));
  return rows.filter(r => r.type === "payment" && r.reversalOf == null && !reversed.has(r.id) && r.method === "cash" && r.receivedAt == null);
}

export const OrderCloseService = {
  /** Деньги по заказу одним взглядом: что заявлено, что получено, что в пути, чего не хватает. */
  async money(db: Db, tenantId: number, orderId: number) {
    const [o] = await db.select({
      id: orders.id, number: orders.orderNumber, status: orders.status, total: orders.total, shopId: orders.shopId,
      closedAt: orders.closedAt, closedBy: orders.closedBy, shortage: orders.courierShortage, shortageUserId: orders.shortageUserId, shortageNote: orders.shortageNote,
    }).from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId), isNull(orders.deletedAt))).limit(1);
    if (!o) throw badRequest("Заказ не найден");
    const rows = await paymentRows(db, tenantId, orderId);
    const names = new Map<number, string>();
    const ids = [o.closedBy, o.shortageUserId].filter((x): x is number => x != null);
    if (ids.length) for (const u of await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))) names.set(u.id, u.name);
    const total = Number(o.total);
    const sum = (f: (r: Row) => boolean) => round2(rows.filter(r => r.type === "payment" && f(r)).reduce((t, r) => t + Number(r.amount), 0));
    const paid = sum(() => true); // сторно — отрицательные строки того же типа, суммируются сами
    const onHands = onHandsOf(rows);
    const inTransit = sum(r => isLive(r) && r.method !== "cash" && r.bankConfirmedAt == null);
    const claimed = round2(onHands.reduce((t, r) => t + Number(r.amount), 0));
    return {
      id: o.id, number: o.number, status: o.status, total, paid, remainder: round2(Math.max(0, total - paid)),
      claimed, inTransit, received: round2(paid - claimed - inTransit),
      holders: [...onHands.reduce((m, r) => { const k = r.createdBy ?? 0; m.set(k, { id: k, name: r.createdByName ?? "—", amount: round2((m.get(k)?.amount ?? 0) + Number(r.amount)) }); return m; }, new Map<number, { id: number; name: string; amount: number }>()).values()],
      closedAt: o.closedAt, closedByName: o.closedBy != null ? names.get(o.closedBy) ?? null : null,
      shortage: Number(o.shortage) > 0 ? { amount: Number(o.shortage), userId: o.shortageUserId, userName: o.shortageUserId != null ? names.get(o.shortageUserId) ?? null : null, note: o.shortageNote } : null,
      awaiting: o.status === "delivered" && o.closedAt == null,
      payments: rows.map(r => ({
        id: r.id, amount: Number(r.amount), method: r.method, type: r.type, status: r.status, reversalOf: r.reversalOf,
        receivedAt: r.receivedAt, bankConfirmedAt: r.bankConfirmedAt, bankRef: r.bankRef, notes: r.notes, createdAt: r.createdAt,
        createdByName: r.createdByName, createdByRole: r.createdByRole,
        /** Деньги на месте: наличные приняты офисом, безнал подтверждён банком. */
        settled: r.method === "cash" ? r.receivedAt != null : r.bankConfirmedAt != null,
      })),
    };
  },

  /** Закрыть расчёт: принять наличные, отметить безнал, остаток — долгом или никак. */
  async close(db: Db, tenantId: number, actor: Actor, input: CloseInput, now = new Date()) {
    if (!isOffice(actor.role)) throw badRequest("Закрыть расчёт может только офис");
    const extra = (input.extra ?? []).filter(e => e.amount > 0);
    let result!: { shortage: number; added: number; remainder: number; claimed: number };
    let info!: { number: string; shopId: number; shopName: string; courierName: string | null; total: number };
    let shortageUser: number | null = null;

    await db.transaction(async (tx) => {
      const [o] = await tx.select({
        id: orders.id, number: orders.orderNumber, status: orders.status, total: orders.total, shopId: orders.shopId, courierId: orders.courierId,
        closedAt: orders.closedAt, shopName: shops.name,
      }).from(orders).innerJoin(shops, eq(shops.id, orders.shopId))
        .where(and(eq(orders.tenantId, tenantId), eq(orders.id, input.orderId), isNull(orders.deletedAt))).for("update").limit(1);
      if (!o) throw badRequest("Заказ не найден");
      if (o.status !== "delivered") throw badRequest(`Заказ ${o.number} не доставлен — рассчитывать нечего`);
      if (o.closedAt) throw badRequest(`Заказ ${o.number} уже рассчитан`);

      const rows = await paymentRows(tx, tenantId, o.id);
      const onHands = onHandsOf(rows);
      const claimed = round2(onHands.reduce((t, r) => t + Number(r.amount), 0));
      const paidBefore = round2(rows.filter(r => r.type === "payment").reduce((t, r) => t + Number(r.amount), 0));
      const total = Number(o.total);
      const m = closeMath({ total, claimed, cashReceived: round2(input.cashReceived), paidBefore, extra: round2(extra.reduce((t, e) => t + e.amount, 0)) });

      if (m.remainder > 0 && !input.acceptDebt) {
        throw badRequest(`Остаток ${fmtMoney(m.remainder)}: примите деньги или оставьте его долгом магазина`);
      }

      // Заявленные наличные получены — все: магазин заплатил их курьеру. Разница — на курьере.
      if (onHands.length) {
        await tx.update(payments).set({ receivedAt: now, receivedBy: actor.id })
          .where(and(eq(payments.tenantId, tenantId), inArray(payments.id, onHands.map(r => r.id))));
      }
      // Наличные офиса, записанные ранее без отметки (до этой версии), — получены.
      await tx.update(payments).set({ receivedAt: now, receivedBy: actor.id })
        .where(and(live(tenantId, o.id), eq(payments.paymentMethod, "cash"), isNull(payments.receivedAt)));

      // Принято офисом сверх заявленного — платежи офиса, получены сразу.
      const added: Array<{ method: "cash" | "card" | "transfer"; amount: number }> = [
        ...(m.surplusCash > 0 ? [{ method: "cash" as const, amount: m.surplusCash }] : []), ...extra,
      ];
      let paidSoFar = paidBefore;
      for (const a of added) {
        paidSoFar = round2(paidSoFar + a.amount);
        await tx.insert(payments).values({
          tenantId, shopId: o.shopId, orderId: o.id, amount: a.amount.toFixed(2), type: "payment", paymentMethod: a.method,
          status: tiyin(paidSoFar) >= tiyin(total) ? "paid" : "partially_paid",
          totalOrderAmount: total.toFixed(2), paidAmount: a.amount.toFixed(2), debtAmount: Math.max(0, total - paidSoFar).toFixed(2),
          debtDueDate: input.debtDueDate ? sql`${input.debtDueDate}` : null,
          paidAt: now, notes: input.note ? sanitizeString(input.note) : null, createdBy: actor.id,
          receivedAt: a.method === "cash" ? now : null, receivedBy: a.method === "cash" ? actor.id : null,
        });
      }

      /*
        Недостача — на том, у кого были наличные: заявил их тот, кто записал
        полевой платёж (курьер при доставке или агент при сборе долга).
        Раньше бралась с курьера заказа, даже когда деньги держал агент
        (аудит 20.09.2026). Дата недостачи — своя (shortageAt): «Контроль»
        считал её по closedAt, и заказ, закрытый заново через месяц,
        удерживал ту же недостачу во втором периоде.
      */
      shortageUser = m.shortage > 0 ? (onHands[0]?.createdBy ?? o.courierId ?? null) : null;
      await tx.update(orders).set({
        closedAt: now, closedBy: actor.id,
        ...(m.shortage > 0 ? { courierShortage: m.shortage.toFixed(2), shortageUserId: shortageUser, shortageAt: now, shortageNote: input.note ? sanitizeString(input.note).slice(0, 300) : null } : {}),
      }).where(and(eq(orders.tenantId, tenantId), eq(orders.id, o.id)));
      if (added.length) await recalcShopDebt(tx, tenantId, o.shopId);

      const [courier] = o.courierId ? await tx.select({ name: users.name }).from(users).where(eq(users.id, o.courierId)).limit(1) : [null];
      result = { shortage: m.shortage, added: m.added, remainder: m.remainder, claimed };
      info = { number: o.number, shopId: o.shopId, shopName: o.shopName, courierName: courier?.name ?? null, total };

      await recordAudit(tx as unknown as Db, {
        tenantId, actorId: actor.id, actorName: actor.name, action: "order.closed", targetType: "order", targetId: o.id, targetLabel: `Заказ ${o.number}`,
        meta: { number: o.number, shop: o.shopName, total, claimed, cashReceived: round2(input.cashReceived), added: m.added, shortage: m.shortage, debt: m.remainder, courier: courier?.name ?? null },
      }, { strict: true });
    });

    if (result.shortage > 0) {
      void notifyTenantRole(tenantId, "ceo",
        `⚠️ <b>Недостача ${tgEscape(fmtMoney(result.shortage))}</b>\nЗаказ ${tgEscape(info.number)} · ${tgEscape(info.shopName)}\n` +
        `Заявлено ${tgEscape(fmtMoney(result.claimed))}, сдано ${tgEscape(fmtMoney(input.cashReceived))}${info.courierName ? ` · ${tgEscape(info.courierName)}` : ""}\nПринял: ${tgEscape(actor.name)}`,
      ).catch(() => { /* уведомление — не проводка */ });
    }
    return { ...result, closedAt: now };
  },

  /** Недостачи сотрудника за срок — в удержание из зарплаты (services/kpi.ts) и в индекс риска. */
  async shortageIn(db: Db, tenantId: number, userId: number, from: Date, to: Date): Promise<{ count: number; amount: number }> {
    const [r] = await db.select({ n: sql<number>`count(*)`, s: sql<string>`coalesce(sum(${orders.courierShortage}), 0)` }).from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.shortageUserId, userId), sql`${orders.courierShortage} > 0`, isNotNull(orders.closedAt), gte(orders.closedAt, from), lt(orders.closedAt, to)));
    return { count: Number(r?.n ?? 0), amount: Number(r?.s ?? 0) };
  },

  /** Мои наличные на руках: сколько сдать офису и по скольким заказам. Телефон курьера и агента. */
  async mine(db: Db, tenantId: number, userId: number): Promise<{ amount: number; orders: number; since: Date | null }> {
    const [r] = await db.select({ s: sql<string>`coalesce(sum(${payments.amount}), 0)`, n: sql<number>`count(distinct ${payments.orderId})`, since: sql<Date | null>`min(${payments.createdAt})` })
      .from(payments)
      .where(and(eq(payments.tenantId, tenantId), eq(payments.createdBy, userId), eq(payments.type, "payment"), eq(payments.paymentMethod, "cash"), isNull(payments.receivedAt), isNull(payments.reversalOf), sql`${payments.status} <> 'reversed'`,
        sql`not exists (select 1 from payments r where r.reversal_of = ${payments.id})`));
    const amount = round2(Number(r?.s ?? 0));
    return { amount, orders: amount > 0 ? Number(r?.n ?? 0) : 0, since: amount > 0 && r?.since ? new Date(r.since) : null };
  },

  /** Наличные на руках у полевых: заявлено и не получено, по людям, с самой старой записью. */
  async onHands(db: Db, tenantId: number): Promise<Array<{ userId: number; name: string; amount: number; since: Date }>> {
    const rows = await db.select({ userId: payments.createdBy, name: users.name, s: sql<string>`sum(${payments.amount})`, since: sql<Date>`min(${payments.createdAt})` })
      .from(payments).innerJoin(users, eq(users.id, payments.createdBy))
      .where(and(eq(payments.tenantId, tenantId), eq(payments.type, "payment"), eq(payments.paymentMethod, "cash"), isNull(payments.receivedAt), isNull(payments.reversalOf), sql`${payments.status} <> 'reversed'`,
        sql`not exists (select 1 from payments r where r.reversal_of = ${payments.id})`))
      .groupBy(payments.createdBy, users.name);
    return rows.filter(r => r.userId != null && Number(r.s) > 0).map(r => ({ userId: Number(r.userId), name: r.name, amount: round2(Number(r.s)), since: new Date(r.since) }));
  },
};
