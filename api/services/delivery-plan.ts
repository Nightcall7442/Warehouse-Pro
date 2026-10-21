import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { orders, shops, users } from "@db/schema";
import { RESCHEDULE_MAX_DAYS, type DeliveryFailReason } from "@contracts/delivery-fail-reason";
import { OPEN_ORDER_STATUSES } from "../lib/order-status";
import { inBackground } from "../lib/graceful-shutdown";
import { logger } from "../lib/logger";
import { invalidateReports } from "../lib/report-cache";
import { badRequest } from "../lib/errors";
import { eventTime } from "../lib/event-time";
import { isDuplicateEntry } from "../lib/db-errors";
import { sseBus } from "../lib/sse";
import { NotificationService } from "./NotificationService";
import { sendPushToUser } from "./push-service";
import { recordAudit, type AuditRecord } from "./audit-log";
import { assertFailReason, assertPlanDay, ddmm, eventByKey, failReasonOf, reasonWords, recordDeliveryEvent } from "./delivery-events";
import type { Db } from "./order-shared";

/*
  План развоза: на какой день заказ и каким он идёт у курьера по счёту.

  ── Перенос ─────────────────────────────────────────────────────────────────

  Раньше у курьера было два исхода: «доставлено» и «не доставлено». Магазин
  просит «привезите в четверг» — курьер жал «не доставлено», заказ слетал с
  него в «новый», и оператор назначал его заново, вспоминая про четверг сам.
  Теперь курьер переносит заказ на день (с завтра и не дальше двух недель):
  заказ остаётся за ним, уходит из сегодняшнего списка и возвращается в
  нужный день сам. Офис переносит так же — и на сегодня тоже.

  Перенос — не срыв: в «Сорвано» KPI курьера он не идёт. Но в журнал
  попыток пишется (kind = rescheduled) — с причиной, чтобы отчёт видел
  «магазин третий раз просит перенести».

  ── Порядок ─────────────────────────────────────────────────────────────────

  routeSeq — место заказа в маршруте курьера, его ставит диспетчер на доске
  развоза. Курьер получает список в этом порядке. Новый курьер, перенос и
  срыв место сбрасывают: прежний порядок говорил о прежнем дне и прежней
  машине.
*/

const ACTIVE_DELIVERY = ["assigned", "out_for_delivery"] as const;

export interface CourierRescheduleInput {
  orderId: number;
  /** День доставки «ГГГГ-ММ-ДД» по Ташкенту: с завтра до +RESCHEDULE_MAX_DAYS. */
  date: string;
  reasonCode?: DeliveryFailReason;
  note?: string;
  recordedAt?: string;
  lat?: string;
  lng?: string;
  idempotencyKey?: string;
}

/**
 * Курьер переносит СВОЙ заказ на другой день.
 *
 * Строка заказа берётся под замок: перенос «на тот же день» второй раз не
 * меняет ни одного поля, и по числу изменённых строк гонку с «Доставлено» не
 * отличить от повтора — а под замком проверка статуса и запись идут одним
 * куском.
 */
export async function rescheduleByCourier(db: Db, tenantId: number, courierId: number, input: CourierRescheduleInput) {
  if (await eventByKey(db, tenantId, input.idempotencyKey)) return { success: true, duplicate: true };

  // Без кода — «просили привезти в другой день»: так переносят чаще всего.
  const reason = failReasonOf({ reasonCode: input.reasonCode, note: input.note }, "asked_reschedule");
  assertFailReason(reason.code, reason.note);
  assertPlanDay(input.date, 1, RESCHEDULE_MAX_DAYS);

  let order: { id: number; orderNumber: string; agentId: number | null; shopId: number };
  try {
    order = await db.transaction(async (tx) => {
      const [o] = await tx.select({ id: orders.id, orderNumber: orders.orderNumber, agentId: orders.agentId, shopId: orders.shopId })
        .from(orders)
        .where(and(
          eq(orders.id, input.orderId), eq(orders.tenantId, tenantId),
          eq(orders.courierId, courierId), isNull(orders.deletedAt),
          inArray(orders.deliveryStatus, [...ACTIVE_DELIVERY]),
          inArray(orders.status, OPEN_ORDER_STATUSES),
        ))
        .for("update")
        .limit(1);
      if (!o) throw new Error("Заказ не найден или не назначен на вас");

      // «В пути» → «назначен»: сегодня курьер к магазину больше не едет.
      await tx.update(orders)
        .set({ plannedDeliveryDate: input.date, deliveryStatus: "assigned", routeSeq: null })
        .where(and(eq(orders.id, o.id), eq(orders.tenantId, tenantId)));

      await recordDeliveryEvent(tx, {
        tenantId, orderId: o.id, courierId, kind: "rescheduled",
        reasonCode: reason.code, note: reason.note, rescheduledTo: input.date,
        lat: input.lat ?? null, lng: input.lng ?? null,
        recordedAt: eventTime(input.recordedAt),
        idempotencyKey: input.idempotencyKey ?? null,
      });
      return o;
    });
  } catch (e) {
    // Тот же ключ двумя запросами разом: второй упёрся в уникальный индекс.
    if (input.idempotencyKey && isDuplicateEntry(e)) return { success: true, duplicate: true };
    throw e;
  }
  await invalidateReports(tenantId, "delivery");

  const words = reasonWords(reason.code, reason.note);
  inBackground(notifyRescheduled(db, tenantId, order, input.date, words, courierId));
  logger.info("order delivery rescheduled", { orderId: order.id, courierId, date: input.date, reasonCode: reason.code });
  return { success: true, plannedDeliveryDate: input.date };
}

