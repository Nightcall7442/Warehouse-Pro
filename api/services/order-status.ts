import { eq, and, sql, isNull, isNotNull, inArray } from "drizzle-orm";
import { applyStockEffect, releaseStock, reserveStock } from "./stock-ledger";
import { orders, orderItems, warehouseStock, shops, users } from "@db/schema";
import { ORDER_STATUS_LABELS, holdsStock } from "../lib/order-status";
import { isReopen, reversesRevenue, assertReopenable, clearDeliveryTrace, dateSecondLife } from "./order-reopen";
import { cache, CacheKeys } from "../lib/cache";
import { logger } from "../lib/logger";
import { affectedRows } from "../lib/db-rows";
import type { Db, AuditActor } from "./order-shared";
import { resolveOrderWarehouse, settleShopDebt, returnedQuantitiesByProduct, heldQuantity, stockEffect, productNames, productLabel, canCancelAnyOrder, orderAccessError, traceOrderChange, traceDebtChange } from "./order-shared";

export async function cancel(db: Db, tenantId: number, orderId: number, opts: { userId: number; userRole: string }) {
  /*
    Заполняется внутри транзакции, читается после её успеха: писать след
    изнутри нельзя — откат отменил бы и его, а запись о несостоявшемся
    списании хуже её отсутствия.

    Держатель, а не простая переменная: анализ потока не видит присваивания
    внутри замыкания транзакции и считает переменную по-прежнему пустой, а
    поля внутри ветки — недоступными.
  */
  const cancelled: { debt: { total: number; shopId: number } | null } = { debt: null };
  await db.transaction(async (tx) => {
    const isPrivileged = canCancelAnyOrder(opts.userRole);
    const conditions = [eq(orders.id, orderId), eq(orders.tenantId, tenantId)];
    // Non-privileged users can only cancel their own orders
    if (!isPrivileged) {
      conditions.push(eq(orders.agentId, opts.userId));
    }
    // A soft-deleted order has already had its stock released — cancelling it
    // again would credit the warehouse twice.
    conditions.push(isNull(orders.deletedAt));
    // Locked so a second concurrent cancel for the same order queues here
    // instead of also passing the status check below and releasing the same
    // reserved stock a second time once the first call's release commits.
    const [order] = await tx.select({
      id: orders.id, status: orders.status, shopId: orders.shopId,
      total: orders.total, paymentMethod: orders.paymentMethod,
    }).from(orders).where(and(...conditions)).for("update").limit(1);
    // «Заказ не найден» значило и «нет такого», и «чужой». Права не
    // меняются — меняется объяснение.
    if (!order) throw await orderAccessError(tx, tenantId, orderId, "Отменить");
    if (order.status !== "new") throw new Error("Можно отменить только новые заказы");

    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    // Освобождаем ровно то, что строка действительно держит: частичная
    // доставка и проведённый возврат уже вернули своё, поэтому отдать назад
    // полное quantity значит аннулировать резерв чужих заказов.
    const cancelReturned = await returnedQuantitiesByProduct(tx, tenantId, orderId);
    if (items.length > 0) {
      const cancelWhId = await resolveOrderWarehouse(tx, tenantId);

      // Lock stock rows to prevent race conditions
      for (const item of items) {
        await tx.select({ id: warehouseStock.id }).from(warehouseStock)
          .where(and(eq(warehouseStock.productId, item.productId), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, cancelWhId)))
          .for("update");
      }
      // Товар не уезжал — current_stock не меняется, резерв возвращается в
      // свободный остаток. Вернуть можно ровно столько, сколько там лежит:
      // LEAST(held, reserved). Прежняя запись прибавляла available полное
      // held независимо от резерва, и при просевшем резерве свободный остаток
      // получал единицы, которых на складе нет.
      //
      // available идёт ПЕРВЫМ: MySQL вычисляет SET слева направо и видит уже
      // обновлённые колонки, а LEAST нужен от старого резерва.
      await releaseStock(tx, {
        tenantId, warehouseId: cancelWhId,
        items: items.map(i => ({ productId: i.productId, quantity: heldQuantity(i, cancelReturned) })),
      });
    }
    await tx.update(orders).set({ status: "cancelled" }).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), eq(orders.status, "new")));
    await settleShopDebt(tx, tenantId, order.shopId);

    /*
      Отмена долгового заказа — это списание долга, а не мелочь.

      Долговый заказ должен деньгами с момента оформления, ещё до отгрузки
      (services/shop-debt.ts). Значит агент может взять с магазина наличные
      и вместо оплаты отменить заказ: долг исчезнет, деньги останутся на
      руках, а в системе не будет ни строки. Отмена не писалась ни в
      журнал, ни в уведомления — узнать об этом было неоткуда.

      Обычную отмену (заказ ещё не в долг) это не трогает: там нечего
      списывать, и шуметь незачем.
    */
    if (order.paymentMethod === "debt") {
      cancelled.debt = { total: Number(order.total ?? 0), shopId: order.shopId };
    }
  });

  cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));

  const debtTrace = cancelled.debt;
  if (debtTrace) {
    const [shop] = await db.select({ name: shops.name }).from(shops)
      .where(and(eq(shops.id, debtTrace.shopId), eq(shops.tenantId, tenantId))).limit(1);
    const [row] = await db.select({ orderNumber: orders.orderNumber }).from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1);
    await traceDebtChange(db, tenantId, { id: opts.userId, role: opts.userRole }, {
      action: "order.cancelled",
      orderId,
      orderNumber: String(row?.orderNumber ?? orderId),
      shopId: debtTrace.shopId,
      shopName: String(shop?.name ?? "Магазин"),
      amount: debtTrace.total,
    });
  }

  return { success: true };
}

