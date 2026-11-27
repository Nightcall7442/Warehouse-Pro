import { inBackground } from "../lib/graceful-shutdown";
import { and, eq, isNull, inArray, asc, gte, lt, sql } from "drizzle-orm";
import { orders, orderShortages, payments, users, shops } from "@db/schema";
import { badRequest } from "../lib/errors";
import { sanitizeString } from "../lib/sanitize";
import { notifyTenantRole, tgEscape, fmtMoney } from "../lib/telegram";
import { recordAudit } from "./audit-log";
import { recalcShopDebt } from "./shop-debt";
import { tiyin, upsertDebtReminder } from "./order-shared";
import { invalidateReports } from "../lib/report-cache";

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
  /**
   * «Принять по заявленному» (вечерняя сдача пачкой, services/order-close-batch.ts):
   * наличные = заявленному, и только если заявленное закрывает остаток ТОЧНО.
   * `claimed` — то, что оператор видел в итоге до нажатия; разошлось — отказ.
   * Проверяется под замком заказа, а не до него: между итогом и нажатием
   * курьер мог записать ещё платёж, и тогда «заявлено» уже другое.
   */
  exactClaim?: { claimed: number };
}

/** Почему заказ не закрывается «по заявленному». Всё в целых тийинах. */
export type ClaimSkipReason = "not_found" | "not_delivered" | "closed" | "no_claim" | "mismatch" | "changed";

/**
 * Можно ли закрыть заказ «по заявленному» — чистое правило, под стражем.
 *
 * Остаток к оплате без заявленного = итог − (всё записанное − заявленное).
 * Заявленное должно быть равно ему до тийина: иначе закрытие дало бы
 * недостачу, излишек или долг — а это решения, которые принимает человек
 * по одному заказу. Сравнение — целыми тийинами, без плавающей точки.
 */
export function claimVerdict(o: { status: string; closed: boolean; totalT: number; paidT: number; claimedT: number }): ClaimSkipReason | null {
  if (o.closed) return "closed";
  if (o.status !== "delivered") return "not_delivered";
  if (o.claimedT <= 0) return "no_claim";
  if (o.totalT - (o.paidT - o.claimedT) !== o.claimedT) return "mismatch";
  return null;
}

