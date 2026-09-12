import { eq, and, sql, isNull } from "drizzle-orm";
import { orders, shops, payments } from "@db/schema";
import { cache, CacheKeys } from "../lib/cache";
import { logger } from "../lib/logger";
import { isDuplicateOf } from "../lib/db-errors";
import type { Db, Actor, OrderPaymentInput } from "./order-shared";
import { traceDebtChange, applyPartialPayment, applyPartialDelivery, isRepeatOfCompletedDelivery } from "./order-shared";
import { updateStatus } from "./order-status";

export async function recordPartialPayment(
  db: Db, tenantId: number, actor: Actor,
  input: OrderPaymentInput,
) {
  try {
    await db.transaction((tx) => applyPartialPayment(tx, tenantId, actor, input));
  } catch (e) {
    // Повтор той же попытки: транзакция откатилась целиком, лишней строки
    // нет, долг не тронут. Разбирать код безопасно только при переданном
    // ключе — без ключа конфликтовать нечему (см. services/payment.ts).
    if (input.idempotencyKey && isDuplicateOf(e, "uq_payments_idempotency")) {
      return { success: true, duplicate: true };
    }
    throw e;
  }
  cache.invalidate(CacheKeys.dashboardKpis(tenantId));

  /*
    След оставляем ПОСЛЕ успешной сделки, а не внутри неё: откат унёс бы
    запись вместе с оплатой, а запись о неслучившемся платеже хуже, чем её
    отсутствие. Сама оплата уже неудаляема — процедуры удаления платежей в
    системе нет.
  */
  try {
    const [info] = await db.select({
      orderNumber: orders.orderNumber,
      shopId: orders.shopId,
      shopName: shops.name,
      total: orders.total,
    }).from(orders)
      .leftJoin(shops, and(eq(shops.id, orders.shopId), eq(shops.tenantId, tenantId)))
      .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, tenantId))).limit(1);

    const [sum] = await db.select({
      paid: sql`COALESCE(SUM(CAST(${payments.amount} AS DECIMAL(15,2))), 0)`,
    }).from(payments)
      .where(and(eq(payments.orderId, input.orderId), eq(payments.tenantId, tenantId), eq(payments.type, "payment")));

    const remaining = Math.max(0, Number(info?.total ?? 0) - Number(sum?.paid ?? 0));
    await traceDebtChange(db, tenantId, actor, {
      action: "order.payment_recorded",
      orderId: input.orderId,
      orderNumber: String(info?.orderNumber ?? input.orderId),
      shopId: Number(info?.shopId ?? 0),
      shopName: String(info?.shopName ?? "Магазин"),
      amount: Number(input.paidAmount),
      remaining,
      method: input.method,
    });
  } catch (err) {
    logger.error("Не удалось записать след оплаты", { orderId: input.orderId, error: String(err) });
  }

  return { success: true };
}

// ── Partial Delivery ───────────────────────────────────────────────────────

export async function recordPartialDelivery(
  db: Db, tenantId: number, actor: Actor,
  input: {
    orderId: number;
    items: Array<{ itemId: number; deliveredQuantity: number; returnReason?: string }>;
    photos?: string[];
  },
) {
  await db.transaction((tx) => applyPartialDelivery(tx, tenantId, actor, input));
  cache.invalidate(CacheKeys.dashboardKpis(tenantId));
  return { success: true };
}

// ── Combined Delivery + Payment ────────────────────────────────────────────
// Both steps run inside a single transaction so a failed payment (e.g. bad
// amount) rolls back the delivery adjustment too, instead of leaving the
// order half-updated (stock already returned, debt already reduced, but no
// payment recorded).

// ── Bulk Complete + Full Payment ────────────────────────────────────────────
/**
 * For a batch of orders the operator already knows are fully paid — closes
 * each one (goods delivered, stock consumed) and records a full-amount
 * payment in the same pass, so there's no debt left and no need to open
 * every order individually. Each order is processed independently so one
 * bad row (already cancelled, zero total, etc.) doesn't block the rest.
 */

