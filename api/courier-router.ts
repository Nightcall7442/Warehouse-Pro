import { z } from "zod";
import { createRouter, courierQuery, operatorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { orders, shops, users, payments, notifications, orderItems, products, warehouseStock, warehouses, debtReminders } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { sseBus } from "./lib/sse";
import { logger } from "./lib/logger";
import { sendPushToUser } from "./services/push-service";
import { sanitizeString } from "./lib/sanitize";
import { recalcShopDebt } from "./services/shop-debt";
import { recordStockMovement } from "./services/stock-ledger";

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
        .leftJoin(shops, eq(orders.shopId, shops.id))
        .where(and(
          eq(orders.tenantId, ctx.tenant.id),
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
      .leftJoin(shops, eq(orders.shopId, shops.id))
      .where(and(
        eq(orders.tenantId, ctx.tenant.id),
        eq(orders.courierId, courierId),
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
      if (order.status !== "processing" && order.status !== "new") {
        throw new Error("Можно назначить курьера только на заказ в статусе 'новый' или 'в обработке'");
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

      await db.insert(notifications).values({
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
          sql`${orders.deliveryStatus} IN ('assigned', 'out_for_delivery')`,
        )).limit(1);
      if (!order) throw new Error("Заказ не найден или не назначен на вас");

      if (order.status === "delivered" || order.status === "cancelled") {
        throw new Error("Заказ уже завершён или отменён — повторное списание невозможно");
      }

      if (input.cashAmount && Number(input.cashAmount) > Number(order.total) * 1.2) {
        throw new Error("Сумма наличных превышает сумму заказа");
      }

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
          const [result] = await tx.execute(sql`
            UPDATE warehouse_stock
            SET current_stock = current_stock - ${qty}, reserved = reserved - ${qty}
            WHERE product_id = ${item.productId} AND tenant_id = ${ctx.tenant.id} AND warehouse_id = ${whId}
          `);
          // If no rows affected, stock row doesn't exist — log warning but continue
          if (result.affectedRows === 0) {
            console.warn(`[Stock] No stock row for product ${item.productId} in tenant ${ctx.tenant.id}`);
          }
          await recordStockMovement(tx, {
            tenantId: ctx.tenant.id, warehouseId: whId, productId: item.productId,
            type: "out", quantity: qty, reason: "order_delivery", referenceId: order.id,
            notes: `Доставка ${order.orderNumber}`,
          });
        }

        if (input.cashAmount && Number(input.cashAmount) > 0) {
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
        await db.insert(notifications).values({
          tenantId: ctx.tenant.id,
          userId: ceo.id,
          type: "order",
          title: "Заказ доставлен",
          message: `Заказ ${order.orderNumber} доставлен${input.cashAmount ? `, наличные: ${input.cashAmount}` : ""}`,
        });

        sseBus.emit({
          type: "notification.new",
          tenantId: ctx.tenant.id,
          userId: ceo.id,
          data: { title: "Заказ доставлен", orderNumber: order.orderNumber },
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
        throw new Error(`Заказ уже завершён (статус «${order.status}») — повторное списание невозможно`);
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
            // Товар физически уехал, поэтому current_stock падает на полное
            // количество — это факт, а не бухгалтерия. Но снять с резерва
            // больше, чем там лежит, нельзя: снимается LEAST(qty, reserved), а
            // недостающая часть уходит из available, потому что физически она
            // пришла оттуда.
            //
            // Было `reserved = GREATEST(0, reserved - qty)` без парной правки
            // available: при просевшем резерве current_stock падал на qty,
            // reserved замирал на нуле, available не менялся — и инвариант
            // current_stock = available + reserved расходился ровно на
            // недостачу. Это тот самый отказ, что описан выше на строке 331.
            //
            // available считается ПЕРВЫМ: MySQL вычисляет SET слева направо и
            // видит уже обновлённые колонки, поэтому reserved обязан стоять
            // последним, иначе LEAST посчитается от нового значения.
            await tx.execute(sql`
              UPDATE warehouse_stock
              SET available = available - (${qty} - LEAST(${qty}, reserved)),
                  current_stock = current_stock - ${qty},
                  reserved = GREATEST(0, reserved - ${qty})
              WHERE product_id = ${item.productId} AND tenant_id = ${ctx.tenant.id} AND warehouse_id = ${whId}
            `);
            await recordStockMovement(tx, {
              tenantId: ctx.tenant.id, warehouseId: whId, productId: item.productId,
              type: "out", quantity: qty, reason: "order_delivery", referenceId: order.id,
              notes: `Доставка ${order.orderNumber}`,
            });
          }
        } else if (input.result === "returned") {
          // Full return — release reserved stock (no current_stock change since it was reserved)
          for (const item of items) {
            const qty = Number(item.quantity);
            // Товар не уезжал, current_stock не меняется — резерв просто
            // возвращается в свободный остаток. Вернуть можно ровно столько,
            // сколько там лежало: LEAST(qty, reserved). Прибавляя available
            // полное qty при просевшем резерве, мы дописывали в свободный
            // остаток единицы, которых на складе нет.
            await tx.execute(sql`
              UPDATE warehouse_stock
              SET available = available + LEAST(${qty}, reserved),
                  reserved = GREATEST(0, reserved - ${qty})
              WHERE product_id = ${item.productId} AND tenant_id = ${ctx.tenant.id} AND warehouse_id = ${whId}
            `);
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
                `Возвращено больше, чем в заказе: ${returnedQty} из ${qty} (позиция #${item.id})`,
              );
            }

            const deliveredQty = qty - returnedQty;
            newSubtotal += Number(item.unitPrice) * deliveredQty;

            if (deliveredQty > 0) {
              // Deduct delivered stock; the returned portion of the reservation
              // goes back to available (goods physically returned to the warehouse).
              // Уехала только доставленная часть, поэтому current_stock падает
              // на deliveredQty. Резерв снимается весь, но не больше, чем есть:
              // LEAST(qty, reserved).
              //
              // available выводится из инварианта, а не подбирается: чтобы
              // current_stock = available + reserved сохранилось, нужно
              //   available' = available − deliveredQty + LEAST(qty, reserved).
              // Без перекоса это даёт ровно `+ returnedQty`, как и было
              // задумано; при просевшем резерве — только то, что вернулось на
              // самом деле, вместо приписки несуществующих единиц.
              //
              // available первым: MySQL вычисляет SET слева направо и видит уже
              // обновлённые колонки.
              await tx.execute(sql`
                UPDATE warehouse_stock
                SET available = available - ${deliveredQty} + LEAST(${qty}, reserved),
                    current_stock = current_stock - ${deliveredQty},
                    reserved = GREATEST(0, reserved - ${qty})
                WHERE product_id = ${item.productId} AND tenant_id = ${ctx.tenant.id} AND warehouse_id = ${whId}
              `);
              // Only the delivered part left the warehouse; the rest never did.
              await recordStockMovement(tx, {
                tenantId: ctx.tenant.id, warehouseId: whId, productId: item.productId,
                type: "out", quantity: deliveredQty, reason: "order_delivery", referenceId: order.id,
                notes: `Доставка ${order.orderNumber} (частичный возврат ${returnedQty})`,
              });
            } else {
              // Вернули всё — товар не уезжал, current_stock не меняется.
              // Возвращается ровно то, что лежит в резерве: LEAST(qty, reserved).
              // available первым — MySQL вычисляет SET слева направо.
              await tx.execute(sql`
                UPDATE warehouse_stock
                SET available = available + LEAST(${qty}, reserved),
                    reserved = GREATEST(0, reserved - ${qty})
                WHERE product_id = ${item.productId} AND tenant_id = ${ctx.tenant.id} AND warehouse_id = ${whId}
              `);
            }

            // Update delivered quantity on order item
            await tx.update(orderItems)
              .set({ deliveredQuantity: String(deliveredQty), returnReason: input.returnReason ?? null })
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
        if (paidAmount > orderTotal * 1.2) {
          throw new Error(`Сумма оплаты (${paidAmount}) превышает сумму заказа (${orderTotal})`);
        }
        debtAmount = orderTotal - paidAmount;

        // ── Determine final order status ──
        let deliveryResult = input.result;

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
        await db.insert(notifications).values({
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
        await db.insert(notifications).values({
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

      if (order.status === "delivered" || order.status === "cancelled") {
        throw new Error("Заказ уже завершён или отменён — повторное действие невозможно");
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
        await db.insert(notifications).values({
          tenantId: ctx.tenant.id,
          userId: ceo.id,
          type: "order",
          title: "Доставка не состоялась",
          message: `Заказ ${order.orderNumber}${safeReason ? ` — ${safeReason}` : ""}`,
        });

        sseBus.emit({
          type: "notification.new",
          tenantId: ctx.tenant.id,
          userId: ceo.id,
          data: { title: "Доставка не состоялась", orderNumber: order.orderNumber },
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
