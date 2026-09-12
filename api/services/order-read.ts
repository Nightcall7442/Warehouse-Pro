import { eq, and, or, desc, sql, isNull, isNotNull, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { orders, orderItems, shops, users, products, payments, orderAdjustments, territories } from "@db/schema";
import { OPEN_ORDER_STATUSES, CLOSED_ORDER_STATUSES } from "../lib/order-status";
import type { Db, OrderViewer } from "./order-shared";
import { couriers, viewerScope } from "./order-shared";

/*
  opts обязателен, а не необязателен.

  Внутри он решает главное — сужать ли выборку до своих заказов, — и пока
  его можно было не передать, забыть его означало молча открыть чужое. Со
  звёздочкой это ловил бы только тест; без неё не собирается сборка.
*/
export async function list(db: Db, tenantId: number, filters: Record<string, unknown>, viewer: OrderViewer) {
  const f = filters as { status?: string; archived?: boolean; agentId?: number; agentIds?: number[]; page?: number; pageSize?: number; search?: string; showDeleted?: boolean; dateFrom?: string; dateTo?: string; paymentMethod?: string };
  const page = f.page ?? 1;
  const limit = f.pageSize ?? 25;
  const offset = (page - 1) * limit;

  const conditions = [eq(orders.tenantId, tenantId)];
  if (f.status) {
    conditions.push(eq(orders.status, f.status as "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned"));
  }
  if (f.archived !== undefined) {
    // Archive holds everything that is out of play, so nothing can fall out
    // of both tabs: orders that reached an end state, and deleted ones
    // whatever status they were in when deleted. A deleted order is not
    // active — it used to keep its "new" status and so either sat among live
    // work or vanished from the page entirely.
    //
    // This composes with the status filter rather than being overridden by
    // it: picking a status while on a tab narrows *within* that tab, which
    // is the only reading under which a deleted "new" order is reachable at
    // all now that it belongs to the archive.
    conditions.push(f.archived
      ? or(inArray(orders.status, CLOSED_ORDER_STATUSES), isNotNull(orders.deletedAt))!
      : and(inArray(orders.status, OPEN_ORDER_STATUSES), isNull(orders.deletedAt))!);
  }
  // Both forms are supported: the by-agent view drills into one agent at a
  // time, while the toolbar filter compares several at once. An empty array
  // means the same as omitting the filter, matching how every other optional
  // filter here treats an absent value.
  if (f.agentIds?.length) conditions.push(inArray(orders.agentId, f.agentIds));
  else if (f.agentId) conditions.push(eq(orders.agentId, f.agentId));
  if (f.paymentMethod) conditions.push(eq(orders.paymentMethod, f.paymentMethod as "cash" | "card" | "transfer" | "debt"));
  // P0-14 FIX: Implement search filter
  if (f.search) conditions.push(sql`(${orders.orderNumber} LIKE ${'%' + f.search + '%'} OR ${shops.name} LIKE ${'%' + f.search + '%'})`);
  // P0-14 FIX: Implement date filters
  if (f.dateFrom) conditions.push(sql`${orders.createdAt} >= ${f.dateFrom}`);
  if (f.dateTo) conditions.push(sql`${orders.createdAt} <= ${f.dateTo + ' 23:59:59'}`);
  // Hide deleted orders unless explicitly requested — except in the archive,
  // which is where they belong and already selects them above. Applying it
  // there would cancel that out and leave deleted orders in neither tab.
  if (!f.showDeleted && f.archived !== true) conditions.push(isNull(orders.deletedAt));
  // P0-14 FIX: Non-privileged users see only their own orders
  conditions.push(...viewerScope(viewer));

  // users is already joined for the agent; the courier is the same table
  // again and needs its own alias or the two collapse into one another.
  const courier = alias(users, "courier");

  const baseQuery = db.select({
    id: orders.id,
    orderNumber: orders.orderNumber,
    status: orders.status,
    total: orders.total,
    subtotal: orders.subtotal,
    discount: orders.discount,
    notes: orders.notes,
    createdAt: orders.createdAt,
    shopId: orders.shopId,
    agentId: orders.agentId,
    shopName: shops.name,
    agentName: users.name,
    paymentMethod: orders.paymentMethod,
    deletedAt: orders.deletedAt,
    territoryName: territories.name,
    // Fields the table can show as optional columns. All of them already sat
    // on the row — the list simply never selected them, so the Orders page
    // had no way to offer a column for something the record plainly knows.
    updatedAt: orders.updatedAt,
    priority: orders.priority,
    deliveryStatus: orders.deliveryStatus,
    deliveredAt: orders.deliveredAt,
    courierName: courier.name,
    // Correlated count rather than a join: joining order_items would multiply
    // the order's row once per line and inflate nothing here but confuse the
    // pagination count next to it.
    itemCount: sql<number>`(SELECT COUNT(*) FROM order_items WHERE order_items.order_id = ${orders.id})`,
  }).from(orders)
    .leftJoin(shops, and(eq(orders.shopId, shops.id), eq(shops.tenantId, tenantId)))
    .leftJoin(users, and(eq(orders.agentId, users.id), eq(users.tenantId, tenantId)))
    .leftJoin(courier, and(eq(orders.courierId, courier.id), eq(courier.tenantId, tenantId)))
    .leftJoin(territories, eq(shops.territoryId, territories.id))
    .where(and(...conditions));

  const [data, countResult] = await Promise.all([
    baseQuery.orderBy(desc(orders.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(orders)
      .leftJoin(shops, and(eq(orders.shopId, shops.id), eq(shops.tenantId, tenantId)))
      .where(and(...conditions)),
  ]);

  return { data, total: Number(countResult[0]?.count ?? 0), page, pageSize: limit };
}

/*
  opts обязателен, а не необязателен.

  Внутри он решает главное — сужать ли выборку до своих заказов, — и пока
  его можно было не передать, забыть его означало молча открыть чужое. Со
  звёздочкой это ловил бы только тест; без неё не собирается сборка.
*/

export async function getById(db: Db, tenantId: number, orderId: number, viewer: OrderViewer) {
  // Роль вызывающего принималась параметром и не использовалась (_opts).
  // Из-за этого ограничение списка обходилось одним запросом по id: агент или
  // мерчендайзер перебирал order.getById({id: 1..N}) и по каждому чужому
  // заказу организации получал сумму, скидку, состав с ценами, имя ведущего
  // агента и блок shop — телефон, ФИО владельца и текущий долг магазина.
  // У мерчендайзера своих заказов нет вовсе, поэтому для него это открывало
  // весь портфель компании.
  //
  // Список привилегированных ролей — тот же, что в list выше: карточка и
  // строка списка показывают один и тот же заказ, и разойдись эти два списка,
  // заказ было бы видно в одном месте и не видно в другом.
  const scope = viewerScope(viewer);

  const [order] = await db.select({
    id: orders.id, orderNumber: orders.orderNumber, status: orders.status,
    total: orders.total, subtotal: orders.subtotal, discount: orders.discount,
    notes: orders.notes, createdAt: orders.createdAt, updatedAt: orders.updatedAt,
    // Заполнена только у заказов, побывавших в архиве: тогда createdAt —
    // дата второго круга, и без первой даты карточка выглядит так, будто
    // январский заказ оформили сегодня, без единого объяснения.
    firstOrderedAt: orders.firstOrderedAt,
    shopId: orders.shopId, agentId: orders.agentId,
    courierId: orders.courierId, deliveryStatus: orders.deliveryStatus,
    deliveredAt: orders.deliveredAt, deletedAt: orders.deletedAt,
    // Обещанный срок. Пусто — значит срок магазину не называли; это
    // законное значение, а не «нет данных».
    promisedDeliveryAt: orders.promisedDeliveryAt,
    // Почему заказ в «ожидает» — директору видно, что он подтверждает.
    holdReason: orders.holdReason,
    paymentMethod: orders.paymentMethod, invoicePrintedAt: orders.invoicePrintedAt,
  }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt), ...scope)).limit(1);
  if (!order) return null;

  const [items, [shop], [agent]] = await Promise.all([
    db.select({
      id: orderItems.id, productId: orderItems.productId, quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice, subtotal: orderItems.subtotal,
      deliveredQuantity: orderItems.deliveredQuantity,
      returnReason: orderItems.returnReason,
      productName: products.name, productCode: products.code, unit: products.unit,
    }).from(orderItems)
      .innerJoin(products, and(eq(orderItems.productId, products.id), eq(products.tenantId, tenantId)))
      .where(eq(orderItems.orderId, orderId)),
    db.select({ id: shops.id, name: shops.name, address: shops.address, city: shops.city, phone: shops.phone, debt: shops.debt, ownerName: shops.ownerName, territoryName: territories.name })
      .from(shops)
      .leftJoin(territories, eq(shops.territoryId, territories.id))
      .where(and(eq(shops.id, order.shopId), eq(shops.tenantId, tenantId))).limit(1),
    order.agentId
      ? db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, order.agentId)).limit(1)
      : Promise.resolve([]),
  ]);

  return { ...order, items, shop: shop ?? null, shopName: shop?.name ?? null, agent: agent ?? null };
}