/**
 * actor необязателен намеренно: процедуру зовут и внутренние пути (обмен с
 * 1С, курьерская синхронизация), у которых человека за спиной нет. Когда он
 * есть — попадает в журнал действий вместе с направлением перехода.
 */

export async function updateStatus(
  db: Db, tenantId: number, orderId: number,
  newStatus: "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned",
  actor?: { id: number; role: string },
) {
  let auditAction: string | null = null;
  let statusBefore = "";

  await db.transaction(async (tx) => {
    const [order] = await tx.select({
      id: orders.id, status: orders.status, shopId: orders.shopId,
      agentId: orders.agentId, total: orders.total, subtotal: orders.subtotal,
      deliveryStatus: orders.deliveryStatus, paymentMethod: orders.paymentMethod,
      orderNumber: orders.orderNumber,
    }).from(orders)
      // Soft-deleted orders already gave their stock back; moving them through
      // the lifecycle again would double-count it. Locked so two concurrent
      // status changes for the same order serialize instead of both reading
      // the same starting status and each applying their own stock delta on
      // top of it — the second call now sees the first's already-committed
      // status and computes its delta from there.
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt)))
      .for("update")
      .limit(1);
    if (!order) throw new Error("Заказ не найден");

    // Nothing to do when the status is unchanged — and re-applying the stock
    // move would double-count it.
    if (order.status === newStatus) return { success: true };

    /*
      Возврат закрытого заказа в работу — не просто ещё одно направление.
      Заказ начинает вторую жизнь с накопленным грузом первой, а понятия
      «круг» у него нет. Два случая посчитать нельзя в принципе (проведённый
      возврат и частичная доставка), и они отсекаются здесь, до единой
      записи — см. services/order-reopen.ts, там же и объяснение почему.
    */
    const reopening = isReopen(order.status, newStatus);
    if (reopening) await assertReopenable(tx, tenantId, orderId, order.orderNumber);

    // Запоминается для журнала: после транзакции старого статуса уже не
    // прочитать, а именно направление перехода и объясняют потом.
    statusBefore = order.status;
    auditAction = reopening ? "order.reopened"
      : reversesRevenue(order.status, newStatus) ? "order.revenue_reversed"
      : null;

    // Any status may follow any other. Operators legitimately correct
    // mistakes both ways ("delivered by accident" → back to new), and the
    // stock/debt deltas below are computed from the difference between the
    // two statuses, so every direction settles correctly on its own.
    const before = stockEffect(order.status);
    const after = stockEffect(newStatus);
    const d = {
      current: after.current - before.current,
      reserved: after.reserved - before.reserved,
      available: after.available - before.available,
    };

    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));

    // Units this order already handed back through a completed return
    // document ("Возвраты"). That flow has its own stock credit, so those
    // units are physically on the shelf again. Counting them here as well
    // would credit the same goods a second time — the two return paths are
    // both allowed, so they have to compose rather than each assume it is
    // the only one.
    // Two plain selects and a sum in JS rather than a join + GROUP BY: the
    // volume here is a handful of rows, and it keeps this query inside the
    // subset of the builder the service-level test doubles implement.
    const returnedByProduct = await returnedQuantitiesByProduct(tx, tenantId, orderId);

    // A line that already went through partial delivery moved only
    // `deliveredQuantity` physically, not the full ordered `quantity` — the
    // undelivered remainder was released back to `available`, not held as
    // stock waiting to move again. Every stock delta below must be sized off
    // what's actually still in play for this line, or a later status change
    // (e.g. correcting "delivered" back to "cancelled") fabricates stock for
    // units that were never there.
    const effectiveQty = (i: (typeof items)[number]) => heldQuantity(i, returnedByProduct);

    /*
      Здесь стоял отказ от складской правки, когда delivery_status уже был
      'delivered': считалось, что курьер провёл склад сам и повторять нечего.
      Верного случая у этого условия не оказалось ни одного.

      Поле delivery_status ставится в 'delivered' ровно в двух местах
      (courier-router markDelivered и completeDelivery), и ОБА пишут его
      одной строкой со статусом заказа. Значит:

        • статус стал 'delivered' — сюда мы просто не дойдём, выше стоит
          выход по равенству статусов;
        • статус стал 'returned' (курьер привёз товар обратно) — а эта ветка
          current_stock НЕ трогала, она лишь снимала резерв. Поправка
          'returned' → 'delivered' обязана списать товар, и ровно её условие
          и глушило;
        • статус откатили в работу и проводят заново — delivery_status от
          первой жизни оставался 'delivered' навсегда, и списания не
          происходило вовсе: товар уезжал, current_stock не падал.

      В последнем случае инвариант current = available + reserved при этом
      сходился, поэтому ни одна сверка целостности расхождения не видела.

      От двойного проведения защищает не это поле, а сравнение статусов:
      ранний выход выше и условие eq(status, order.status) в UPDATE ниже.
    */
    if (items.length > 0 && (d.current || d.reserved || d.available)) {
      const whId = await resolveOrderWarehouse(tx, tenantId);

      // Lock every affected row in one query before reading or writing.
      const stockRows = await tx.select({
        productId: warehouseStock.productId,
        currentStock: warehouseStock.currentStock,
        available: warehouseStock.available,
        // Резерв читается наравне с остальными двумя: без него он не
        // участвовал в проверке достатка и уходил в минус — см. ниже.
        reserved: warehouseStock.reserved,
      })
        .from(warehouseStock)
        .where(and(
          eq(warehouseStock.tenantId, tenantId),
          eq(warehouseStock.warehouseId, whId),
          sql`${warehouseStock.productId} IN (${sql.join(items.map(i => sql`${i.productId}`), sql`, `)})`
        ))
        .for("update");

      /*
        Отказ вместо записи, которую потом пришлось бы разбирать.

        Проверялись current_stock и available, а РЕЗЕРВ — нет, хотя правка
        ниже пишет ему `reserved + delta` без нижней границы. Резерв под
        заказом может оказаться меньше ожидаемого: его мог снять другой путь.
        Тогда он уходил в минус — а это не «немного неточно»: отрицательный
        резерв молча аннулирует резерв ЧУЖИХ открытых заказов, и их товар
        становится доступен к продаже. Инвариант current = available +
        reserved при этом продолжает сходиться, поэтому ни одна сверка
        целостности такого не видит.
      */
      const short = items.filter(i => {
        const row = stockRows.find(r => Number(r.productId) === i.productId);
        if (!row) return false;
        const qty = effectiveQty(i);
        return (d.current < 0 && Number(row.currentStock) + d.current * qty < 0)
          || (d.available < 0 && Number(row.available) + d.available * qty < 0)
          || (d.reserved < 0 && Number(row.reserved) + d.reserved * qty < 0);
      });
      if (short.length > 0) {
        const names = await productNames(tx, tenantId, short.map(i => i.productId));
        throw new Error(`Недостаточно товара на складе: ${short.map(i => `«${names.get(i.productId) ?? `#${i.productId}`}»`).join(", ")}`);
      }

      /*
        Товар без карточки остатка на этом складе.

        Раньше он молча проваливался мимо: UPDATE ниже идёт по
        `WHERE product_id IN (…)` и несуществующую строку не задевает, а
        запись в журнал движений писалась всё равно. То есть журнал сообщал
        о приходе товара на склад, который об этом не знает, — и при откате
        заказа его единицы просто исчезали.

        Отказ, а не тихий пропуск: посчитать движение верно нельзя ни так,
        ни эдак, а потеря товара молча хуже понятного отказа. Оператору
        сказано, что делать.
      */
      const missing = items.filter(i => !stockRows.some(r => Number(r.productId) === i.productId));
      if (missing.length > 0) {
        const names = await productNames(tx, tenantId, missing.map(i => i.productId));
        throw new Error(
          `Нет карточки остатка на складе: ${missing.map(i => `«${names.get(i.productId) ?? `#${i.productId}`}»`).join(", ")}. ` +
          `Заведите остаток по этому товару — иначе движение по заказу учесть негде.`,
        );
      }

      /*
        Дверь принимает ДВА числа из трёх: сколько лежит на складе и сколько
        отложено. Третье — свободный остаток — она выводит сама, и здесь это
        не потеря, а проверка: у всех переходов d.available в точности равно
        d.current − d.reserved (см. stockEffect выше), потому что иначе
        строка перестала бы сходиться. Раньше все три числа писались
        независимо, и разойтись им было где.
      */
      await applyStockEffect(tx, {
        tenantId, warehouseId: whId,
        items: items.map(i => ({ productId: i.productId, quantity: effectiveQty(i) })),
        shift: { onHand: d.current, held: d.reserved },
        // Движение пишет дверь, и только когда товар правда двигался:
        // статус, который лишь откладывает или освобождает, перекладывает два
        // числа и в журнал не идёт.
        reason: d.current < 0 ? "order_delivery" : "order_return",
        referenceId: orderId,
        notes: `Заказ: ${order.status} → ${newStatus}`,
      });
    }
    /*
      Заказ, закрытый из веба, тоже считается доставленным курьером.

      delivery_status и delivered_at заполняло только курьерское приложение,
      а оператор закрывает заказ кнопкой «Выполнить». Показатели курьера в
      итоге меряли не работу, а то, через какой экран её отметили.

      Считать мы теперь умеем и без этого (см. calculateCourierStats), но
      данные всё равно надо привести в порядок: без delivered_at период
      доставки определяется по дате СОЗДАНИЯ заказа, и доставка конца месяца
      попадает не в тот месяц, за который курьеру платят.
    */
    const deliveryPatch = newStatus === "delivered"
      ? { deliveryStatus: "delivered" as const, deliveredAt: new Date() }
      : {};

    // Выход из ожидания снимает причину: подтверждено или отклонено — она отработала.
    const holdPatch = order.status === "pending" && newStatus !== "pending" ? { holdReason: null } : {};
    const [statusUpdateResult] = await tx.update(orders).set({ status: newStatus, ...deliveryPatch, ...holdPatch })
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), eq(orders.status, order.status)));
    if ((statusUpdateResult as { affectedRows?: number }).affectedRows !== 1) {
      throw new Error("Статус заказа уже был изменён другим действием");
    }

    /*
      Следы первой доставки стираются ПОСЛЕ складской правки: она считается
      по delivered_quantity, и обнулить его раньше значило бы вернуть на
      склад не то количество, которое заказ на самом деле держал.
    */
    if (reopening) {
      await clearDeliveryTrace(tx, tenantId, orderId);
      /*
        И дата заказа становится датой второго круга: иначе выручка,
        комиссия, план и прогноз спроса второго круга падают в месяц
        первого — уже закрытый и уже кем-то прочитанный. Первая дата
        уходит в first_ordered_at, см. order-reopen.
      */
      await dateSecondLife(tx, tenantId, orderId);
    }

    await settleShopDebt(tx, tenantId, order.shopId);
  });

  cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));

  /*
    След в журнале — только для откатов, а не для каждой смены статуса.

    Обычное движение вперёд (новый → в обработке → доставлен) объясняется
    само и в журнале было бы шумом, за которым не видно важного. А вот два
    перехода однажды придут объяснять:

      • заказ вернули из архива в работу — товар и деньги пересчитываются
        заново, и до сих пор это не оставляло НИ ОДНОГО следа: ни записи,
        ни отметки. У отмены такой след есть (см. cancel ниже), у смены
        статуса не было;
      • заказ вывели из «доставлен» — это откат состоявшейся продажи, то
        есть выручки. В закрытом месяце такое движение меняет отчётность
        задним числом.

    Пишется ПОСЛЕ транзакции: журнал не должен уметь отменить саму правку.
  */
  if (auditAction) {
    const { recordAudit } = await import("./audit-log");
    await recordAudit(db, {
      tenantId,
      actorId: actor?.id,
      action: auditAction,
      targetType: "order",
      targetId: orderId,
      meta: { from: statusBefore, to: newStatus, actorRole: actor?.role },
    });
  }

  // Notify agent about status change (non-blocking)
  try {
    const [orderRow] = await db.select({ orderNumber: orders.orderNumber, agentId: orders.agentId, shopId: orders.shopId })
      .from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1);
    if (orderRow?.agentId) {
      const [shop] = await db.select({ name: shops.name }).from(shops).where(eq(shops.id, orderRow.shopId)).limit(1);
      const label = ORDER_STATUS_LABELS[newStatus];
      // После ответа: смена статуса не ждёт Expo.
      const agentId = orderRow.agentId;
      void import("./push-service").then(({ sendPushToUser }) => sendPushToUser(agentId, {
        title: `Заказ ${orderRow.orderNumber}`,
        body: `Статус изменён: ${label}${shop?.name ? ` (${shop.name})` : ""}`,
        data: { type: "order.status_changed", orderId },
      })).catch(() => {});
    }
  } catch (e) {
    logger.warn("Status change notification failed", { error: String(e) });
  }

  return { success: true };
}

