import { inBackground } from "./lib/graceful-shutdown";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, courierQuery, operatorQuery, can } from "./middleware";
import { getDb } from "./queries/connection";
import { markDelivered, completeDelivery, markFailed } from "./services/courier-delivery";
import { orders, shops, users, orderItems, products } from "@db/schema";
import { OPEN_ORDER_STATUSES } from "./lib/order-status";
import { eq, and, sql, desc, asc } from "drizzle-orm";
import { businessToday } from "@contracts/business-time";
import { ErrorMessages } from "@contracts/constants";
import { sseBus } from "./lib/sse";
import { logger } from "./lib/logger";
import { NotificationService } from "./services/NotificationService";
import { recordedAtInput } from "./lib/event-time";
import { DELIVERY_FAIL_REASONS, DELIVERY_FAIL_NOTE_MAX } from "@contracts/delivery-fail-reason";
import { isSafePhotoValue, PHOTO_VALUE_ERROR } from "./lib/photo-value";
import { auditActor } from "./services/audit-log";
import { rescheduleByCourier, rescheduleByOffice } from "./services/delivery-plan";
import { saveProof } from "./services/delivery-proof";
import { PROOF_PHOTO_MAX_CHARS, SIGNATURE_MAX_STROKES, SIGNATURE_SCALE, SIGNATURE_STROKE_MAX_POINTS } from "@contracts/delivery-proof";
import { inRunConditions, dueBy } from "./services/dispatch-board";

/** Координаты строкой, как у точек GPS (agent.saveLocation). */
const latInput = z.string().refine(v => { const n = Number(v); return v.trim() !== "" && Number.isFinite(n) && n >= -90 && n <= 90; }, "Широта должна быть от -90 до 90").optional();
const lngInput = z.string().refine(v => { const n = Number(v); return v.trim() !== "" && Number.isFinite(n) && n >= -180 && n <= 180; }, "Долгота должна быть от -180 до 180").optional();
/** Ключ записи очереди телефона (uuid или свой): столбец delivery_events.idempotency_key — 64. */
const idempotencyKeyInput = z.string().min(8).max(64).optional();
const dayInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД");
const failReasonInput = {
  reasonCode: z.enum(DELIVERY_FAIL_REASONS).optional(),
  note: z.string().max(DELIVERY_FAIL_NOTE_MAX).optional(),
};
/** Подпись — рамка и штрихи числами (contracts/delivery-proof.ts: signatureProblem). */
const signatureInput = z.object({
  w: z.number().int().min(1).max(SIGNATURE_SCALE),
  h: z.number().int().min(1).max(SIGNATURE_SCALE),
  strokes: z.array(z.array(z.number().int().min(0).max(SIGNATURE_SCALE)).max(SIGNATURE_STROKE_MAX_POINTS * 2)).min(1).max(SIGNATURE_MAX_STROKES),
});