export async function myOrders(db: Db, tenantId: number, agentId: number) {
  const conditions = [eq(orders.tenantId, tenantId), eq(orders.agentId, agentId)];
  const [data, countResult] = await Promise.all([
    db.select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      total: orders.total,
      subtotal: orders.subtotal,
      discount: orders.discount,
      notes: orders.notes,
      createdAt: orders.createdAt,
      shopId: orders.shopId,
      agentId: orders.agentId,
      paymentMethod: orders.paymentMethod,
    }).from(orders).where(and(...conditions)).orderBy(desc(orders.createdAt)).limit(500),
    db.select({ count: sql<number>`count(*)` }).from(orders).where(and(...conditions)),
  ]);
  return { data, total: Number(countResult[0]?.count ?? 0) };
}

export async function batchGetOrdersForPrint(db: Db, tenantId: number, orderIds: number[]) {
  if (orderIds.length === 0) return [];
  if (orderIds.length > 50) throw new Error("Максимум 50 заказов за раз");

  const ordersData = await db.select({
    id: orders.id, orderNumber: orders.orderNumber, status: orders.status,
    total: orders.total, subtotal: orders.subtotal, discount: orders.discount,
    notes: orders.notes, createdAt: orders.createdAt,
    shopId: orders.shopId, agentId: orders.agentId,
    paymentMethod: orders.paymentMethod,
    invoicePrintedAt: orders.invoicePrintedAt,
    shopName: shops.name, shopAddress: shops.address, shopCity: shops.city,
    shopPhone: shops.phone, shopDebt: shops.debt,
    agentName: users.name,
    territoryName: territories.name,
    courierName: couriers.name,
  }).from(orders)
    .leftJoin(shops, and(eq(orders.shopId, shops.id), eq(shops.tenantId, tenantId)))
    .leftJoin(users, and(eq(orders.agentId, users.id), eq(users.tenantId, tenantId)))
    .leftJoin(territories, eq(shops.territoryId, territories.id))
    .leftJoin(couriers, and(eq(orders.courierId, couriers.id), eq(couriers.tenantId, tenantId)))
    .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, orderIds)));

  // Fetch items for all orders in one query
  const allItems = await db.select({
    orderId: orderItems.orderId,
    productId: orderItems.productId,
    quantity: orderItems.quantity,
    deliveredQuantity: orderItems.deliveredQuantity,
    unitPrice: orderItems.unitPrice,
    costPrice: orderItems.costPrice,
    subtotal: orderItems.subtotal,
    productName: products.name,
    productCode: products.code,
    unit: products.unit,
  }).from(orderItems)
    .innerJoin(products, and(eq(orderItems.productId, products.id), eq(products.tenantId, tenantId)))
    .where(inArray(orderItems.orderId, orderIds));

  // Fetch payment history for all shops
  const shopIds = [...new Set(ordersData.map(o => o.shopId))];
  const allPayments = await db.select({
    shopId: payments.shopId,
    amount: payments.amount,
    type: payments.type,
    createdAt: payments.createdAt,
  }).from(payments)
    .where(and(
      eq(payments.tenantId, tenantId),
      inArray(payments.shopId, shopIds),
      sql`${payments.createdAt} >= NOW() - INTERVAL 30 DAY`,
    ))
    .orderBy(desc(payments.createdAt));

  // Group items and payments by order/shop
  const itemsByOrder = new Map<number, typeof allItems>();
  for (const item of allItems) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push(item);
    itemsByOrder.set(item.orderId, list);
  }

  const paymentsByShop = new Map<number, typeof allPayments>();
  for (const p of allPayments) {
    const list = paymentsByShop.get(p.shopId) ?? [];
    list.push(p);
    paymentsByShop.set(p.shopId, list);
  }

  return ordersData.map(o => {
    const items = itemsByOrder.get(o.id) ?? [];
    return {
      ...o,
      items,
      shopDebtAmount: Number(o.shopDebt ?? 0),
      paymentHistory: paymentsByShop.get(o.shopId) ?? [],
      // Довезли не всё — накладная печатает заказанное и отпущенное двумя
      // графами. Признак вычисляется здесь: в документе поле isPartial было,
      // но его никто не заполнял, и обе графы печатали заказанное.
      isPartial: items.some(i =>
        i.deliveredQuantity != null && Number(i.deliveredQuantity) < Number(i.quantity)
      ),
    };
  });
}