export async function deleteOrder(db: Db, tenantId: number, orderId: number, actor?: AuditActor) {
  let deletedMeta: Record<string, unknown> = {};
  await db.transaction(async (tx) => {
    // Locked for the same reason as cancel() above: without it, two
    // concurrent deletes both pass the `deletedAt IS NULL` check and each
    // release the same reserved stock back to `available`.
    const [order] = await tx.select({
      id: orders.id,
      status: orders.status,
      deletedAt: orders.deletedAt,
      shopId: orders.shopId,
      total: orders.total,
      paymentMethod: orders.paymentMethod,
    }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt))).for("update").limit(1);
    if (!order) throw new Error("Заказ не найден или уже удалён");
    deletedMeta = { status: order.status, total: order.total, paymentMethod: order.paymentMethod, shopId: order.shopId };

    // Release reserved stock if order is new or processing
    if (holdsStock(order.status)) {
      const items = await tx.select({
        productId: orderItems.productId,
        quantity: orderItems.quantity,
        // Нужно heldQuantity: строка после частичной доставки держит только
        // доставленное, а не заказанное.
        deliveredQuantity: orderItems.deliveredQuantity,
      }).from(orderItems).where(eq(orderItems.orderId, orderId));
      if (items.length > 0) {
        const deleteWhId = await resolveOrderWarehouse(tx, tenantId);
        // См. heldQuantity: отдаём назад ровно то, что строка держит сейчас.
        const deleteReturned = await returnedQuantitiesByProduct(tx, tenantId, orderId);

        // Lock stock rows before releasing
        for (const item of items) {
          await tx.select({ id: warehouseStock.id }).from(warehouseStock)
            .where(and(eq(warehouseStock.productId, item.productId), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, deleteWhId)))
            .for("update");
        }
        // Как и при отмене: возвращается только то, что действительно лежит
        // в резерве, — LEAST(held, reserved). Иначе при просевшем резерве
        // available прибавлял бы единицы, которых на складе нет, и
        // current_stock = available + reserved расходилось бы молча.
        //
        // available первым — MySQL вычисляет SET слева направо.
        await releaseStock(tx, {
          tenantId, warehouseId: deleteWhId,
          items: items.map(i => ({ productId: i.productId, quantity: heldQuantity(i, deleteReturned) })),
        });
      }
    }

    // Soft delete — a deleted order is excluded from the balance, so this
    // withdraws whatever it was contributing.
    await tx.update(orders).set({ deletedAt: new Date() }).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
    await settleShopDebt(tx, tenantId, order.shopId);
  });

  cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));
  await traceOrderChange(db, tenantId, orderId, "order.delete", actor, deletedMeta);

  return { success: true };
}