export async function bulkCompleteWithPayment(db: Db, tenantId: number, actor: Actor, orderIds: number[]) {
  if (orderIds.length === 0) return { updated: 0, failed: [] as Array<{ orderId: number; error: string }> };
  if (orderIds.length > 100) throw new Error("Максимум 100 заказов за раз");

  let updated = 0;
  const failed: Array<{ orderId: number; error: string }> = [];

  for (const orderId of orderIds) {
    try {
      const [order] = await db.select({
        id: orders.id, status: orders.status, total: orders.total, paymentMethod: orders.paymentMethod,
      }).from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt)))
        .limit(1);
      if (!order) throw new Error("Заказ не найден");
      if (order.status === "cancelled" || order.status === "returned") {
        throw new Error("Заказ отменён или возвращён — оплатить нельзя");
      }
      const total = Number(order.total);
      if (total <= 0) throw new Error("Сумма заказа равна нулю");

      const [{ paid: alreadyPaid }] = await db.select({
        paid: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS DECIMAL(15,2))), 0)`,
      }).from(payments).where(and(eq(payments.orderId, orderId), eq(payments.tenantId, tenantId), eq(payments.type, "payment")));
      if (Number(alreadyPaid) >= total) {
        // Already fully paid from an earlier action — just make sure it's
        // marked delivered, nothing more to record.
        if (order.status !== "delivered") await updateStatus(db, tenantId, orderId, "delivered");
        updated++;
        continue;
      }

      if (order.status !== "delivered") {
        await updateStatus(db, tenantId, orderId, "delivered");
      }
      const remaining = total - Number(alreadyPaid);
      await db.transaction(tx => applyPartialPayment(tx, tenantId, actor, {
        orderId,
        paidAmount: remaining.toFixed(2),
        method: (order.paymentMethod === "debt" ? "cash" : order.paymentMethod) as "cash" | "card" | "transfer",
      }));
      updated++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.warn("Bulk complete-with-payment failed for order", { orderId, error: message });
      failed.push({ orderId, error: message });
    }
  }

  cache.invalidate(CacheKeys.dashboardKpis(tenantId));
  return { updated, failed };
}

/**
 * Позиции нескольких заказов сразу — для окна массового завершения.
 *
 * Список заказов их не содержит: он отдаёт шапки, и подтягивать позиции по
 * одной означало бы полсотни запросов подряд на открытие окна. Здесь один
 * запрос на все выбранные заказы.
 *
 * Правило видимости то же, что у getById: кто не видит чужие заказы, тот
 * получает только свои. Иначе окно стало бы обходным путём к чужим данным.
 */
/*
  opts обязателен, а не необязателен.

  Внутри он решает главное — сужать ли выборку до своих заказов, — и пока
  его можно было не передать, забыть его означало молча открыть чужое. Со
  звёздочкой это ловил бы только тест; без неё не собирается сборка.
*/

export async function bulkCompleteDetailed(
  db: Db, tenantId: number, actor: Actor,
  entries: Array<{
    orderId: number;
    deliveredItems: Array<{ itemId: number; deliveredQuantity: number; returnReason?: string }>;
    paidAmount: string;
    paymentMethod: "cash" | "card" | "transfer";
    notes?: string;
  }>,
) {
  let updated = 0;
  const failed: Array<{ orderId: number; error: string }> = [];

  for (const entry of entries) {
    try {
      const paid = Number(entry.paidAmount);
      if (!Number.isFinite(paid) || paid < 0) throw new Error("Неверная сумма оплаты");

      await db.transaction(async (tx) => {
        await applyPartialDelivery(tx, tenantId, actor, {
          orderId: entry.orderId,
          items: entry.deliveredItems,
        });
        // Ноль — законный случай: товар отдан, деньги не принесли, вся
        // сумма уходит в долг. applyPartialPayment такую оплату не
        // принимает и не должен: нулевая строка в платежах ничего не
        // значит. Долг при этом уже пересчитан внутри applyPartialDelivery.
        if (paid > 0) {
          await applyPartialPayment(tx, tenantId, actor, {
            orderId: entry.orderId,
            paidAmount: entry.paidAmount,
            method: entry.paymentMethod,
            notes: entry.notes,
          });
        }
      });
      updated++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.warn("Bulk detailed completion failed for order", { orderId: entry.orderId, error: message });
      failed.push({ orderId: entry.orderId, error: message });
    }
  }

  cache.invalidate(CacheKeys.dashboardKpis(tenantId));
  return { updated, failed };
}

export async function recordDeliveryAndPayment(
  db: Db, tenantId: number, actor: Actor,
  input: {
    orderId: number;
    deliveredItems: Array<{ itemId: number; deliveredQuantity: number; returnReason?: string }>;
    payment: { paidAmount: string; method: "cash" | "card" | "transfer"; debtDueDate?: string; notes?: string; idempotencyKey?: string };
    photos?: string[];
  },
) {
  try {
    await db.transaction(async (tx) => {
      await applyPartialDelivery(tx, tenantId, actor, {
        orderId: input.orderId,
        items: input.deliveredItems,
        photos: input.photos,
      });
      await applyPartialPayment(tx, tenantId, actor, {
        orderId: input.orderId,
        paidAmount: input.payment.paidAmount,
        method: input.payment.method,
        debtDueDate: input.payment.debtDueDate,
        notes: input.payment.notes,
        idempotencyKey: input.payment.idempotencyKey,
      });
    });
  } catch (e) {
    // Повтор после потерянного ответа: доставка и оплата уже проведены той
    // же попыткой, откат — целиком. На повторе applyPartialDelivery может
    // отказать раньше по статусу, до INSERT платежа, и индекс не сработает
    // — тогда ответ даёт сама таблица платежей (isRepeatOfCompletedDelivery).
    if (input.payment.idempotencyKey && (isDuplicateOf(e, "uq_payments_idempotency")
        || await isRepeatOfCompletedDelivery(db, tenantId, input.payment.idempotencyKey))) {
      return { success: true, duplicate: true };
    }
    throw e;
  }

  cache.invalidate(CacheKeys.dashboardKpis(tenantId));
  return { success: true };
}

// ── Get Order Adjustments ──────────────────────────────────────────────────
