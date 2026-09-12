import { eq, and, sql } from "drizzle-orm";
import { expiredByProduct, reserveStock } from "./stock-ledger";
import { orders, orderItems, warehouseStock, shops, users, products } from "@db/schema";
import { resolvePrices } from "./price-resolver";
import { recalcShopDebt } from "./shop-debt";
import { NotificationService } from "./NotificationService";
import { cache, CacheKeys } from "../lib/cache";
import { logger } from "../lib/logger";
import { isDuplicateEntry } from "../lib/db-errors";
import type { Db } from "./order-shared";
import { mergeDuplicateItems, resolveOrderWarehouse, nextOrderNumber, isIdempotencyDuplicate } from "./order-shared";

export async function create(db: Db, tenantId: number, agentId: number, input: { shopId: number; warehouseId?: number; items: Array<{ productId: number; quantity: string }>; notes?: string; discount?: string; idempotencyKey?: string; paymentMethod?: "cash" | "card" | "transfer" | "debt"; promisedDeliveryAt?: Date | null; /** Причина, по которой заказ ждёт офиса: создаётся в pending. */ holdReason?: string | null }) {
  // discount is a percentage (0-100) entered by the user — converted to a
  // money amount below and stored as such (orders.discount stays a money
  // column so revenue/P&L reports that SUM it keep meaning "money discounted").
  const discountPercent = Number(input.discount ?? "0");
  // Порядок важен: NaN не меньше нуля и не больше ста, поэтому обе проверки
  // ниже он проходил насквозь — и «abc» превращалось в сумму «NaN».
  if (!Number.isFinite(discountPercent)) throw new Error("Скидка должна быть числом");
  if (discountPercent < 0) throw new Error("Скидка не может быть отрицательной");
  if (discountPercent > 100) throw new Error("Скидка не может превышать 100%");

  // Повторы товара схлопываются до всего остального: ниже и проверка
  // достатка, и резерв склада, и вставка строк исходят из того, что товар в
  // заказе встречается один раз.
  const items = mergeDuplicateItems(input.items);

  // P0-1 FIX: Validate shop belongs to this tenant
  const [shop] = await db.select({ id: shops.id, name: shops.name, debt: shops.debt, creditLimit: shops.creditLimit }).from(shops)
    .where(and(eq(shops.id, input.shopId), eq(shops.tenantId, tenantId))).limit(1);
  if (!shop) throw new Error("Магазин не найден в вашей организации");

  // #FIX1-IDEMPOTENCY: Check for existing order with same key
  if (input.idempotencyKey) {
    const [existing] = await db.select({ id: orders.id, orderNumber: orders.orderNumber })
      .from(orders)
      .where(and(
        eq(orders.tenantId, tenantId),
        eq(orders.idempotencyKey, input.idempotencyKey),
      )).limit(1);
    if (existing) {
      return { id: existing.id, orderNumber: existing.orderNumber, idempotent: true };
    }
  }

  let orderId: number;
  let orderTotal: number;
  // Номер присваивается внутри транзакции (см. nextOrderNumber) и возвращается
  // наружу: он нужен и для уведомлений, и в ответе клиенту.
  let orderNumber: string;
  try {
    const txResult = await db.transaction(async (tx) => {
    // #FIX1: Look up prices from the database, never trust client
    const productIds = items.map(i => i.productId);
    const productRows = await tx.select({ id: products.id, name: products.name, unitPrice: products.unitPrice, costPrice: products.costPrice })
      .from(products)
      .where(and(
        sql`${products.id} IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})`,
        eq(products.tenantId, tenantId),
        eq(products.status, "active"),
      ));
    const priceMap = new Map<number, string>();
    const costMap = new Map<number, string>();
    // Имена — чтобы отказ по остатку называл товар, а не номер строки в базе.
    const nameMap = new Map<number, string>();
    for (const p of productRows) {
      priceMap.set(p.id, p.unitPrice);
      costMap.set(p.id, p.costPrice);
      nameMap.set(p.id, p.name);
    }

    // Validate all products exist and are active
    for (const item of items) {
      if (!priceMap.has(item.productId)) {
        throw new Error(`Товар #${item.productId} не найден или неактивен`);
      }
    }

    // Цена магазина поверх цены карточки: прайс-листы, привязанные к
    // магазину, до этого не участвовали в заказе ни на одном пути.
    const resolved = await resolvePrices(tx, tenantId, input.shopId, items, priceMap);
    for (const [productId, r] of resolved) priceMap.set(productId, r.price);

    // Calculate subtotal from server-side prices
    let subtotal = 0;
    for (const item of items) {
      const unitPrice = Number(priceMap.get(item.productId)!);
      subtotal += unitPrice * Number(item.quantity);
    }
    const discount = subtotal * (discountPercent / 100);
    const total = subtotal - discount;

    /*
      Кредитный контроль. Заказ «в долг» должен деньгами с момента
      оформления (services/shop-debt.ts), поэтому проверяется здесь, а не
      при отгрузке: агент узнаёт отказ у прилавка, а не через два дня от
      курьера. Долг магазина — выведенное число, пересчитанное последней
      операцией; читается под той же транзакцией. Лимит пустой — проверки
      нет, как и было у всех до появления поля.
    */
    if (input.paymentMethod === "debt" && shop.creditLimit != null) {
      const limit = Number(shop.creditLimit);
      const debt = Number(shop.debt);
      if (debt + total > limit) {
        throw new Error(
          `Кредитный лимит магазина «${shop.name}» ${limit.toFixed(0)} превышен: долг ${debt.toFixed(0)} + заказ ${total.toFixed(0)}. Примите оплату или попросите офис поднять лимит.`,
        );
      }
    }

    // Reserve from one explicit warehouse. Without this filter a product with
    // stock rows in several warehouses yielded an arbitrary row for the
    // availability check and a different one for the reservation.
    const reserveWarehouseId = await resolveOrderWarehouse(tx, tenantId, input.warehouseId);

    // SELECT stock rows with row-level locking to prevent race conditions
    const stockRows = await tx.select().from(warehouseStock)
      .where(and(
        sql`${warehouseStock.productId} IN (${sql.join(items.map(i => sql`${i.productId}`), sql`, `)})`,
        eq(warehouseStock.tenantId, tenantId),
        eq(warehouseStock.warehouseId, reserveWarehouseId),
      ))
      .for("update");

    const stockMap = new Map<number, typeof stockRows[number]>();
    for (const row of stockRows) stockMap.set(row.productId, row);
    // Просроченные партии лежат на полке и входят в available, но продать
    // их нельзя: годное — за их вычетом. Отгрузка их и не возьмёт (дверь).
    const expired = await expiredByProduct(tx, tenantId, reserveWarehouseId, items.map(i => i.productId));

    /*
      Отказ называет товар по имени.

      Здесь стояло «Недостаточно товара на складе (доступно: 0, запрошено:
      2)» — без единого признака, о каком товаре речь. Агент стоит у
      прилавка с корзиной из десяти позиций и не знает, какую убрать.
      Соседняя проверка называла товар номером строки в базе — «товар ID
      417», — что для человека ничем не лучше.

      Имена берём из тех же товаров, что уже загружены выше для цен:
      лишнего запроса не нужно.
    */
    for (const item of items) {
      const stock = stockMap.get(item.productId);
      const available = Number(stock?.available ?? 0);
      const name = nameMap.get(item.productId) ?? `товар #${item.productId}`;
      if (available < 0) {
        throw new Error(`Некорректный остаток на складе: «${name}» (доступно: ${available}). Обратитесь к администратору.`);
      }
      const rotten = expired.get(item.productId) ?? 0;
      const sellable = available - rotten;
      if (sellable < Number(item.quantity)) {
        throw new Error(rotten > 0
          ? `«${name}»: на складе ${available}, из них ${rotten} просрочено — годных ${sellable}, а в заказе ${item.quantity}`
          : `«${name}»: на складе ${available}, а в заказе ${item.quantity}`);
      }
    }

    // Номер заказа — порядковый в пределах организации: №149, №150, …
    //
    // Раньше он был куском случайного UUID (ORD-B650EBBC369B): не читается,
    // не называется вслух по телефону, ничего не говорит о порядке. Старые
    // номера остаются как есть — их печатали на накладных, и менять их задним
    // числом значит разойтись с бумагой на руках.
    //
    // Отсчёт продолжает существующие заказы, а не начинается с №1: у бизнеса
    // со ста сорока восемью заказами свежий заказ под номером один выглядел бы
    // ошибкой. Поэтому берётся большее из числа заказов организации и
    // максимума среди уже выданных №-номеров.
    let number = await nextOrderNumber(tx, tenantId);
    let id = 0;
    for (let attempt = 0; ; attempt++) {
      try {
        const [result] = await tx.insert(orders).values({
          tenantId, orderNumber: number, shopId: input.shopId, agentId,
          // Заказ с причиной ждёт офиса: резерв держит, в работу не идёт.
          status: input.holdReason ? "pending" : "new",
          holdReason: input.holdReason ?? null,
          subtotal: subtotal.toFixed(2), discount: discount.toFixed(2), total: total.toFixed(2),
          notes: input.notes,
          idempotencyKey: input.idempotencyKey ?? null,
          paymentMethod: input.paymentMethod ?? "cash",
          /*
            Обещанный срок — только если его назвали. Умолчания здесь нет и
            быть не может: подставленная дата — это чужое обещание от лица
            агента, и по нему потом считают срывы.
          */
          promisedDeliveryAt: input.promisedDeliveryAt ?? null,
        });
        id = Number(result.insertId);
        break;
      } catch (err: unknown) {
        // Два заказа, оформленные в одну секунду, посчитают один и тот же
        // следующий номер. Уникальный индекс uq_order_number_tenant отклонит
        // второго — берём следующий и пробуем снова. Дубликат по ключу
        // идемпотентности здесь не наш случай: его разбирает обработчик
        // снаружи транзакции, поэтому такую ошибку пробрасываем как есть.
        // Раньше случаи различались по наличию ключа, и офлайн-очередь агента
        // вставала на первой же коллизии номера — см. isIdempotencyDuplicate.
        const isNumberClash = isDuplicateEntry(err) && !isIdempotencyDuplicate(err);
        if (!isNumberClash || attempt >= 4) throw err;
        number = `№${Number(number.slice(1)) + 1}`;
      }
    }

    await tx.insert(orderItems).values(items.map(item => {
      const unitPrice = Number(priceMap.get(item.productId)!);
      return {
        orderId: id, productId: item.productId, quantity: item.quantity,
        unitPrice: unitPrice.toFixed(2),
        costPrice: costMap.get(item.productId) ?? "0.00",
        subtotal: (unitPrice * Number(item.quantity)).toFixed(2),
        priceListId: resolved.get(item.productId)?.priceListId ?? null,
      };
    }));

    if (items.length > 0) {
      // P0-2 FIX: Include warehouse_id in UPDATE to prevent cross-warehouse corruption
      // Условие по складу здесь появилось правкой P0-2: без него резерв
      // ложился на строку остатка другого склада. Дверь несёт его сама.
      await reserveStock(tx, {
        tenantId, warehouseId: reserveWarehouseId,
        items: items.map(i => ({ productId: i.productId, quantity: Number(i.quantity) })),
      });
    }

    // A credit order owes from the moment it exists; re-derive so the shop's
    // balance picks it up.
    await recalcShopDebt(tx, tenantId, input.shopId);

    return { id, total, number };
  });
    orderId = txResult.id;
    orderTotal = txResult.total;
    orderNumber = txResult.number;
  } catch (err: unknown) {
    // Гонка по ключу идемпотентности: заказ уже создан параллельным
    // запросом — находим его и возвращаем как свой.
    if (input.idempotencyKey && isDuplicateEntry(err)) {
      const [existing] = await db.select({ id: orders.id, orderNumber: orders.orderNumber })
        .from(orders)
        .where(and(eq(orders.tenantId, tenantId), eq(orders.idempotencyKey, input.idempotencyKey)))
        .limit(1);
      if (existing) {
        return { id: existing.id, orderNumber: existing.orderNumber, idempotent: true };
      }
    }
    throw err;
  }

  cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));

  // Notify operators/CEO about new order (in-app + push)
  try {
    const [shop] = await db.select({ name: shops.name }).from(shops).where(eq(shops.id, input.shopId)).limit(1);
    const operators = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.tenantId, tenantId), sql`${users.role} IN ('ceo', 'operator')`, eq(users.status, "active")));

    // Batch insert notifications (N+1 fix)
    if (operators.length > 0) {
      await NotificationService.createBulk(db, {
        tenantId,
        userIds: operators.map(op => op.id),
        type: "order",
        title: `Новый заказ ${orderNumber}`,
        message: `${shop?.name ?? "Магазин"} — ${orderTotal.toLocaleString("ru")} сум`,
        link: `/orders/${orderId}`,
      });
    }

    // Send push notifications
    const { sendPushToRole } = await import("./push-service");
    const pushMsg = {
      title: `Новый заказ ${orderNumber}`,
      body: `${shop?.name ?? "Магазин"} — ${orderTotal.toLocaleString("ru")} сум`,
      data: { type: "order", orderId },
    };
    await Promise.all([
      sendPushToRole(tenantId, "ceo", pushMsg),
      sendPushToRole(tenantId, "operator", pushMsg),
      sendPushToRole(tenantId, "supervisor", pushMsg),
    ]);

    /*
      И в Telegram. Push доходит только до тех, кто поставил приложение;
      Telegram есть у всех, и именно там люди сидят весь день.
    */
    const { notifyEvent } = await import("./telegram-notify");
    const { tgMessages } = await import("../lib/telegram");
    await notifyEvent({
      tenantId,
      event: "order.created",
      text: tgMessages.newOrder(orderNumber, shop?.name ?? "Магазин", orderTotal.toLocaleString("ru"), "сум"),
    });
  } catch (e) {
    logger.warn("Order notification failed", { error: String(e) });
  }

  // total возвращается наружу, чтобы клиент мог сверить его с суммой,
  // которую агент назвал владельцу магазина.
  //
  // Заказ, оформленный офлайн, уходит на сервер спустя часы, а цены сервер
  // берёт из базы на момент отправки — свои, не присланные. Если за это
  // время подняли прайс, накладная приходит на другую сумму, чем записано
  // на бумаге у владельца, и разбираться с этим агенту у двери магазина.
  // Зная итог, приложение сообщает о расхождении сразу после отправки.
  return { id: orderId, orderNumber, total: orderTotal, held: Boolean(input.holdReason) };
}