export async function restore(db: Db, tenantId: number, orderId: number, actor?: AuditActor) {
  await db.transaction(async (tx) => {
    // Читаем заказ ВНУТРИ транзакции и под блокировкой — первым же запросом.
    //
    // Раньше проверка «заказ удалён» читалась снаружи, без лока, а UPDATE
    // снимал deletedAt безусловно. Два одновременных восстановления (двойной
    // клик, повтор по таймауту) оба видели удалённый заказ и оба выполняли
    // резервирование: на полке в 100 единиц заказ на 10 оставлял reserved=20,
    // available=80. Освобождает потом заказ только свои 10 — вторые 10
    // остаются в резерве навсегда, без заказа, который бы их объяснял.
    // cancel() и delete() рядом делают это правильно; restore был единственным
    // из трёх без защиты.
    const [order] = await tx.select({
      id: orders.id, deletedAt: orders.deletedAt, status: orders.status,
      shopId: orders.shopId, total: orders.total, paymentMethod: orders.paymentMethod,
    }).from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
      .for("update")
      .limit(1);
    if (!order) throw new Error("Заказ не найден");
    if (!order.deletedAt) throw new Error("Заказ не удалён");

    // Mirror of delete(): the order counts again, and so does what it owes.
    // Условие isNotNull — вторая половина защиты: даже если проверка выше
    // окажется по устаревшим данным, снять пометку сможет только тот вызов,
    // который застал её на месте.
    const restored = affectedRows(await tx.update(orders).set({ deletedAt: null })
      .where(and(
        eq(orders.id, orderId),
        eq(orders.tenantId, tenantId),
        isNotNull(orders.deletedAt),
      )));
    if (restored === 0) throw new Error("Заказ уже восстановлен");

    await settleShopDebt(tx, tenantId, order.shopId);

    // Re-reserve stock if order was new/processing when deleted
    if (holdsStock(order.status)) {
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      const restoreWhId = await resolveOrderWarehouse(tx, tenantId);
      const restoreReturned = await returnedQuantitiesByProduct(tx, tenantId, orderId);

      // Блокируем и СРАЗУ читаем available той же выборкой. Прежде остаток
      // читался вторым, обычным SELECT: под REPEATABLE READ он обслуживается
      // из снимка, зафиксированного первым чтением транзакции, то есть ДО
      // взятия блокировки, — проверка «хватает ли товара» могла одобрить
      // резерв против остатка, уже израсходованного соседней транзакцией.
      const stockRows = await tx.select({
        productId: warehouseStock.productId,
        available: warehouseStock.available,
      })
        .from(warehouseStock)
        .where(and(
          eq(warehouseStock.tenantId, tenantId),
          eq(warehouseStock.warehouseId, restoreWhId),
          inArray(warehouseStock.productId, items.map(i => i.productId)),
        ))
        .for("update");

      for (const item of items) {
        const qty = heldQuantity(item, restoreReturned);
        if (qty === 0) continue;
        const row = stockRows.find(r => Number(r.productId) === item.productId);
        const available = Number(row?.available ?? 0);
        if (available < qty) {
          throw new Error(`Не восстановить заказ: «${await productLabel(tx, tenantId, item.productId)}» — доступно ${available}, нужно ${qty}`);
        }
        // Проверка «хватает ли свободного» осталась выше: она отказывает с
        // именем товара и числами, а дверь такого сказать не может.
        await reserveStock(tx, {
          tenantId, warehouseId: restoreWhId,
          items: [{ productId: item.productId, quantity: qty }],
        });
      }
    }
  });

  cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));
  await traceOrderChange(db, tenantId, orderId, "order.restore", actor, {});

  return { success: true };
}

