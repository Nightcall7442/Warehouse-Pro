import { z } from "zod";
import { createRouter, courierQuery, operatorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { orders, shops, users, payments, orderItems, products, warehouseStock, warehouses, debtReminders, orderAdjustments } from "@db/schema";
import { ORDER_STATUS_LABELS, OPEN_ORDER_STATUSES } from "./lib/order-status";
import { eq, and, sql, desc, isNull } from "drizzle-orm";
import { sseBus } from "./lib/sse";
import { logger } from "./lib/logger";
import { sendPushToUser } from "./services/push-service";
import { sanitizeString } from "./lib/sanitize";
import { recalcShopDebt } from "./services/shop-debt";
import { paidForOrder, assertFitsRemainder } from "./services/payment";
import { productLabel } from "./services/order";
import { releaseStock, shipStock } from "./services/stock-ledger";
import { NotificationService } from "./services/NotificationService";

export const courierRouter = createRouter({
  listMyDeliveries: courierQuery.query(async ({ ctx }) => {
    const db = getDb();
    const courierId = ctx.user.role === "courier" ? ctx.user.id : undefined;

    if (!courierId) {
      return db.select({
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
      })
        .from(orders)
        .leftJoin(shops, and(eq(orders.shopId, shops.id), eq(shops.tenantId, ctx.tenant.id)))
        .where(and(
          eq(orders.tenantId, ctx.tenant.id),
          isNull(orders.deletedAt),
          eq(orders.deliveryStatus, "assigned"),
        ))
        .orderBy(desc(orders.createdAt))
        .limit(50);
    }

    return db.select({
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
    })
      .from(orders)
      .leftJoin(shops, and(eq(orders.shopId, shops.id), eq(shops.tenantId, ctx.tenant.id)))
      .where(and(
        eq(orders.tenantId, ctx.tenant.id),
        eq(orders.courierId, courierId),
        // Удалённый заказ курьеру не показывается: его резерв уже вернулся
        // на склад, и везти по нему нечего.
        isNull(orders.deletedAt),
        sql`${orders.deliveryStatus} IN ('assigned', 'out_for_delivery')`,
      ))
      .orderBy(desc(orders.createdAt))
      .limit(50);
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

      await db.update(orders)
        .set({ courierId: input.courierId, deliveryStatus: "assigned" })
        .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, ctx.tenant.id)));

      const [shop] = await db.select({ name: shops.name }).from(shops)
        .where(eq(shops.id, order.shopId)).limit(1);

      await NotificationService.create(db, {
        tenantId: ctx.tenant.id,
        userId: input.courierId,
        type: "order",
        title: "Назначен заказ на доставку",
        message: `Заказ ${order.orderNumber} → ${shop?.name ?? "Магазин"}`,
      });

      // Send push notification to courier
      try {
        const { sendPushToUser } = await import("./services/push-service");
        await sendPushToUser(input.courierId, {
          title: "Назначен заказ на доставку",
          body: `Заказ ${order.orderNumber} → ${shop?.name ?? "Магазин"}`,
          data: { type: "delivery", orderId: input.orderId },
        });
      } catch { /* push is non-critical */ }

      sseBus.emit({
        type: "notification.new",
        tenantId: ctx.tenant.id,
        userId: input.courierId,
        data: { title: "Назначен заказ на доставку", orderNumber: order.orderNumber },
      });

      // Только назначенному курьеру: остальным это не новость, а шум.
      const { notifyEvent } = await import("./services/telegram-notify");
      const { tgEscape: esc } = await import("./telegram-router");
      await notifyEvent({
        tenantId: ctx.tenant.id,
        event: "delivery.assigned",
        onlyUserId: input.courierId,
        text: `🚚 <b>Назначена доставка</b>
📋 ${esc(order.orderNumber)}
🏪 ${esc(shop?.name ?? "Магазин")}`,
      });

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
      if (!order) throw new Error("Заказ не найден или не назначен на вас");

      await db.update(orders)
        .set({ deliveryStatus: "out_for_delivery" })
        .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, ctx.tenant.id)));

      return { success: true };
    }),

  markDelivered: courierQuery
    .input(z.object({
      orderId: z.number().int().positive(),
      cashAmount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Неверный формат суммы").optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const courierId = ctx.user.id;

      const [order] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, shopId: orders.shopId, status: orders.status, deliveryStatus: orders.deliveryStatus, total: orders.total }).from(orders)
        .where(and(
          eq(orders.id, input.orderId),
          eq(orders.tenantId, ctx.tenant.id),
          eq(orders.courierId, courierId),
          // Удалённый заказ курьеру не показывается и списывать по нему
          // нечего: OrderService.delete уже вернул его резерв на склад.
          // Фильтра здесь не было вовсе, а массовое назначение курьера
          // (order-router) удаление тоже не проверяло — заказ из архива
          // доезжал до этой процедуры и списывал товар второй раз.
          isNull(orders.deletedAt),
          sql`${orders.deliveryStatus} IN ('assigned', 'out_for_delivery')`,
        )).limit(1);
      if (!order) throw new Error("Заказ не найден или не назначен на вас");

      /*
        'returned' стоит наравне с остальными двумя — у соседней процедуры
        completeDelivery он перечислен, здесь его не было. Возвращённый заказ
        товара на складе не держит: резерв по нему снят. Списание по такому
        заказу уводило reserved в минус, молча аннулируя резерв ЧУЖИХ
        открытых заказов.
      */
      if (order.status === "delivered" || order.status === "cancelled" || order.status === "returned") {
        throw new Error("Заказ уже завершён, отменён или возвращён — повторное списание невозможно");
      }

      /*
        Сумма сверяется с ОСТАТКОМ по заказу, а не с его полной суммой, и
        читается это уже внутри транзакции, под блокировкой (см. ниже).

        Здесь стояло `> total * 1.2` — то есть по заказу на 300 можно было
        принять 300 сколько угодно раз подряд. Заказ, проведённый второй раз
        после возврата из архива, получал вторую запись на всю сумму, магазин
        числился переплатившим вдвое, а нижняя граница в расчёте долга эту
        переплату молча съедала.
      */

      await db.transaction(async (tx) => {
        // Lock and re-check inside the transaction — the select above ran
        // outside it, so two concurrent taps (or the mobile app's offline
        // queue submitting the same action twice, per its syncDeliveryActions
        // dispatching queued actions in parallel with no dedup) both pass
        // that check before either commits. This makes the second one queue
        // behind the first and then see the order already delivered, so it
        // fails here instead of deducting stock a second time.
        const [statusUpdateResult] = await tx.update(orders)
          .set({ deliveryStatus: "delivered", deliveredAt: new Date(), status: "delivered" })
          .where(and(
            eq(orders.id, input.orderId), eq(orders.tenantId, ctx.tenant.id),
            sql`${orders.deliveryStatus} IN ('assigned', 'out_for_delivery')`,
          ));
        if ((statusUpdateResult as { affectedRows?: number }).affectedRows !== 1) {
          throw new Error("Заказ уже завершён — повторное выполнение невозможно");
        }

        const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, input.orderId));
        // Get default warehouse for stock operations
        const [defaultWh] = await tx.select({ id: warehouses.id }).from(warehouses)
          .where(and(eq(warehouses.tenantId, ctx.tenant.id), eq(warehouses.isDefault, true))).limit(1);
        const whId = defaultWh?.id;
        if (!whId) throw new Error("Склад по умолчанию не найден");

        // Lock stock rows with FOR UPDATE to prevent race conditions
        for (const item of items) {
          await tx.select({ id: warehouseStock.id }).from(warehouseStock)
            .where(and(eq(warehouseStock.productId, item.productId), eq(warehouseStock.tenantId, ctx.tenant.id), eq(warehouseStock.warehouseId, whId)))
            .for("update");
        }
        // Now safely deduct stock — verify each deduction
        for (const item of items) {
          const qty = Number(item.quantity);
          /*
            Та же арифметика, что в completeDelivery ниже, и по той же причине.

            Стояло `reserved = reserved - qty` без нижней границы и без парной
            правки available. Пока резерв цел, разницы нет; но резерв может
            быть уже снят — заказ возвращали в работу, правили состав, или
            другой путь его освободил. Тогда reserved уходил в МИНУС, а
            available оставался нетронутым, и инвариант
            current_stock = available + reserved расходился: свободный остаток
            становился больше физического, и система разрешала продать товар,
            которого на складе нет.

            Товар уехал, поэтому current_stock падает на полное количество —
            это факт. С резерва снимается ровно то, что там лежало.

            Свободный остаток дверь выводит сама. Прежде его писали выражением
            `available − (qty − LEAST(qty, reserved))`, выведенным из инварианта
            вручную, и каждое место выводило его заново — отсюда и брались
            расхождения вроде описанного выше.
          */
          await shipStock(tx, {
            tenantId: ctx.tenant.id, warehouseId: whId,
            items: [{ productId: item.productId, orderedQuantity: qty, deliveredQuantity: qty }],
            reason: "order_delivery", referenceId: order.id,
            notes: `Доставка ${order.orderNumber}`,
          });
        }

        if (input.cashAmount && Number(input.cashAmount) > 0) {
          // Уже принятое читается ПОСЛЕ смены статуса выше, то есть под её
          // блокировкой: иначе два одновременных нажатия прочитали бы одно и
          // то же «уже принято» и оба сочли, что место есть.
          const priorPaid = await paidForOrder(tx, ctx.tenant.id, order.id);
          assertFitsRemainder(Number(order.total), priorPaid, Number(input.cashAmount));

          await tx.insert(payments).values({
            tenantId: ctx.tenant.id,
            shopId: order.shopId,
            // Tie the payment to the order it settles, so the shop's balance
            // can attribute it — an untied row reads as a loose shop-level
            // payment and would double-count against the order's own total.
            orderId: order.id,
            amount: input.cashAmount,
            type: "payment",
            notes: `Доставка ${order.orderNumber} — наличные от курьера`,
            createdBy: courierId,
          });
        }

        // The order is now delivered and the cash (if any) is recorded, so
        // whatever is still unpaid is owed. Re-derive rather than subtracting
        // the cash — subtracting alone never booked the shortfall.
        await recalcShopDebt(tx, ctx.tenant.id, order.shopId);
      });

      const [ceo] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.tenantId, ctx.tenant.id), eq(users.role, "ceo")))
        .limit(1);

      if (ceo) {
        await NotificationService.create(db, {
          tenantId: ctx.tenant.id,
          userId: ceo.id,
          type: "order",
          title: "Заказ доставлен",
          message: `Заказ ${order.orderNumber} доставлен${input.cashAmount ? `, наличные: ${input.cashAmount}` : ""}`,
        });

        // Push notification to CEO
        sendPushToUser(ceo.id, {
          title: "Заказ доставлен",
          body: `Заказ ${order.orderNumber} доставлен${input.cashAmount ? `, наличные: ${input.cashAmount}` : ""}`,
          data: { type: "order.delivered", orderId: input.orderId },
        }).catch(() => {});
      }

      logger.info("order delivered", { orderId: input.orderId, courierId, cashAmount: input.cashAmount });

      return { success: true };
    }),

  // ── Complete Delivery with payment/return status ────────────────────────────
  completeDelivery: courierQuery
    .input(z.object({
      orderId: z.number().int().positive(),
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
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const courierId = ctx.user.id;

      const [order] = await db.select({
        id: orders.id, orderNumber: orders.orderNumber, shopId: orders.shopId,
        status: orders.status, deliveryStatus: orders.deliveryStatus,
        total: orders.total, subtotal: orders.subtotal, discount: orders.discount,
        paymentMethod: orders.paymentMethod, agentId: orders.agentId,
      }).from(orders)
        .where(and(
          eq(orders.id, input.orderId),
          eq(orders.tenantId, ctx.tenant.id),
          eq(orders.courierId, courierId),
          sql`${orders.deliveryStatus} IN ('assigned', 'out_for_delivery')`,
        )).limit(1);
      if (!order) throw new Error("Заказ не найден или не назначен на вас");

      // Та же защита, что в markDelivered выше. Здесь её не было, и проверялся
      // только deliveryStatus — а операторская частичная доставка
      // (OrderService.applyPartialDelivery) ставит orders.status='delivered', но
      // deliveryStatus не трогает. Поэтому заказ, уже проведённый оператором,
      // проходил сюда второй раз и списывал остаток ещё раз: current_stock падал
      // при неизменном available, то есть ломался инвариант
      // current = available + reserved, и система считала своими 94 единицы,
      // которых физически 84. GREATEST(0, ...) в обоих местах маскировал это —
      // reserved в минус не уходил, а current_stock уходил.
      // Недостача всплывала только при инвентаризации.
      if (order.status === "delivered" || order.status === "cancelled" || order.status === "returned") {
        throw new Error(`Заказ уже завершён (статус «${ORDER_STATUS_LABELS[order.status]}») — повторное списание невозможно`);
      }

      // Declared here, not inside the transaction below, so the notification
      // text and the return value after the transaction commits can still
      // read them — they were previously declared inside the transaction
      // callback and referenced after it closed, which compiles under esbuild
      // (no type-checking at build time) but throws ReferenceError at runtime
      // on every call, after stock and payment were already committed. That
      // silent failure is exactly what could make a courier's app show an
      // error and retry an action that had, in fact, already gone through.
      // Initialized rather than left definite-assignment-only: it is always
      // overwritten inside the transaction below before being read, but TS
      // cannot see that across the async closure boundary.
      let finalStatus: "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned" = "delivered";
      let paidAmount = 0;
      let debtAmount = 0;
      // A partial return shrinks what the shop actually owes — recomputed
      // below (mirroring OrderService.applyPartialDelivery's discount
      // rescale) before debtAmount/orderTotal are derived from it. Left at
      // the order's existing total for every other result, where nothing
      // came back.
      let orderTotal = Number(order.total);

      // The courier types a bare "YYYY-MM-DD"; parsed at local midnight so the
      // DATE column stores the day he picked whatever the server's timezone is.
      //
      // Формат уже проверен схемой, но регулярное выражение пропускает
      // несуществующие дни. «2026-13-45» даёт Invalid Date, и драйвер пишет
      // NULL в NOT NULL колонку due_date, роняя всю транзакцию завершения
      // доставки. «2026-02-30» хуже: JS молча переносит его на 2 марта, и
      // магазин получает срок оплаты, которого курьер не называл. Поэтому дата
      // собирается по частям и сверяется обратно — день обязан остаться тем же.
      let debtDueDate: Date | null = null;
      if (input.debtDueDate) {
        const [year, month, day] = input.debtDueDate.split("-").map(Number);
        const parsed = new Date(year, month - 1, day);
        const sameDay = !Number.isNaN(parsed.getTime())
          && parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
        if (!sameDay) {
          throw new Error(`Такой даты не существует: ${input.debtDueDate}. Укажите дату в формате ГГГГ-ММ-ДД`);
        }
        debtDueDate = parsed;
      }

      await db.transaction(async (tx) => {
        // Re-read and lock the order inside the transaction, re-checking the
        // same deliveryStatus condition as the pre-check above. The earlier
        // select ran outside any transaction, so two concurrent completions
        // for the same order (a slow network retry firing twice, or the
        // mobile app's offline queue submitting a duplicate — see
        // Warehouse-Pro-Mobile's syncDeliveryActions) both pass it before
        // either commits. This lock makes the second one queue behind the
        // first and then see deliveryStatus already "delivered", so it fails
        // loudly here instead of deducting stock and recording a payment a
        // second time for goods and cash that only moved once.
        const [locked] = await tx.select({
          total: orders.total, subtotal: orders.subtotal, discount: orders.discount,
          deliveryStatus: orders.deliveryStatus,
        }).from(orders)
          .where(and(
            eq(orders.id, input.orderId),
            eq(orders.tenantId, ctx.tenant.id),
            eq(orders.courierId, courierId),
          ))
          .for("update")
          .limit(1);
        if (!locked || (locked.deliveryStatus !== "assigned" && locked.deliveryStatus !== "out_for_delivery")) {
          throw new Error("Заказ уже завершён — повторное выполнение невозможно");
        }
        orderTotal = Number(locked.total);
        order.subtotal = locked.subtotal;
        order.discount = locked.discount;
        /*
          Сумма заказа ДО этой доставки — снимком, а не чтением `order.total`
          потом.

          Ниже частичный возврат переписывает строку заказа, и `order` к тому
          моменту описывает уже новое состояние. В бою это сходило с рук
          случайно: драйвер отдаёт раскодированные копии, и прочитанный объект
          остаётся снимком. Стенд же возвращает саму строку таблицы — и в
          журнал правок уходило «было 380, стало 380».

          Полагаться на то, копия перед нами или ссылка, для записи в историю
          нельзя: она и заводится затем, чтобы показать РАЗНИЦУ.
        */
        const totalBeforeDelivery = String(locked.total);

        // Get default warehouse
        const [defaultWh] = await tx.select({ id: warehouses.id }).from(warehouses)
          .where(and(eq(warehouses.tenantId, ctx.tenant.id), eq(warehouses.isDefault, true))).limit(1);
        const whId = defaultWh?.id;
        if (!whId) throw new Error("Склад по умолчанию не найден");

        const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, input.orderId));

        // ── Handle stock based on result ──
        if (input.result === "paid" || input.result === "partial_paid") {
          // Full or partial delivery — deduct stock for ALL items
          for (const item of items) {
            const qty = Number(item.quantity);
            /*
              Увезли всё заказанное: со склада уходит столько же, сколько
              снимается с резерва.

              Здесь была самая живучая из складских бед: `reserved =
              GREATEST(0, reserved - qty)` без парной правки available. При
              просевшем резерве current_stock падал на qty, reserved замирал на
              нуле, а available не менялся — свободный остаток становился больше
              физического, и система разрешала продать то, чего нет. Молча:
              строка выглядела правдоподобной, недостача всплывала
              инвентаризацией. Тот же отказ описан выше на строке 331.

              Теперь available не правится вовсе, а выводится дверью из двух
              других колонок — разъехаться ему негде.
            */
            await shipStock(tx, {
              tenantId: ctx.tenant.id, warehouseId: whId,
              items: [{ productId: item.productId, orderedQuantity: qty, deliveredQuantity: qty }],
              reason: "order_delivery", referenceId: order.id,
              notes: `Доставка ${order.orderNumber}`,
            });
          }
        } else if (input.result === "returned") {
          // Full return — release reserved stock (no current_stock change since it was reserved)
          for (const item of items) {
            const qty = Number(item.quantity);
            // Товар не уезжал, current_stock не меняется — резерв просто
            // возвращается в свободный остаток.
            await releaseStock(tx, {
              tenantId: ctx.tenant.id, warehouseId: whId,
              items: [{ productId: item.productId, quantity: qty }],
            });
          }
        } else if (input.result === "partial_returned") {
          // Условие ветки требовало ещё и input.returnedItems, и запрос без
          // списка просто проваливался мимо всех трёх веток: склад не
          // трогался, движений не записывалось, а заказ ниже безусловно
          // становился delivered. Резерв оставался занят навсегда. Схема выше
          // такой запрос уже не пропускает — эта проверка стоит второй линией,
          // внутри транзакции, где решение о складе и принимается.
          if (!input.returnedItems?.length) {
            throw new Error("Для частичного возврата укажите, что именно вернулось");
          }
          // Partial return — deduct delivered qty, return undelivered qty
          const returnedMap = new Map(input.returnedItems.map(ri => [ri.itemId, ri.returnedQty]));
          // What's actually owed shrinks with what came back — accumulated
          // below and applied to orders.total after the loop, the same way
          // OrderService.applyPartialDelivery does for the operator/agent
          // flow. Without this the shop was being charged for goods that
          // never left the warehouse.
          let newSubtotal = 0;
          /*
            Строки «до» и «после» — для журнала правок.

            Операторский путь (OrderService.applyPartialDelivery) пишет такую
            запись, курьерский не писал ни одной: частичный возврат, сделанный
            курьером, не оставлял в истории заказа НИЧЕГО. На экране заказа
            сумма просто оказывалась меньше, чем в накладной, и объяснить это
            было нечем — ни причины, ни фотографий, ни кто это сделал.
          */
          const oldLines: Array<{ id: number; quantity: string; subtotal: string }> = [];
          const newLines: Array<{ id: number; quantity: string; subtotal: string }> = [];

          for (const item of items) {
            const qty = Number(item.quantity);
            const returnedQty = returnedMap.get(item.id) ?? 0;

            // Вернуть больше, чем было в заказе, нельзя. Без этой проверки
            // курьер обнулял заказ: при returnedQty=25 по строке из 10 и -3 по
            // строке из 5 заказ на 1800 записывался как 90, а при возврате
            // «25 из всего» subtotal уходил в минус (-5500) и попадал в SUM
            // отчёта P&L. Колонки DECIMAL без unsigned, отрицательное значение
            // сохраняется молча. Зеркало проверки из services/order.ts:304.
            if (returnedQty > qty) {
              throw new Error(
                `Возвращено больше, чем в заказе: «${await productLabel(tx, ctx.tenant.id, Number(item.productId))}» — ${returnedQty} из ${qty}`,
              );
            }

            const deliveredQty = qty - returnedQty;
            const newLineSubtotal = Number(item.unitPrice) * deliveredQty;
            newSubtotal += newLineSubtotal;
            oldLines.push({ id: item.id, quantity: item.quantity, subtotal: item.subtotal });
            newLines.push({ id: item.id, quantity: deliveredQty.toFixed(2), subtotal: newLineSubtotal.toFixed(2) });

            if (deliveredQty > 0) {
              /*
                Частичная доставка: с резерва снимается всё, что держал заказ,
                а со склада уходит только увезённое. Невывезенная часть
                возвращается в свободный остаток сама — дверь считает его от
                новых значений.

                Раньше это писали выражением
                `available − deliveredQty + LEAST(qty, reserved)`, выведенным
                из инварианта вручную, и каждое из четырёх мест выводило его
                заново.
              */
              await shipStock(tx, {
                tenantId: ctx.tenant.id, warehouseId: whId,
                items: [{ productId: item.productId, orderedQuantity: qty, deliveredQuantity: deliveredQty }],
                reason: "order_delivery", referenceId: order.id,
                notes: `Доставка ${order.orderNumber} (частичный возврат ${returnedQty})`,
              });
            } else {
              // Вернули всё — товар не уезжал, current_stock не меняется.
              await releaseStock(tx, {
                tenantId: ctx.tenant.id, warehouseId: whId,
                items: [{ productId: item.productId, quantity: qty }],
              });
            }

            /*
              Строка заказа переписывается ЦЕЛИКОМ, а не только доставленным
              количеством.

              subtotal здесь не трогали, и строка оставалась стоить как
              заказанная, хотя сумма заказа уже уменьшилась. То есть
              SUM(order_items.subtotal) переставал сходиться с orders.total на
              одном и том же заказе.

              Три отчёта в analytics-router это обходили — считали выручку как
              `доставленное × цену` и написали в комментариях, почему. Два
              других не обошли: прогноз спроса (forecast-router) и «топ товаров»
              в телеграме брали subtotal как есть и показывали проданным то,
              что вернулось. Операторский путь строку переписывает
              (services/order.ts, applyPartialDelivery) — расходились именно
              два пути одной операции.
            */
            await tx.update(orderItems)
              .set({
                deliveredQuantity: String(deliveredQty),
                returnReason: input.returnReason ?? null,
                subtotal: newLineSubtotal.toFixed(2),
              })
              .where(eq(orderItems.id, item.id));
          }

          // Rescale the discount by the percentage it originally represented,
          // same as OrderService.applyPartialDelivery — subtracting the
          // original absolute discount from a shrunk subtotal unchanged could
          // drive the total negative.
          const originalSubtotal = Number(order.subtotal);
          const discountPct = originalSubtotal > 0 ? (Number(order.discount) / originalSubtotal) * 100 : 0;
          const newDiscount = newSubtotal * (discountPct / 100);
          orderTotal = Math.max(0, newSubtotal - newDiscount);
          await tx.update(orders).set({
            subtotal: newSubtotal.toFixed(2),
            discount: newDiscount.toFixed(2),
            total: orderTotal.toFixed(2),
          }).where(and(eq(orders.id, input.orderId), eq(orders.tenantId, ctx.tenant.id)));

          /*
            Запись в журнал правок — та же, что пишет операторский путь.

            Курьер уменьшает сумму заказа, и до сих пор это не оставляло следа:
            в истории заказа пусто, кто и почему списал часть — неизвестно.
            Оператор ту же операцию логировал с причиной и фотографиями.

            Тип записи тот же — «partial_delivery», — чтобы экран истории не
            пришлось учить второму названию одного и того же события.
          */
          await tx.insert(orderAdjustments).values({
            tenantId: ctx.tenant.id,
            orderId: order.id,
            adjustedBy: courierId,
            type: "partial_delivery",
            oldValue: { total: totalBeforeDelivery, items: oldLines },
            newValue: { total: orderTotal.toFixed(2), items: newLines },
            reason: input.returnReason ?? null,
            // Фотографий у курьерского пути нет: мобильное приложение их при
            // завершении доставки не шлёт (CompleteDeliveryInput). Ставить сюда
            // что-то другое значило бы выдать за доказательство то, чем оно не
            // является.
            photos: null,
          });
        }

        paidAmount = Number(input.paidAmount ?? 0);
        // Формат уже проверен схемой; здесь — вторая линия на случай, когда
        // процедуру вызывают в обход схемы, и явная граница по сумме заказа.
        // Раньше не было ни того ни другого: NaN проходил насквозь, платёж
        // молча не записывался (paidAmount > 0 — ложь при NaN), а заказ
        // закрывался как доставленный. Запас 20% — тот же, что в markDelivered:
        // округление вверх «на сдачу» бывает, оплата вдвое больше заказа — нет.
        if (!Number.isFinite(paidAmount) || paidAmount < 0) {
          throw new Error(`Некорректная сумма оплаты: «${input.paidAmount}». Введите число, разделитель — точка`);
        }
        /*
          Сверка с ОСТАТКОМ, а не с полной суммой заказа — та же правка, что
          в markDelivered выше. Прежнее `> orderTotal * 1.2` позволяло принять
          полную сумму по уже оплаченному заказу: заказ, проведённый второй
          раз, получал вторую запись на все деньги.
        */
        const priorPaid = await paidForOrder(tx, ctx.tenant.id, order.id);
        if (paidAmount > 0) assertFitsRemainder(orderTotal, priorPaid, paidAmount);

        // Долг считается от того, что осталось неоплаченным ПО ЗАКАЗУ ЦЕЛИКОМ,
        // а не только по этой доставке.
        debtAmount = orderTotal - priorPaid - paidAmount;

        // ── Determine final order status ──
        const deliveryResult = input.result;

        // Only a full return leaves the order undelivered. A partial return or a
        // partial payment still means goods were handed over, so the order is
        // "delivered" — what came back is recorded per line, and any unpaid
        // remainder lives on the payment row and the shop's debt.
        finalStatus = input.result === "returned" ? "returned" : "delivered";

        // ── Update order ──
        await tx.update(orders).set({
          status: finalStatus as "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned",
          deliveryStatus: "delivered",
          deliveredAt: new Date(),
          deliveryResult,
          deliveryNotes: input.notes ? sanitizeString(input.notes) : null,
        }).where(and(eq(orders.id, input.orderId), eq(orders.tenantId, ctx.tenant.id)));

        // ── Record payment ──
        if (paidAmount > 0) {
          await tx.insert(payments).values({
            tenantId: ctx.tenant.id,
            shopId: order.shopId,
            orderId: order.id,
            amount: String(paidAmount),
            type: "payment",
            paymentMethod: input.paymentMethod,
            status: debtAmount > 0 ? "partially_paid" : "paid",
            totalOrderAmount: String(orderTotal),
            paidAmount: String(paidAmount),
            debtAmount: String(Math.max(0, debtAmount)),
            debtDueDate,
            paidAt: new Date(),
            notes: input.notes ? sanitizeString(input.notes) : null,
            createdBy: courierId,
          });
        }

        // Status and payment are both written; re-derive what the shop owes.
        await recalcShopDebt(tx, ctx.tenant.id, order.shopId);

        // ── Create debt reminder if partial payment ──
        if (debtAmount > 0 && debtDueDate) {
          await tx.insert(debtReminders).values({
            tenantId: ctx.tenant.id,
            shopId: order.shopId,
            orderId: order.id,
            amount: String(debtAmount),
            dueDate: debtDueDate,
            status: "pending",
          });
        }
      });

      // ── Notifications ──
      const resultLabels: Record<string, string> = {
        paid: "100% оплачен",
        partial_paid: `частично оплачен (${paidAmount.toLocaleString("ru")} из ${orderTotal.toLocaleString("ru")})`,
        returned: "возврат",
        partial_returned: "частичный возврат",
      };

      // Notify agent
      if (order.agentId) {
        await NotificationService.create(db, {
          tenantId: ctx.tenant.id,
          userId: order.agentId,
          type: "order",
          title: "Заказ доставлен",
          message: `Заказ ${order.orderNumber} — ${resultLabels[input.result]}`,
        });
        sendPushToUser(order.agentId, {
          title: "Заказ доставлен",
          body: `${order.orderNumber} — ${resultLabels[input.result]}`,
          data: { type: "order.delivered", orderId: input.orderId },
        }).catch(() => {});
      }

      // Notify CEO
      const [ceo] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.tenantId, ctx.tenant.id), eq(users.role, "ceo"))).limit(1);
      if (ceo) {
        await NotificationService.create(db, {
          tenantId: ctx.tenant.id,
          userId: ceo.id,
          type: "order",
          title: "Заказ доставлен",
          message: `Заказ ${order.orderNumber} — ${resultLabels[input.result]}`,
        });
      }

      logger.info("delivery completed", { orderId: input.orderId, courierId, result: input.result, paidAmount });

      return { success: true, result: input.result, finalStatus };
    }),

  markFailed: courierQuery
    .input(z.object({
      orderId: z.number().int().positive(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const courierId = ctx.user.id;

      const [order] = await db.select({ id: orders.id, status: orders.status, deliveryStatus: orders.deliveryStatus, orderNumber: orders.orderNumber }).from(orders)
        .where(and(
          eq(orders.id, input.orderId),
          eq(orders.tenantId, ctx.tenant.id),
          eq(orders.courierId, courierId),
          sql`${orders.deliveryStatus} IN ('assigned', 'out_for_delivery')`,
        )).limit(1);
      if (!order) throw new Error("Заказ не найден или не назначен на вас");

      /*
        'returned' входит в список наравне с остальными двумя.

        Его тут не было, а у completeDelivery — есть. Заказ, по которому курьер
        уже отчитался возвратом, попадал сюда и получал status='new' прямым
        UPDATE-ом, минуя складскую разницу: при возврате резерв был снят, а
        новый статус его снова подразумевает — заказ оказывался в работе, не
        держа на складе ничего. Следующая доставка списывала товар, который за
        ним не числился.
      */
      if (order.status === "delivered" || order.status === "cancelled" || order.status === "returned") {
        throw new Error("Заказ уже завершён, отменён или возвращён — повторное действие невозможно");
      }

      const safeReason = input.reason ? sanitizeString(input.reason) : "";

      await db.transaction(async (tx) => {
        // Update order status — keep deliveryStatus for history, but allow reassignment
        await tx.update(orders)
          .set({ deliveryStatus: "failed", status: "new", courierId: null })
          .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, ctx.tenant.id)));

        // The reservation deliberately stays in place. The goods never left the
        // warehouse (current_stock is only touched on delivery) and the order goes
        // back to "new" for another delivery attempt, so it still owns them.
        // Releasing here made the same units sellable twice and drove `reserved`
        // negative once the retried delivery completed. Stock is returned only
        // when the order is cancelled or deleted.
      });

      const [ceo] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.tenantId, ctx.tenant.id), eq(users.role, "ceo")))
        .limit(1);

      if (ceo) {
        await NotificationService.create(db, {
          tenantId: ctx.tenant.id,
          userId: ceo.id,
          type: "order",
          title: "Доставка не состоялась",
          message: `Заказ ${order.orderNumber}${safeReason ? ` — ${safeReason}` : ""}`,
        });

        // Push notification to CEO
        sendPushToUser(ceo.id, {
          title: "Доставка не состоялась",
          body: `Заказ ${order.orderNumber}${safeReason ? ` — ${safeReason}` : ""}`,
          data: { type: "order.failed", orderId: input.orderId },
        }).catch(() => {});
      }

      logger.info("order delivery failed", { orderId: input.orderId, courierId, reason: input.reason });

      return { success: true };
    }),
});