export async function markInvoicesPrinted(db: Db, tenantId: number, orderIds: number[]) {
  if (orderIds.length === 0) return;
  await db.update(orders)
    .set({ invoicePrintedAt: new Date() })
    .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, orderIds)));
}

export async function getManyForCompletion(db: Db, tenantId: number, orderIds: number[], viewer: OrderViewer) {
  if (orderIds.length === 0) return [];

  const scope = viewerScope(viewer);
  const heads = await db.select({
    id: orders.id, orderNumber: orders.orderNumber, status: orders.status,
    total: orders.total, subtotal: orders.subtotal, discount: orders.discount,
    shopId: orders.shopId, shopName: shops.name, paymentMethod: orders.paymentMethod,
  }).from(orders)
    .leftJoin(shops, and(eq(orders.shopId, shops.id), eq(shops.tenantId, tenantId)))
    .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, orderIds), isNull(orders.deletedAt), ...scope));

  if (heads.length === 0) return [];

  const lines = await db.select({
    id: orderItems.id, orderId: orderItems.orderId, productId: orderItems.productId,
    quantity: orderItems.quantity, unitPrice: orderItems.unitPrice, subtotal: orderItems.subtotal,
    deliveredQuantity: orderItems.deliveredQuantity,
    productName: products.name, productCode: products.code, unit: products.unit,
  }).from(orderItems)
    .innerJoin(products, and(eq(orderItems.productId, products.id), eq(products.tenantId, tenantId)))
    .where(inArray(orderItems.orderId, heads.map(h => h.id)));

  // Сколько уже принято по каждому заказу: окно показывает остаток, а не
  // полную сумму, иначе повторное завершение предложит взять деньги дважды.
  const paidRows = await db.select({
    orderId: payments.orderId,
    paid: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS DECIMAL(15,2))), 0)`,
  }).from(payments)
    .where(and(eq(payments.tenantId, tenantId), eq(payments.type, "payment"), inArray(payments.orderId, heads.map(h => h.id))))
    .groupBy(payments.orderId);
  const paidByOrder = new Map(paidRows.map(r => [r.orderId, Number(r.paid)]));

  return heads.map(h => ({
    ...h,
    alreadyPaid: (paidByOrder.get(h.id) ?? 0).toFixed(2),
    items: lines.filter(l => l.orderId === h.id),
  }));
}

/**
 * Завершить несколько заказов, у каждого — своя оплата и свой возврат.
 *
 * Массовые действия до этого умели только крайности: «оплачено полностью»
 * или «не оплачено вовсе». Середины — магазин отдал часть денег, часть
 * товара вернул — не было, а именно так чаще всего и происходит. Из-за
 * этого пачку приходилось разбирать по одному заказу.
 *
 * Каждый заказ проводится в СВОЕЙ транзакции: сбой на одном не должен
 * отменять уже записанные деньги по остальным. Что не прошло — возвращается
 * списком с причиной, чтобы человек видел, к чему вернуться, а не гадал,
 * какая часть пачки применилась.
 */

export async function getAdjustments(db: Db, tenantId: number, orderId: number) {
  return db.select({
    id: orderAdjustments.id,
    type: orderAdjustments.type,
    oldValue: orderAdjustments.oldValue,
    newValue: orderAdjustments.newValue,
    reason: orderAdjustments.reason,
    photos: orderAdjustments.photos,
    createdAt: orderAdjustments.createdAt,
    adjustedByName: users.name,
  }).from(orderAdjustments)
    .leftJoin(users, and(eq(orderAdjustments.adjustedBy, users.id), eq(users.tenantId, tenantId)))
    .where(and(eq(orderAdjustments.orderId, orderId), eq(orderAdjustments.tenantId, tenantId)))
    .orderBy(desc(orderAdjustments.createdAt));
}

// ── Get Order Payments (extended) ──────────────────────────────────────────

export async function getOrderPayments(db: Db, tenantId: number, orderId: number) {
  return db.select({
    id: payments.id,
    amount: payments.amount,
    type: payments.type,
    paymentMethod: payments.paymentMethod,
    status: payments.status,
    totalOrderAmount: payments.totalOrderAmount,
    paidAmount: payments.paidAmount,
    debtAmount: payments.debtAmount,
    debtDueDate: payments.debtDueDate,
    paidAt: payments.paidAt,
    notes: payments.notes,
    createdAt: payments.createdAt,
    createdByName: users.name,
  }).from(payments)
    .leftJoin(users, and(eq(payments.createdBy, users.id), eq(users.tenantId, tenantId)))
    .where(and(eq(payments.orderId, orderId), eq(payments.tenantId, tenantId)))
    .orderBy(desc(payments.createdAt));
}