// ── Batch operations ──────────────────────────────────────────────────────

export async function bulkUpdateStatus(
  db: Db, tenantId: number, orderIds: number[],
  newStatus: "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned",
  actorId?: number, comment?: string,
) {
  if (orderIds.length === 0) return { updated: 0, failed: [] as Array<{ orderId: number; error: string }> };
  if (orderIds.length > 100) throw new Error("Максимум 100 заказов за раз");

  let updated = 0;
  const failed: Array<{ orderId: number; error: string }> = [];
  for (const orderId of orderIds) {
    try {
      await updateStatus(db, tenantId, orderId, newStatus);
      updated++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.warn("Bulk status update failed for order", { orderId, error: message });
      failed.push({ orderId, error: message });
    }
  }

  // Audit log
  try {
    const { recordAudit } = await import("./audit-log");
    await recordAudit(db, {
      tenantId, actorId, action: "order.bulk_status_change",
      targetType: "order", meta: { orderIds, newStatus, updated, failed, comment },
    });
  } catch { /* audit is non-blocking */ }

  return { updated, failed };
}

export async function bulkAssignAgent(db: Db, tenantId: number, orderIds: number[], agentId: number) {
  if (orderIds.length === 0) return { updated: 0 };

  // Verify agent exists and belongs to tenant
  const [agent] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.id, agentId), eq(users.tenantId, tenantId))).limit(1);
  if (!agent) throw new Error("Агент не найден");

  await db.update(orders)
    .set({ agentId })
    .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, orderIds)));

  return { updated: orderIds.length };
}

// ── Partial Payment ────────────────────────────────────────────────────────
