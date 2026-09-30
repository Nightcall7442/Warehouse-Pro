import { and, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import { orders, payments, shops, users } from "@db/schema";
import { logger } from "../lib/logger";
import { tiyin } from "./order-shared";
import { OrderCloseService, ClaimSkip, claimVerdict, onHandsOf, type ClaimSkipReason } from "./order-close";

/*
  ВЕЧЕРНЯЯ СДАЧА КУРЬЕРА ПАЧКОЙ — «Принять по заявленному».

  ── Что было ────────────────────────────────────────────────────────────────

  Курьер вернулся — оператор по каждому доставленному заказу открывает
  карточку, жмёт «Закрыть расчёт» и возвращается к списку. Обычно заявленное
  курьером равно остатку и всё действие — одна кнопка, но на 20–40 заказов
  уходит 10–20 минут, а спешка рождает ошибки.

  ── Что стало ───────────────────────────────────────────────────────────────

  Отмеченные заказы закрываются разом, но ТОЛЬКО те, где заявленное курьером
  равно остатку к оплате до тийина (claimVerdict). Каждый — своей сделкой и
  тем же путём, что одиночное «Закрыть расчёт» (OrderCloseService.close):
  замок заказа, журнал, сброс отчётов. Расхождение, уже закрытый и «нет
  заявленного» пропускаются с причиной — их оператор закрывает по одному.
  Частичный успех не откатывает удачные: каждая сделка своя.

  До нажатия — итог (planClaimed): сколько закроется и на какую сумму, какие
  пропущены и почему. После — по каждому заказу: закрыт или пропущен.
*/

type Db = ReturnType<typeof import("../queries/connection").getDb>;
type Actor = { id: number; name: string; role: string };

export type ClaimPlanRow = {
  id: number;
  number: string | null;
  shopName: string | null;
  courierName: string | null;
  total: number;
  /** Заявлено полем и не получено — столько офис примет наличными. */
  claimed: number;
  /** Остаток к оплате без заявленного: итог − всё записанное + заявленное. */
  due: number;
  /** null — закроется; иначе — почему пропущен. */
  reason: ClaimSkipReason | null;
};

export type ClaimResult = { orderId: number; closed: boolean; amount: number; reason?: ClaimSkipReason | "error"; message?: string };

const money = (t: number) => t / 100;

/** Итог до нажатия: что закроется, на какую сумму, что пропущено и почему. Ничего не пишет. */
export async function planClaimed(db: Db, tenantId: number, orderIds: number[]): Promise<{ rows: ClaimPlanRow[]; ready: { count: number; amount: number } }> {
  const ids = [...new Set(orderIds)];
  if (ids.length === 0) return { rows: [], ready: { count: 0, amount: 0 } };
  const courier = alias(users, "courier");
  const found = await db.select({
    id: orders.id, number: orders.orderNumber, status: orders.status, total: orders.total, closedAt: orders.closedAt,
    shopName: shops.name, courierName: courier.name,
  }).from(orders)
    .leftJoin(shops, and(eq(shops.id, orders.shopId), eq(shops.tenantId, tenantId)))
    .leftJoin(courier, and(eq(courier.id, orders.courierId), eq(courier.tenantId, tenantId)))
    .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, ids), isNull(orders.deletedAt)));
  const pays = await db.select({
    id: payments.id, orderId: payments.orderId, amount: payments.amount, method: payments.paymentMethod, type: payments.type,
    reversalOf: payments.reversalOf, receivedAt: payments.receivedAt,
  }).from(payments).where(and(eq(payments.tenantId, tenantId), inArray(payments.orderId, ids)));

  const byOrder = new Map(found.map(o => [o.id, o]));
  const rows: ClaimPlanRow[] = ids.map(id => {
    const o = byOrder.get(id);
    if (!o) return { id, number: null, shopName: null, courierName: null, total: 0, claimed: 0, due: 0, reason: "not_found" };
    const own = pays.filter(p => p.orderId === id);
    const claimedT = onHandsOf(own).reduce((t, p) => t + tiyin(Number(p.amount)), 0);
    const paidT = own.filter(p => p.type === "payment").reduce((t, p) => t + tiyin(Number(p.amount)), 0);
    const totalT = tiyin(Number(o.total));
    return {
      id, number: o.number, shopName: o.shopName, courierName: o.courierName, total: money(totalT), claimed: money(claimedT), due: money(totalT - paidT + claimedT),
      reason: claimVerdict({ status: o.status, closed: o.closedAt != null, totalT, paidT, claimedT }),
    };
  });
  const ready = rows.filter(r => r.reason == null);
  return { rows, ready: { count: ready.length, amount: money(ready.reduce((t, r) => t + tiyin(r.claimed), 0)) } };
}

/**
 * Закрыть пачкой: каждый заказ — своей сделкой через OrderCloseService.close
 * с exactClaim. Правило «заявлено = остаток» и сверка с итогом проверяются
 * там, под замком заказа; здесь только собирается ответ по каждому.
 */
export async function acceptClaimed(db: Db, tenantId: number, actor: Actor, items: Array<{ orderId: number; claimed: number }>): Promise<{ results: ClaimResult[]; closed: number; amount: number }> {
  const seen = new Set<number>();
  const results: ClaimResult[] = [];
  for (const it of items) {
    if (seen.has(it.orderId)) continue;
    seen.add(it.orderId);
    try {
      const r = await OrderCloseService.close(db, tenantId, actor, { orderId: it.orderId, cashReceived: it.claimed, exactClaim: { claimed: it.claimed } });
      results.push({ orderId: it.orderId, closed: true, amount: r.claimed });
    } catch (e) {
      if (e instanceof ClaimSkip) { results.push({ orderId: it.orderId, closed: false, amount: 0, reason: e.reason }); continue; }
      // Сбой одного заказа не останавливает пачку: удачные уже в базе, этот — открыть и закрыть руками.
      logger.warn("пачка «по заявленному»: заказ не закрылся", { tenantId, orderId: it.orderId, error: e instanceof Error ? e.message : String(e) });
      results.push({ orderId: it.orderId, closed: false, amount: 0, reason: "error", message: e instanceof TRPCError ? e.message : undefined });
    }
  }
  const done = results.filter(r => r.closed);
  return { results, closed: done.length, amount: money(done.reduce((t, r) => t + tiyin(r.amount), 0)) };
}