/** Отказ «по заявленному» с причиной: пачка пишет его в строку заказа, а не валит всю пачку. */
export class ClaimSkip extends Error {
  readonly reason: ClaimSkipReason;
  readonly number: string | null;
  constructor(reason: ClaimSkipReason, number: string | null) { super(`claim-skip:${reason}`); this.reason = reason; this.number = number; }
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

/*
  Излишек сверх остатка, пришедший с этого заказа (payments.excess_of_order_id).
  Строка без order_id — она гасит долг магазина по другим заказам, — но
  наличные те же: курьер сдаёт их вместе с деньгами заказа (бизнес-аудит
  19.11.2026, п. 18).
*/
async function excessRows(db: Db | Tx, tenantId: number, orderId: number) {
  return db.select({
    id: payments.id, amount: payments.amount, method: payments.paymentMethod, status: payments.status, type: payments.type,
    reversalOf: payments.reversalOf, receivedAt: payments.receivedAt, bankConfirmedAt: payments.bankConfirmedAt, bankRef: payments.bankRef,
    notes: payments.notes, createdAt: payments.createdAt, paidAt: payments.paidAt,
    createdBy: payments.createdBy, createdByName: users.name, createdByRole: users.role,
  }).from(payments)
    .leftJoin(users, eq(users.id, payments.createdBy))
    .where(and(eq(payments.tenantId, tenantId), eq(payments.excessOfOrderId, orderId)))
    .orderBy(asc(payments.createdAt), asc(payments.id));
}
/** Излишек на руках: сторно-пары — по строкам излишка (сторно ссылается на свою строку). */
async function excessOnHands(db: Db | Tx, tenantId: number, orderId: number) {
  const rows = await excessRows(db, tenantId, orderId);
  const ids = rows.map(r => r.id);
  const reversals = ids.length
    ? await db.select({ id: payments.id, type: payments.type, reversalOf: payments.reversalOf, method: payments.paymentMethod, receivedAt: payments.receivedAt })
      .from(payments).where(and(eq(payments.tenantId, tenantId), inArray(payments.reversalOf, ids)))
    : [];
  const pending = onHandsOf([...rows, ...reversals.map(r => ({ ...r }))] as typeof rows).filter(r => ids.includes(r.id));
  return { rows, pending };
}

type Row = Awaited<ReturnType<typeof paymentRows>>[number];
const isLive = (p: Row) => p.type === "payment" && p.reversalOf == null && p.status !== "reversed";
type HandsRow = Pick<Row, "id" | "type" | "reversalOf" | "method" | "receivedAt">;
/** Заявлено полем и не получено: наличные на руках. Сторно-пары учтены суммой. */
export function onHandsOf<R extends HandsRow>(rows: R[]): R[] {
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
    const excess = await excessOnHands(db, tenantId, orderId);
    const names = new Map<number, string>();
    const ids = [o.closedBy, o.shortageUserId].filter((x): x is number => x != null);
    if (ids.length) for (const u of await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))) names.set(u.id, u.name);
    const total = Number(o.total);
    const sum = (f: (r: Row) => boolean) => round2(rows.filter(r => r.type === "payment" && f(r)).reduce((t, r) => t + Number(r.amount), 0));
    const paid = sum(() => true); // сторно — отрицательные строки того же типа, суммируются сами
    const onHands = [...onHandsOf(rows), ...excess.pending];
    const inTransit = sum(r => isLive(r) && r.method !== "cash" && r.bankConfirmedAt == null);
    const claimed = round2(onHands.reduce((t, r) => t + Number(r.amount), 0));
    const excessPending = round2(excess.pending.reduce((t, r) => t + Number(r.amount), 0));
    return {
      id: o.id, number: o.number, status: o.status, total, paid, remainder: round2(Math.max(0, total - paid)),
      claimed, inTransit, received: round2(paid - (claimed - excessPending) - inTransit),
      /** Излишек сверх остатка с этого заказа, ещё не сданный офису. */
      excessPending,
      holders: [...onHands.reduce((m, r) => { const k = r.createdBy ?? 0; m.set(k, { id: k, name: r.createdByName ?? "—", amount: round2((m.get(k)?.amount ?? 0) + Number(r.amount)) }); return m; }, new Map<number, { id: number; name: string; amount: number }>()).values()],
      closedAt: o.closedAt, closedByName: o.closedBy != null ? names.get(o.closedBy) ?? null : null,
      shortage: Number(o.shortage) > 0 ? { amount: Number(o.shortage), userId: o.shortageUserId, userName: o.shortageUserId != null ? names.get(o.shortageUserId) ?? null : null, note: o.shortageNote } : null,
      awaiting: o.status === "delivered" && o.closedAt == null,
      payments: [...rows.map(r => ({ ...r, excess: false })), ...excess.rows.map(r => ({ ...r, excess: true }))].map(r => ({
        id: r.id, amount: Number(r.amount), method: r.method, type: r.type, status: r.status, reversalOf: r.reversalOf,
        receivedAt: r.receivedAt, bankConfirmedAt: r.bankConfirmedAt, bankRef: r.bankRef, notes: r.notes, createdAt: r.createdAt,
        createdByName: r.createdByName, createdByRole: r.createdByRole,
        /** Деньги на месте: наличные приняты офисом, безнал подтверждён банком. */
        settled: r.method === "cash" ? r.receivedAt != null : r.bankConfirmedAt != null,
        /** Излишек сверх остатка: строка магазина, пришедшая с этого заказа. */
        excess: r.excess,
      })),
    };
  },

  /** Закрыть расчёт: принять наличные, отметить безнал, остаток — долгом или никак. */
  async close(db: Db, tenantId: number, actor: Actor, input: CloseInput, now = new Date()) {
    if (!isOffice(actor.role)) throw badRequest("Закрыть расчёт может только офис");
    // По заявленному — ни доплат, ни долга: только заявленное, и только точно.
    const extra = input.exactClaim ? [] : (input.extra ?? []).filter(e => e.amount > 0);
    let result!: { shortage: number; added: number; remainder: number; claimed: number };
    let info!: { number: string; shopId: number; shopName: string; courierName: string | null; total: number };
    let shortageUser: number | null = null;

    await db.transaction(async (tx) => {
      const [o] = await tx.select({
        id: orders.id, number: orders.orderNumber, status: orders.status, total: orders.total, shopId: orders.shopId, courierId: orders.courierId,
        closedAt: orders.closedAt, shopName: shops.name,
      }).from(orders).innerJoin(shops, eq(shops.id, orders.shopId))
        .where(and(eq(orders.tenantId, tenantId), eq(orders.id, input.orderId), isNull(orders.deletedAt))).for("update").limit(1);
      if (!o) throw input.exactClaim ? new ClaimSkip("not_found", null) : badRequest("Заказ не найден");
      if (input.exactClaim && (o.closedAt || o.status !== "delivered")) throw new ClaimSkip(o.closedAt ? "closed" : "not_delivered", o.number);
      if (o.status !== "delivered") throw badRequest(`Заказ ${o.number} не доставлен — рассчитывать нечего`);
      if (o.closedAt) throw badRequest(`Заказ ${o.number} уже рассчитан`);

      const rows = await paymentRows(tx, tenantId, o.id);
      const orderOnHands = onHandsOf(rows);
      // Излишек с этого заказа сдаётся вместе с ним: он в «заявлено», а не мимо.
      const { pending: excessPending } = await excessOnHands(tx, tenantId, o.id);
      const onHands = [...orderOnHands, ...excessPending];
      const claimed = round2(onHands.reduce((t, r) => t + Number(r.amount), 0));
      const paidBefore = round2(rows.filter(r => r.type === "payment").reduce((t, r) => t + Number(r.amount), 0));
      const total = Number(o.total);
      if (input.exactClaim) {
        // Правило «заявлено = остаток» — по самому заказу; излишек сверху сдаётся целиком.
        const claimedT = orderOnHands.reduce((t, r) => t + tiyin(Number(r.amount)), 0);
        const allT = onHands.reduce((t, r) => t + tiyin(Number(r.amount)), 0);
        const paidT = rows.filter(r => r.type === "payment").reduce((t, r) => t + tiyin(Number(r.amount)), 0);
        const why = claimVerdict({ status: o.status, closed: false, totalT: tiyin(total), paidT, claimedT })
          ?? (allT !== tiyin(input.exactClaim.claimed) ? "changed" : null);
        if (why) throw new ClaimSkip(why, o.number);
      }
      const cashReceived = input.exactClaim ? claimed : round2(input.cashReceived);
      const m = closeMath({ total, claimed, cashReceived, paidBefore, extra: round2(extra.reduce((t, e) => t + e.amount, 0)) });

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
      /*
        Каждая недостача — своей строкой (order_shortages). Заказ, который
        вернули в работу и закрыли снова с новой недостачей, перезаписывал
        первую: из «Контроля» и удержания из зарплаты пропадали её деньги
        (бизнес-аудит 19.11.2026). В заказе — сумма всех недостач и последняя
        из них: это карточка заказа, а считают по таблице.
      */
      shortageUser = m.shortage > 0 ? (onHands[0]?.createdBy ?? o.courierId ?? null) : null;
      const shortageNote = input.note ? sanitizeString(input.note).slice(0, 300) : null;
      if (m.shortage > 0) {
        await tx.insert(orderShortages).values({
          tenantId, orderId: o.id, userId: shortageUser, amount: m.shortage.toFixed(2), note: shortageNote, recordedBy: actor.id, createdAt: now,
        });
      }
      await tx.update(orders).set({
        closedAt: now, closedBy: actor.id,
        ...(m.shortage > 0 ? { courierShortage: sql`${orders.courierShortage} + ${m.shortage.toFixed(2)}`, shortageUserId: shortageUser, shortageAt: now, shortageNote } : {}),
      }).where(and(eq(orders.tenantId, tenantId), eq(orders.id, o.id)));
      // Всегда: принятые сейчас наличные гасят долг магазина только с этой минуты.
      await recalcShopDebt(tx, tenantId, o.shopId);

      /*
        Остаток в долг со сроком — в напоминание заказа, в этой же сделке.

        Срок писался только в новые строки платежей (наличные сверх
        заявленного, «Ещё принято»). В обычном случае — курьер сдал часть,
        остаток в долг, доплаты нет — строк не было, и введённый «Срок»
        пропадал: ни напоминания, ни просрочки. Напоминание курьера по этому
        заказу не дублируется, а получает новую сумму и срок.
      */
      if (input.acceptDebt && m.remainder > 0 && input.debtDueDate) {
        await upsertDebtReminder(tx, tenantId, { shopId: o.shopId, orderId: o.id, amount: m.remainder.toFixed(2), dueDate: input.debtDueDate });
      }

      const [courier] = o.courierId ? await tx.select({ name: users.name }).from(users).where(eq(users.id, o.courierId)).limit(1) : [null];
      result = { shortage: m.shortage, added: m.added, remainder: m.remainder, claimed };
      info = { number: o.number, shopId: o.shopId, shopName: o.shopName, courierName: courier?.name ?? null, total };

      await recordAudit(tx as unknown as Db, {
        tenantId, actorId: actor.id, actorName: actor.name, action: "order.closed", targetType: "order", targetId: o.id, targetLabel: `Заказ ${o.number}`,
        meta: { number: o.number, shop: o.shopName, total, claimed, cashReceived, added: m.added, shortage: m.shortage, debt: m.remainder, courier: courier?.name ?? null, ...(input.exactClaim ? { batch: true } : {}) },
      }, { strict: true });
    });
    /*
      Расчёт меняет очередь «Ждут расчёта», платежи и долг магазина, а сброса
      отчётов здесь не было: плитки «Заказов» (кэш 20 с) держали закрытый
      заказ в очереди, событие для живых экранов не уходило вовсе, а списки
      магазинов (lib/cache: withTenantDataCache) держали долг ещё три минуты.
    */
    await invalidateReports(tenantId, "order.close");

    if (result.shortage > 0) {
      inBackground(notifyTenantRole(tenantId, "ceo",
        `⚠️ <b>Недостача ${tgEscape(fmtMoney(result.shortage))}</b>\nЗаказ ${tgEscape(info.number)} · ${tgEscape(info.shopName)}\n` +
        `Заявлено ${tgEscape(fmtMoney(result.claimed))}, сдано ${tgEscape(fmtMoney(input.cashReceived))}${info.courierName ? ` · ${tgEscape(info.courierName)}` : ""}\nПринял: ${tgEscape(actor.name)}`,
      ).catch(() => { /* уведомление — не проводка */ }));
    }
    return { ...result, closedAt: now };
  },

  /*
    Принять излишек по заказу, расчёт которого уже закрыт.

    Излишек, записанный до того, как его стали сдавать вместе с заказом
    (бизнес-аудит 19.11.2026, п. 18), или пришедший после закрытия: заказ
    рассчитан, а строка излишка всё ещё «на руках» и долг магазина не гасит.
    Оператор принимает её отдельно, когда курьер отдал деньги.
  */
  async acceptExcess(db: Db, tenantId: number, actor: Actor, orderId: number, now = new Date()) {
    if (!isOffice(actor.role)) throw badRequest("Принять деньги может только офис");
    let accepted = 0;
    let number = "";
    await db.transaction(async (tx) => {
      const [o] = await tx.select({ id: orders.id, number: orders.orderNumber, shopId: orders.shopId, closedAt: orders.closedAt })
        .from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId), isNull(orders.deletedAt))).for("update").limit(1);
      if (!o) throw badRequest("Заказ не найден");
      if (!o.closedAt) throw badRequest(`Заказ ${o.number} ещё не рассчитан — излишек примется вместе с расчётом`);
      const { pending } = await excessOnHands(tx, tenantId, o.id);
      if (pending.length === 0) throw badRequest("Излишка на руках по этому заказу нет");
      await tx.update(payments).set({ receivedAt: now, receivedBy: actor.id })
        .where(and(eq(payments.tenantId, tenantId), inArray(payments.id, pending.map(r => r.id))));
      await recalcShopDebt(tx, tenantId, o.shopId);
      accepted = round2(pending.reduce((t, r) => t + Number(r.amount), 0));
      number = o.number;
      await recordAudit(tx as unknown as Db, {
        tenantId, actorId: actor.id, actorName: actor.name, action: "order.excess_received", targetType: "order", targetId: o.id, targetLabel: `Заказ ${o.number}`,
        meta: { number: o.number, amount: accepted, holders: [...new Set(pending.map(r => r.createdByName ?? "—"))] },
      }, { strict: true });
    });
    await invalidateReports(tenantId, "order.close");
    return { amount: accepted, number };
  },

  /** Недостачи сотрудника за срок — в удержание из зарплаты (services/kpi.ts) и в индекс риска. */
  /*
    Недостача в зарплате — по дате самой недостачи (shortage_at), как в
    «Контроле», а не по дате закрытия расчёта.

    Возврат заказа в работу обнуляет closed_at, а недостачу оставляет; при
    повторном закрытии без новой недостачи closed_at встаёт в новый месяц —
    и те же 200 000 удерживались из зарплаты второй раз (бизнес-аудит
    19.11.2026, п. 17). Каждая недостача — строка order_shortages со своей
    датой: повторное закрытие добавляет новую, а не двигает и не затирает
    прежнюю.
  */
  async shortageIn(db: Db, tenantId: number, userId: number, from: Date, to: Date): Promise<{ count: number; amount: number }> {
    const [r] = await db.select({ n: sql<number>`count(*)`, s: sql<string>`coalesce(sum(${orderShortages.amount}), 0)` }).from(orderShortages)
      .where(and(eq(orderShortages.tenantId, tenantId), eq(orderShortages.userId, userId), gte(orderShortages.createdAt, from), lt(orderShortages.createdAt, to)));
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
  /* Роль — чтобы «Контроль» вёл строку курьера на его заказы (/orders?courier=…), а агента — в общую очередь. */
  async onHands(db: Db, tenantId: number): Promise<Array<{ userId: number; name: string; role: string; amount: number; since: Date }>> {
    const rows = await db.select({ userId: payments.createdBy, name: users.name, role: users.role, s: sql<string>`sum(${payments.amount})`, since: sql<Date>`min(${payments.createdAt})` })
      .from(payments).innerJoin(users, eq(users.id, payments.createdBy))
      .where(and(eq(payments.tenantId, tenantId), eq(payments.type, "payment"), eq(payments.paymentMethod, "cash"), isNull(payments.receivedAt), isNull(payments.reversalOf), sql`${payments.status} <> 'reversed'`,
        sql`not exists (select 1 from payments r where r.reversal_of = ${payments.id})`))
      .groupBy(payments.createdBy, users.name, users.role);
    return rows.filter(r => r.userId != null && Number(r.s) > 0).map(r => ({ userId: Number(r.userId), name: r.name, role: r.role, amount: round2(Number(r.s)), since: new Date(r.since) }));
  },
};