export interface OfficeRescheduleInput {
  orderId: number;
  date: string;
  reasonCode?: DeliveryFailReason;
  note?: string;
}

/**
 * Офис ставит заказу день доставки — с сегодняшнего (вернуть перенесённый в
 * сегодняшний развоз) до +RESCHEDULE_MAX_DAYS.
 *
 * Только заказу с курьером: день — это место в чьём-то маршруте. Заказу без
 * курьера день поставить можно было бы, но назначение курьера план сбрасывает
 * (новый курьер — новый план), и день бы молча пропал.
 */
export async function rescheduleByOffice(db: Db, actor: Pick<AuditRecord, "tenantId" | "actorId" | "actorName" | "ip">, input: OfficeRescheduleInput) {
  const tenantId = actor.tenantId;
  const reason = failReasonOf({ reasonCode: input.reasonCode, note: input.note });
  assertFailReason(reason.code, reason.note);
  assertPlanDay(input.date, 0, RESCHEDULE_MAX_DAYS);

  const order = await db.transaction(async (tx) => {
    const [o] = await tx.select({
      id: orders.id, orderNumber: orders.orderNumber, status: orders.status, deliveryStatus: orders.deliveryStatus,
      courierId: orders.courierId, plannedDeliveryDate: orders.plannedDeliveryDate, agentId: orders.agentId, shopId: orders.shopId,
    }).from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt)))
      .for("update")
      .limit(1);
    if (!o) throw new Error("Заказ не найден");
    if (!OPEN_ORDER_STATUSES.includes(o.status as (typeof OPEN_ORDER_STATUSES)[number])) {
      throw badRequest("Заказ уже закрыт — день доставки меняют, пока он в работе");
    }
    if (!o.courierId || !(ACTIVE_DELIVERY as readonly string[]).includes(o.deliveryStatus ?? "")) {
      throw badRequest("Сначала назначьте курьера — день доставки ставится в его маршрут");
    }

    await tx.update(orders)
      .set({ plannedDeliveryDate: input.date, deliveryStatus: "assigned", routeSeq: null })
      .where(and(eq(orders.id, o.id), eq(orders.tenantId, tenantId)));

    // Курьер в строке журнала — только когда переносит он сам: перенос офиса
    // не его попытка, и «кто перенёс» видно по пустому полю и по журналу аудита.
    await recordDeliveryEvent(tx, {
      tenantId, orderId: o.id, courierId: null, kind: "rescheduled",
      reasonCode: reason.code, note: reason.note, rescheduledTo: input.date,
      recordedAt: new Date(),
    });

    await recordAudit(tx as unknown as Db, {
      ...actor,
      action: "order.delivery_rescheduled",
      targetType: "order",
      targetId: o.id,
      meta: {
        orderNumber: o.orderNumber,
        plannedBefore: o.plannedDeliveryDate ?? null,
        plannedDate: input.date,
        reason: reason.code ? reasonWords(reason.code, reason.note).ru : reason.note,
      },
    }, { strict: true });
    return o;
  });
  await invalidateReports(tenantId, "delivery");

  // Курьеру — что заказ ушёл с его дня (или вернулся в него).
  const courierId = order.courierId!;
  await NotificationService.create(db, {
    tenantId, userId: courierId, type: "order",
    title: { ru: "День доставки изменён", uz: "Yetkazish kuni o'zgartirildi" },
    message: { ru: `Заказ ${order.orderNumber} — доставка ${ddmm(input.date)}`, uz: `Buyurtma ${order.orderNumber} — yetkazish ${ddmm(input.date)}` },
  });
  inBackground(sendPushToUser(courierId, {
    title: "День доставки изменён",
    body: `Заказ ${order.orderNumber} — доставка ${ddmm(input.date)}`,
    data: { type: "delivery", orderId: order.id },
  }).catch(() => { /* push необязателен */ }));

  logger.info("order delivery rescheduled by office", { orderId: order.id, date: input.date, actorId: actor.actorId });
  return { success: true, plannedDeliveryDate: input.date };
}