export const courierRouter = createRouter({
  /*
    Что везти — курьеру его заказы, офису — все в развозе.

    ── Курьер ─────────────────────────────────────────────────────────────────

    Только ОТКРЫТЫЕ заказы. Отмена заказа не трогает его курьера и статус
    доставки, и отменённый заказ оставался у курьера в списке — тот ехал к
    магазину, который от заказа отказался. Перенесённый на другой день
    (plannedDeliveryDate впереди) в сегодняшний список не попадает; includeLater
    отдаёт и их — для свёрнутого раздела «Перенесено».

    Порядок — маршрут диспетчера (routeSeq), за ним заказы без места, новые
    сверху, как было.

    ── Офис ───────────────────────────────────────────────────────────────────

    Раньше отдавались только «назначен» и без имени курьера: заказ, уже
    выехавший, пропадал из списка, а чей он — не видно. Теперь — и «в пути»,
    с курьером и его маршрутом.
  */
  listMyDeliveries: courierQuery
    .input(z.object({ includeLater: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const courierId = ctx.user.role === "courier" ? ctx.user.id : undefined;
      const today = businessToday();

      const fields = {
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        deliveryStatus: orders.deliveryStatus,
        total: orders.total,
        totalWeightKg: sql<string>`COALESCE((
          SELECT SUM(CAST(oi.quantity AS DECIMAL(15,3)) * CAST(COALESCE(p.unit_weight, '1') AS DECIMAL(15,3)))
          FROM ${orderItems} oi
          LEFT JOIN ${products} p ON p.id = oi.product_id
          WHERE oi.order_id = ${orders.id}
        ), 0)`,
        shopName: shops.name,
        shopAddress: shops.address,
        shopCity: shops.city,
        shopGpsLat: shops.gpsLat,
        shopGpsLng: shops.gpsLng,
        createdAt: orders.createdAt,
        deliveredAt: orders.deliveredAt,
        plannedDeliveryDate: orders.plannedDeliveryDate,
        routeSeq: orders.routeSeq,
        courierId: orders.courierId,
      };
      // Те же условия, что у доски развоза (services/dispatch-board.ts):
      // курьер и диспетчер видят один и тот же список.
      const open = inRunConditions(tenantId);

      if (!courierId) {
        return db.select({ ...fields, courierName: users.name })
          .from(orders)
          .leftJoin(shops, and(eq(orders.shopId, shops.id), eq(shops.tenantId, tenantId)))
          .leftJoin(users, and(eq(orders.courierId, users.id), eq(users.tenantId, tenantId)))
          .where(and(...open))
          .orderBy(desc(orders.createdAt))
          .limit(200);
      }

      return db.select({ ...fields, courierName: sql<string | null>`NULL` })
        .from(orders)
        .leftJoin(shops, and(eq(orders.shopId, shops.id), eq(shops.tenantId, tenantId)))
        .where(and(
          ...open,
          eq(orders.courierId, courierId),
          ...(input?.includeLater ? [] : [dueBy(today)]),
        ))
        .orderBy(sql`${orders.routeSeq} IS NULL`, asc(orders.routeSeq), desc(orders.createdAt))
        .limit(100);
    }),

  assignCourier: operatorQuery
    .input(z.object({ orderId: z.number().int().positive(), courierId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      const [order] = await db.select({ id: orders.id, status: orders.status, courierId: orders.courierId, shopId: orders.shopId, orderNumber: orders.orderNumber }).from(orders)
        .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, ctx.tenant.id)))
        .limit(1);
      if (!order) throw new Error("Заказ не найден");
      /*
        Курьера цепляют, пока заказ ОТКРЫТ, а не только пока он «новый».

        Здесь стояло «только новый или в обработке» — и это ломало обычный ход
        работы: заказы собирают в погрузочный лист, статус становится
        «отгружен», и ровно в этот момент их отдают курьеру. Назначить его было
        уже нельзя.

        Хуже, что рядом массовое назначение (order.bulkAssignCourier) с самого
        начала работало по всем открытым статусам. Один и тот же заказ можно
        было отдать курьеру галочкой в списке и нельзя — из его же карточки.

        Закрытый заказ курьеру не отдают: доставленный уже доехал, отменённый
        никуда не едет, возвращённый вернулся.
      */
      if (!OPEN_ORDER_STATUSES.includes(order.status as (typeof OPEN_ORDER_STATUSES)[number])) {
        throw new Error("Заказ уже закрыт — курьера назначают, пока он в работе");
      }

      const [courier] = await db.select().from(users)
        .where(and(eq(users.id, input.courierId), eq(users.tenantId, ctx.tenant.id), eq(users.role, "courier")))
        .limit(1);
      if (!courier) throw new Error("Курьер не найден");

      // Новое назначение — новый план: место в прежнем маршруте и перенос
      // «на четверг» относились к прежнему решению и новому курьеру ничего не
      // говорят. Нужен другой день — его ставят переносом (officeReschedule).
      await db.update(orders)
        .set({ courierId: input.courierId, deliveryStatus: "assigned", routeSeq: null, plannedDeliveryDate: null })
        .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, ctx.tenant.id)));

      const [shop] = await db.select({ name: shops.name }).from(shops)
        .where(eq(shops.id, order.shopId)).limit(1);

      await NotificationService.create(db, {
        tenantId: ctx.tenant.id,
        userId: input.courierId,
        type: "order",
        title: { ru: "Назначен заказ на доставку", uz: "Yetkazishga buyurtma tayinlandi" },
        message: { ru: `Заказ ${order.orderNumber} → ${shop?.name ?? "Магазин"}`, uz: `Buyurtma ${order.orderNumber} → ${shop?.name ?? "Do'kon"}` },
      });

      // Push курьеру — после ответа: оператор не ждёт Expo.
      inBackground(import("./services/push-service").then(({ sendPushToUser }) => sendPushToUser(input.courierId, {
        title: "Назначен заказ на доставку",
        body: `Заказ ${order.orderNumber} → ${shop?.name ?? "Магазин"}`,
        data: { type: "delivery", orderId: input.orderId },
      })).catch(() => { /* push is non-critical */ }));

      sseBus.emit({
        type: "notification.new",
        tenantId: ctx.tenant.id,
        userId: input.courierId,
        data: { title: "Назначен заказ на доставку", orderNumber: order.orderNumber },
      });

      // Только назначенному курьеру: остальным это не новость, а шум.
      // Тоже после ответа — Telegram не на пути назначения.
      inBackground(Promise.all([import("./services/telegram-notify"), import("./telegram-router")]).then(([{ notifyEvent }, { tgEscape: esc }]) => notifyEvent({
        tenantId: ctx.tenant.id,
        event: "delivery.assigned",
        onlyUserId: input.courierId,
        text: `🚚 <b>Назначена доставка</b>
📋 ${esc(order.orderNumber)}
🏪 ${esc(shop?.name ?? "Магазин")}`,
      })).catch(e => logger.warn("delivery.assigned notify failed", { error: String(e) })));

      logger.info("courier assigned", { orderId: input.orderId, courierId: input.courierId });

      return { success: true };
    }),

  markOutForDelivery: courierQuery
    .input(z.object({ orderId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const courierId = ctx.user.id;

      const [order] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, shopId: orders.shopId, status: orders.status, deliveryStatus: orders.deliveryStatus }).from(orders)
        .where(and(
          eq(orders.id, input.orderId),
          eq(orders.tenantId, ctx.tenant.id),
          eq(orders.courierId, courierId),
          eq(orders.deliveryStatus, "assigned"),
        )).limit(1);
      if (!order) {
        // Повтор из очереди: заказ уже в пути или уже довезён этим курьером.
        const [mine] = await db.select({ deliveryStatus: orders.deliveryStatus }).from(orders)
          .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, ctx.tenant.id), eq(orders.courierId, courierId),
            sql`${orders.deliveryStatus} IN ('out_for_delivery', 'delivered')`)).limit(1);
        if (mine) return { success: true, duplicate: true };
        throw new Error("Заказ не найден или не назначен на вас");
      }

      await db.update(orders)
        .set({ deliveryStatus: "out_for_delivery" })
        .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, ctx.tenant.id)));

      return { success: true };
    }),

  markDelivered: courierQuery
    .input(z.object({
      orderId: z.number().int().positive(),
      cashAmount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Неверный формат суммы").optional(),
      recordedAt: recordedAtInput,
    }))
    .mutation(({ input, ctx }) => markDelivered(getDb(), ctx.tenant.id, ctx.user.id, input)),

  // ── Complete Delivery with payment/return status ────────────────────────────
  completeDelivery: courierQuery
    .input(z.object({
      orderId: z.number().int().positive(),
      recordedAt: recordedAtInput,
      result: z.enum(["paid", "partial_paid", "returned", "partial_returned"]),
      // Формат тот же, что у cashAmount в markDelivered выше. Раньше поле было
      // просто z.string(): курьер набирал «50,000» (запятая — привычный
      // разделитель разрядов), Number("50,000") давал NaN, и дальше
      // debtAmount = total − NaN = NaN, `paidAmount > 0` — ложь, платёж не
      // записывался вовсе, а заказ при этом становился delivered и склад
      // списывался. Долг магазина пересчитывался так, будто денег не приносили.
      paidAmount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Неверный формат суммы").optional(),
      paymentMethod: z.enum(["cash", "card", "transfer"]).default("cash"),
      // Колонка debt_due_date — DATE. Свободная строка вроде «15.09.2026» или
      // «15/09/26» превращалась в Invalid Date, драйвер писал NULL в NOT NULL
      // колонку debt_reminders.due_date и вся транзакция откатывалась: курьер
      // не мог закрыть доставку вообще и видел непонятную ошибку драйвера.
      debtDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД").optional(),
      returnReason: z.string().max(200).optional(), // for returned/partial_returned
      returnedItems: z.array(z.object({          // for partial_returned
        itemId: z.number(),
        // .min(0) обязателен: без него отрицательное возвращённое количество
        // превращается в доставленное БОЛЬШЕ заказанного (qty - (-3) = qty + 3),
        // и со склада списывается товар, которого в заказе не было. Верхняя
        // граница проверяется на сервере против фактического количества строки —
        // здесь она неизвестна. Операторский путь имеет обе проверки
        // (order-router.ts:550 и services/order.ts:304), курьерский не имел ни
        // одной, хотя роль курьера — наименее доверенная из всех.
        returnedQty: z.number().min(0, "Возвращённое количество не может быть отрицательным"),
      })).optional(),
      notes: z.string().max(500).optional(),
    }).superRefine((v, ctx) => {
      // «Частичный возврат» без списка возвращённых позиций — запрос, который
      // нечем исполнить. Раньше он проходил: ни одна из трёх веток обработки
      // склада не срабатывала (условие ветки требовало returnedItems), заказ
      // всё равно становился delivered, долг пересчитывался, а резерв по
      // заказу оставался в reserved навсегда — освободить его больше некому,
      // заказ уже завершён. available занижен, current_stock завышен, и
      // расхождение всплывает только при инвентаризации.
      //
      // Экран мобилки список всегда шлёт, поэтому проверка стоит на сервере:
      // до неё доходит запрос, отправленный мимо экрана.
      if (v.result === "partial_returned" && !v.returnedItems?.length) {
        ctx.addIssue({
          code: "custom",
          path: ["returnedItems"],
          message: "Для частичного возврата укажите, что именно вернулось",
        });
      }
    }))
    .mutation(({ input, ctx }) => completeDelivery(getDb(), ctx.tenant.id, ctx.user.id, input)),

  /*
    «Не довёз» — с причиной кодом.

    Все новые поля необязательны: мобилка старой версии шлёт {orderId,
    reason} свободным текстом и продолжает работать — три текста её кнопок
    узнаются кодами (contracts/delivery-fail-reason.ts).
  */
  markFailed: courierQuery
    .input(z.object({
      orderId: z.number().int().positive(),
      reason: z.string().max(500).optional(),
      reasonCode: z.enum(DELIVERY_FAIL_REASONS).optional(),
      note: z.string().max(DELIVERY_FAIL_NOTE_MAX).optional(),
      recordedAt: recordedAtInput,
      lat: latInput,
      lng: lngInput,
      idempotencyKey: idempotencyKeyInput,
    }))
    .mutation(({ input, ctx }) => markFailed(getDb(), ctx.tenant.id, ctx.user.id, input)),

  /*
    «Перенести на…» — курьер переносит свой заказ на другой день (с завтра,
    не дальше двух недель). Заказ остаётся за ним и возвращается в его список
    в этот день. Перенос — не срыв: в KPI «Сорвано» не идёт.
  */
  reschedule: courierQuery
    .input(z.object({
      orderId: z.number().int().positive(),
      date: dayInput,
      ...failReasonInput,
      recordedAt: recordedAtInput,
      lat: latInput,
      lng: lngInput,
      idempotencyKey: idempotencyKeyInput,
    }))
    .mutation(({ input, ctx }) => rescheduleByCourier(getDb(), ctx.tenant.id, ctx.user.id, input)),

  /** Офис ставит заказу курьера день доставки — и на сегодня тоже (вернуть в развоз). */
  officeReschedule: operatorQuery.use(can("orders.edit"))
    .input(z.object({
      orderId: z.number().int().positive(),
      date: dayInput,
      ...failReasonInput,
    }))
    .mutation(({ input, ctx }) => rescheduleByOffice(getDb(), auditActor(ctx), input)),

  /*
    Подтверждение вручения — после «Доставлено», отдельным запросом: фото,
    подпись, имя принявшего. Одно фото за запрос — тело остаётся далеко от
    предела в 10 МБ и на слабой связи уходит целиком.

    Только курьер: подтверждение — слово того, кто стоял у прилавка, а не
    офиса, дописанное потом.
  */
  saveProof: courierQuery
    .input(z.object({
      orderId: z.number().int().positive(),
      photo: z.string().max(PROOF_PHOTO_MAX_CHARS, "Фото слишком большое — снимите ещё раз").refine(isSafePhotoValue, PHOTO_VALUE_ERROR).optional(),
      signature: signatureInput.optional(),
      recipientName: z.string().max(120).optional(),
    }))
    .mutation(({ input, ctx }) => {
      if (ctx.user.role !== "courier") throw new TRPCError({ code: "FORBIDDEN", message: ErrorMessages.insufficientRole });
      return saveProof(getDb(), ctx.tenant.id, ctx.user.id, input);
    }),
});