/** Агенту магазина и в Telegram (оператор, агент) — магазин ждёт в другой день. */
function notifyRescheduled(
  db: Db, tenantId: number,
  order: { id: number; orderNumber: string; agentId: number | null; shopId: number },
  date: string, words: { ru: string; uz: string }, courierId: number,
): Promise<void> {
  return (async () => {
    if (order.agentId) {
      await NotificationService.create(db, {
        tenantId, userId: order.agentId, type: "order",
        title: { ru: "Доставка перенесена", uz: "Yetkazish ko'chirildi" },
        message: {
          ru: `Заказ ${order.orderNumber} — на ${ddmm(date)}${words.ru ? ` (${words.ru})` : ""}`,
          uz: `Buyurtma ${order.orderNumber} — ${ddmm(date)} ga${words.uz ? ` (${words.uz})` : ""}`,
        },
      });
      inBackground(sendPushToUser(order.agentId, {
        title: "Доставка перенесена",
        body: `Заказ ${order.orderNumber} — на ${ddmm(date)}`,
        data: { type: "order.failed", orderId: order.id },
      }).catch(() => { /* push необязателен */ }));
    }
    const [{ notifyEvent }, { tgMessages, fmtMoney }] = await Promise.all([import("./telegram-notify"), import("../lib/telegram")]);
    const [full] = await db.select({ total: orders.total }).from(orders).where(and(eq(orders.id, order.id), eq(orders.tenantId, tenantId))).limit(1);
    const [shop] = await db.select({ name: shops.name }).from(shops).where(and(eq(shops.id, order.shopId), eq(shops.tenantId, tenantId))).limit(1);
    const [courier] = await db.select({ name: users.name }).from(users).where(and(eq(users.id, courierId), eq(users.tenantId, tenantId))).limit(1);
    // Событие то же, что у срыва: сегодня заказ не приедет, и получатели те же
    // (оператор и агент магазина) — отдельный переключатель им был бы лишним.
    await notifyEvent({
      tenantId, event: "delivery.failed", agentOnly: order.agentId ?? undefined,
      text: tgMessages.deliveryRescheduled({
        number: order.orderNumber, shop: shop?.name ?? "Магазин", total: fmtMoney(full?.total ?? 0),
        day: ddmm(date), reason: words.ru ? `${words.ru} / ${words.uz}` : null, courier: courier?.name,
      }),
    });
  })().catch(e => logger.warn("delivery.rescheduled notify failed", { error: String(e) }));
}

export interface RouteOrderInput {
  courierId: number;
  /** Заказы курьера в порядке объезда; первый — первая остановка. */
  orderIds: number[];
}

/**
 * Диспетчер задаёт порядок объезда курьера.
 *
 * Принимаются только открытые заказы ЭТОГО курьера, что сейчас в развозе:
 * чужой номер в списке — либо доска устарела (заказ уже переназначили), либо
 * подмена; в обоих случаях порядок не пишется вовсе, а не «частично».
 * Заказы курьера, которых в списке нет, теряют место — иначе у двух заказов
 * оказался бы один и тот же номер остановки.
 */
export async function setRouteOrder(db: Db, actor: Pick<AuditRecord, "tenantId" | "actorId" | "actorName" | "ip">, input: RouteOrderInput) {
  const tenantId = actor.tenantId;
  if (new Set(input.orderIds).size !== input.orderIds.length) {
    throw badRequest("В порядке один и тот же заказ встречается дважды");
  }

  const [courier] = await db.select({ id: users.id, name: users.name }).from(users)
    .where(and(eq(users.id, input.courierId), eq(users.tenantId, tenantId), eq(users.role, "courier")))
    .limit(1);
  if (!courier) throw new Error("Курьер не найден в вашей организации");

  await db.transaction(async (tx) => {
    const mine = await tx.select({ id: orders.id }).from(orders)
      .where(and(
        eq(orders.tenantId, tenantId), eq(orders.courierId, courier.id), isNull(orders.deletedAt),
        inArray(orders.status, OPEN_ORDER_STATUSES), inArray(orders.deliveryStatus, [...ACTIVE_DELIVERY]),
      ))
      .for("update");
    const own = new Set(mine.map(r => r.id));
    if (input.orderIds.some(id => !own.has(id))) {
      throw badRequest("Порядок задают только открытым заказам этого курьера — обновите доску развоза");
    }

    const rest = mine.map(r => r.id).filter(id => !input.orderIds.includes(id));
    if (rest.length > 0) {
      await tx.update(orders).set({ routeSeq: null })
        .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, rest)));
    }
    // Одним запросом: CASE по номеру заказа — место в списке, с единицы.
    const seq = sql`CASE ${orders.id} ${sql.join(input.orderIds.map((id, i) => sql`WHEN ${id} THEN ${i + 1}`), sql` `)} END`;
    await tx.update(orders).set({ routeSeq: seq })
      .where(and(eq(orders.tenantId, tenantId), eq(orders.courierId, courier.id), inArray(orders.id, input.orderIds)));

    await recordAudit(tx as unknown as Db, {
      ...actor,
      action: "courier.route_set",
      targetType: "user",
      targetId: courier.id,
      meta: { userName: courier.name, orderIds: input.orderIds },
    }, { strict: true });
  });

  // Экран курьера перечитывает список по этому событию.
  sseBus.emit({ type: "order.changed", tenantId, data: {} });
  logger.info("courier route set", { courierId: courier.id, stops: input.orderIds.length, actorId: actor.actorId });
  return { success: true, stops: input.orderIds.length };
}

