import { eq, and, desc, sql, isNull, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { orders, orderItems, warehouseStock, shops, users, products, notifications, warehouses, payments, loadingLists, loadingListOrders, auditLog, debtReminders, orderAdjustments, stockMovements, territories } from "@db/schema";

/** Second reference to `users` for courier joins alongside the agent join. */
const couriers = alias(users, "couriers");
import { cache, CacheKeys } from "../lib/cache";
import { logger } from "../lib/logger";

type Db = ReturnType<typeof import("../queries/connection").getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Every stock movement in an order's lifecycle must target the same warehouse.
 * The order row does not record one, so the default warehouse is the single
 * source of truth: reservation on create, release on cancel/delete, deduction on
 * completion. An explicit non-default warehouseId is rejected rather than
 * silently reserved in one warehouse and released from another.
 */
async function resolveOrderWarehouse(tx: Tx, tenantId: number, requested?: number): Promise<number> {
  const [defaultWh] = await tx.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true))).limit(1);
  const whId = defaultWh?.id;
  if (!whId) throw new Error("Склад по умолчанию не найден");
  if (requested !== undefined && requested !== whId) {
    throw new Error("Заказ можно оформить только со склада по умолчанию");
  }
  return whId;
}

/** Orders paid on credit add to the shop's debt; reversing them must take it back. */
async function adjustShopDebt(tx: Tx, tenantId: number, shopId: number, delta: number): Promise<void> {
  if (delta === 0) return;
  await tx.execute(sql`
    UPDATE shops
    SET debt = GREATEST(0, CAST(debt AS DECIMAL(12,2)) + ${delta})
    WHERE id = ${shopId} AND tenant_id = ${tenantId}
  `);
}

/** Stock is held while order is active (not delivered, cancelled, or returned). */
/** Still moving through the pipeline — nothing final has happened to the goods yet. */
const OPEN_ORDER_STATUSES = ["new", "processing", "shipped", "pending"] as const;
/** Goods are no longer in play — delivered, cancelled, or returned. */
const CLOSED_ORDER_STATUSES = ["delivered", "cancelled", "returned"] as const;

function holdsStock(status: string): boolean {
  return (OPEN_ORDER_STATUSES as readonly string[]).includes(status);
}

/** Status that triggers stock deduction (goods left the warehouse). */
function deductsStock(status: string): boolean {
  return status === "delivered" || status === "completed";
}

/** Status that releases stock (goods returned to warehouse). */
function releasesStock(status: string): boolean {
  return status === "cancelled" || status === "returned";
}

/**
 * A credit order's receivable stands until the goods come back. Cancelled and
 * returned orders gave everything back, so they owe nothing; every other status
 * (including delivered) still owes, because delivery does not equal payment.
 */
function owesDebt(status: string): boolean {
  return status !== "cancelled" && status !== "returned";
}

/**
 * What one unit of an order line has done to warehouse stock by the time the
 * order sits in `status`, counted from "the order does not exist":
 *
 *   open (new/processing/shipped/pending) — held for the order: available−1, reserved+1
 *   delivered                             — gone from the building: available−1, current−1
 *   cancelled / returned                  — everything given back: no effect
 *
 * Moving between statuses applies the *difference* of the two effects, so every
 * direction works out on its own — including going backwards. Rolling a
 * delivered order back to "new" yields current+1, reserved+1: the goods return
 * to the shelf and are held for the order again.
 */
function stockEffect(status: string): { current: number; reserved: number; available: number } {
  if (deductsStock(status)) return { current: -1, reserved: 0, available: -1 };
  if (releasesStock(status)) return { current: 0, reserved: 0, available: 0 };
  return { current: 0, reserved: 1, available: -1 };
}

/**
 * How an order's items currently affect warehouse stock, which decides what an
 * edit has to move:
 *  - "reserve"  — units are held for the order (available↓, reserved↑)
 *  - "consumed" — units already left the building (current_stock↓)
 *  - "none"     — order gave everything back, its items own no stock
 */
function stockModeFor(status: string): "reserve" | "consumed" | "none" {
  if (deductsStock(status)) return "consumed";
  if (holdsStock(status)) return "reserve";
  return "none";
}

/**
 * Moves warehouse stock to match a change of `delta` units on an order line,
 * according to what that order's status already did to stock. Positive delta
 * means the order now wants more units than before.
 */
async function applyStockDelta(
  tx: Tx, tenantId: number, warehouseId: number, productId: number,
  delta: number, mode: "reserve" | "consumed" | "none",
): Promise<void> {
  if (delta === 0 || mode === "none") return;

  if (mode === "reserve") {
    if (delta > 0) {
      const [stock] = await tx.select({ available: warehouseStock.available })
        .from(warehouseStock)
        .where(and(eq(warehouseStock.productId, productId), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, warehouseId)))
        .limit(1);
      if (Number(stock?.available ?? 0) < delta) {
        throw new Error(`Недостаточно товара на складе (товар ID ${productId}: доступно ${Number(stock?.available ?? 0)}, нужно +${delta})`);
      }
    }
    await tx.execute(sql`
      UPDATE warehouse_stock
      SET reserved = GREATEST(0, reserved + ${delta}), available = available - ${delta}
      WHERE product_id = ${productId} AND tenant_id = ${tenantId} AND warehouse_id = ${warehouseId}
    `);
    return;
  }

  // "consumed" — the goods are already gone; more units means less on hand.
  if (delta > 0) {
    const [stock] = await tx.select({ currentStock: warehouseStock.currentStock })
      .from(warehouseStock)
      .where(and(eq(warehouseStock.productId, productId), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, warehouseId)))
      .limit(1);
    if (Number(stock?.currentStock ?? 0) < delta) {
      throw new Error(`Недостаточно товара на складе (товар ID ${productId}: остаток ${Number(stock?.currentStock ?? 0)}, нужно +${delta})`);
    }
  }
  await tx.execute(sql`
    UPDATE warehouse_stock SET current_stock = current_stock - ${delta}
    WHERE product_id = ${productId} AND tenant_id = ${tenantId} AND warehouse_id = ${warehouseId}
  `);
}

/** Delivered statuses — includes legacy "completed" for backwards compatibility. */
const DELIVERED_STATUSES = ["delivered", "completed"];

/**
 * Records a partial (or full) payment against an already-delivered order.
 * Runs on the caller's transaction so it can be composed with
 * applyPartialDelivery into one atomic operation (see recordDeliveryAndPayment).
 *
 * The order's own status always becomes "delivered" here — the goods left the
 * warehouse, full stop. Payment completeness (partial vs. paid) and any
 * remaining debt are tracked on the payments row and shops.debt, not on the
 * order status, so a partly-paid delivery still counts toward delivered/revenue
 * KPIs (which filter status IN ('delivered','completed')).
 */
async function applyPartialPayment(
  tx: Tx, tenantId: number, userId: number,
  input: { orderId: number; paidAmount: string; method: "cash" | "card" | "transfer"; debtDueDate?: string; notes?: string },
): Promise<void> {
  const paid = Number(input.paidAmount);
  if (paid <= 0) throw new Error("Сумма оплаты должна быть положительной");

  const [order] = await tx.select({
    id: orders.id, status: orders.status, total: orders.total,
    shopId: orders.shopId, orderNumber: orders.orderNumber, paymentMethod: orders.paymentMethod,
  }).from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt)))
    .limit(1);
  if (!order) throw new Error("Заказ не найден");

  const total = Number(order.total);

  // Sum of payments already recorded for this order, before this one — needed
  // to compute the true remaining balance across multiple partial payments,
  // and to know how much of it is already reflected in shops.debt (see below).
  const [{ priorPaid: priorPaidRaw }] = await tx.select({
    priorPaid: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS DECIMAL(15,2))), 0)`,
  }).from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.tenantId, tenantId), eq(payments.type, "payment")));
  const priorPaid = Number(priorPaidRaw);

  if (priorPaid + paid > total) throw new Error("Сумма оплаты не может превышать сумму заказа");

  const debt = total - priorPaid - paid;

  // Record payment
  await tx.insert(payments).values({
    tenantId,
    shopId: order.shopId,
    orderId: order.id,
    amount: paid.toFixed(2),
    type: "payment",
    paymentMethod: input.method,
    status: debt > 0 ? "partially_paid" : "paid",
    totalOrderAmount: total.toFixed(2),
    paidAmount: paid.toFixed(2),
    debtAmount: Math.max(0, debt).toFixed(2),
    debtDueDate: input.debtDueDate ?? null,
    paidAt: new Date(),
    notes: input.notes ?? null,
    createdBy: userId,
  });

  // Update shop debt. Orders created with paymentMethod "debt" have their full
  // total booked into shops.debt at creation, so each payment against them
  // simply reduces it. Orders created with any other method were never
  // booked at creation — but the moment such an order reaches "delivered"
  // (here or via a plain status change with no payment at all, see
  // updateStatus) its unpaid balance starts counting as debt, so
  // order.status === "delivered" going into this call means it's already
  // booked. Comparing what should be booked before vs. after this payment
  // (rather than blindly subtracting `paid`) keeps this correct across any
  // number of partial payments, however the order got to "delivered".
  const wasBookedBefore = order.paymentMethod === "debt" || order.status === "delivered";
  const bookedBefore = wasBookedBefore ? Math.max(0, total - priorPaid) : 0;
  const bookedAfter = Math.max(0, debt);
  const debtDelta = bookedAfter - bookedBefore;
  if (debtDelta !== 0) {
    await tx.execute(sql`
      UPDATE shops SET debt = GREATEST(0, CAST(debt AS DECIMAL(12,2)) + ${debtDelta})
      WHERE id = ${order.shopId} AND tenant_id = ${tenantId}
    `);
  }

  // Create debt reminder if there's remaining debt and a due date
  if (debt > 0 && input.debtDueDate) {
    await tx.insert(debtReminders).values({
      tenantId,
      shopId: order.shopId,
      orderId: order.id,
      amount: debt.toFixed(2),
      dueDate: input.debtDueDate,
      status: "pending",
    });
  }

  // Update order status — goods were delivered; remaining debt lives on
  // payments.status / shops.debt, not on this status field.
  await tx.update(orders).set({
    status: "delivered",
  }).where(and(eq(orders.id, order.id), eq(orders.tenantId, tenantId)));

  // Log adjustment
  await tx.insert(orderAdjustments).values({
    tenantId,
    orderId: order.id,
    adjustedBy: userId,
    type: "partial_payment",
    oldValue: { status: order.status, total: order.total },
    newValue: { status: "delivered", paid: paid.toFixed(2), debt: Math.max(0, debt).toFixed(2) },
    reason: input.notes ?? null,
  });
}

/**
 * Adjusts an order's items/total down to what was actually delivered and
 * returns the undelivered quantity to warehouse stock. Runs on the caller's
 * transaction so it can be composed with applyPartialPayment (see
 * recordDeliveryAndPayment).
 */
async function applyPartialDelivery(
  tx: Tx, tenantId: number, userId: number,
  input: { orderId: number; items: Array<{ itemId: number; deliveredQuantity: number; returnReason?: string }>; photos?: string[] },
): Promise<void> {
  if (input.items.length === 0) throw new Error("Выберите хотя бы один товар");

  const [order] = await tx.select({
    id: orders.id, status: orders.status, total: orders.total,
    subtotal: orders.subtotal, discount: orders.discount,
    shopId: orders.shopId, orderNumber: orders.orderNumber,
  }).from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt)))
    .limit(1);
  if (!order) throw new Error("Заказ не найден");

  let newSubtotal = 0;
  const oldItems: Array<{ id: number; quantity: string; subtotal: string }> = [];
  const newItems: Array<{ id: number; quantity: string; subtotal: string }> = [];

  const [defaultWh] = await tx.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true))).limit(1);

  for (const item of input.items) {
    const [orderItem] = await tx.select({
      id: orderItems.id, quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice, subtotal: orderItems.subtotal,
      productId: orderItems.productId, deliveredQuantity: orderItems.deliveredQuantity,
    }).from(orderItems)
      .where(and(eq(orderItems.id, item.itemId), eq(orderItems.orderId, order.id)))
      .limit(1);
    if (!orderItem) throw new Error(`Позиция заказа #${item.itemId} не найдена`);
    // Idempotency guard: this item has already gone through a partial-delivery
    // pass (deliveredQuantity was set). Re-running would return the same stock
    // to the warehouse and shave the same amount off shop debt a second time.
    if (orderItem.deliveredQuantity !== null) {
      throw new Error(`Позиция заказа #${item.itemId} уже обработана как частичная доставка`);
    }

    const orderedQty = Number(orderItem.quantity);
    const deliveredQty = item.deliveredQuantity;
    if (deliveredQty > orderedQty) throw new Error(`Нельзя передать больше заказанного (${orderedQty})`);

    const returnedQty = orderedQty - deliveredQty;
    const unitPrice = Number(orderItem.unitPrice);
    const newLineSubtotal = unitPrice * deliveredQty;
    newSubtotal += newLineSubtotal;

    oldItems.push({ id: orderItem.id, quantity: orderItem.quantity, subtotal: orderItem.subtotal });

    // Update order item
    await tx.update(orderItems).set({
      deliveredQuantity: deliveredQty.toFixed(2),
      returnReason: item.returnReason ?? null,
      subtotal: newLineSubtotal.toFixed(2),
    }).where(eq(orderItems.id, orderItem.id));

    newItems.push({ id: orderItem.id, quantity: deliveredQty.toFixed(2), subtotal: newLineSubtotal.toFixed(2) });

    // Release the full reservation held since order creation: the delivered
    // portion is now consumed (current_stock drops, matching the "open →
    // delivered" stockEffect delta — this used to only run when something
    // was returned, so a fully-delivered order never released its reservation
    // or decremented current_stock at all); the undelivered portion goes back
    // to available (matching "open → returned"). Either way `reserved` drops
    // by the full original order quantity.
    if (defaultWh) {
      await tx.execute(sql`
        UPDATE warehouse_stock
        SET current_stock = current_stock - ${deliveredQty},
            reserved = GREATEST(0, reserved - ${orderedQty}),
            available = available + ${returnedQty}
        WHERE product_id = ${orderItem.productId} AND tenant_id = ${tenantId} AND warehouse_id = ${defaultWh.id}
      `);

      if (returnedQty > 0) {
        await tx.insert(stockMovements).values({
          tenantId,
          productId: orderItem.productId,
          type: "adjustment",
          quantity: String(returnedQty),
          referenceType: "order_return",
          referenceId: order.id,
          notes: `Возврат при доставке: ${item.returnReason ?? "не указано"}`,
        });
      }
    }
  }

  // Recalculate order totals
  const discount = Number(order.discount);
  const newTotal = newSubtotal - discount;

  // The order is delivered — what came back was already subtracted from its
  // lines and total, and the returned units went back to stock above. The
  // partial nature lives in order_items.deliveredQuantity and the adjustment
  // log, not in a separate status.
  await tx.update(orders).set({
    subtotal: newSubtotal.toFixed(2),
    total: newTotal.toFixed(2),
    status: "delivered",
  }).where(and(eq(orders.id, order.id), eq(orders.tenantId, tenantId)));

  // Adjust shop debt if order total decreased
  const totalDiff = Number(order.total) - newTotal;
  if (totalDiff > 0) {
    await tx.execute(sql`
      UPDATE shops SET debt = GREATEST(0, CAST(debt AS DECIMAL(12,2)) - ${totalDiff})
      WHERE id = ${order.shopId} AND tenant_id = ${tenantId}
    `);
  }

  // Log adjustment
  await tx.insert(orderAdjustments).values({
    tenantId,
    orderId: order.id,
    adjustedBy: userId,
    type: "partial_delivery",
    oldValue: { total: order.total, items: oldItems },
    newValue: { total: newTotal.toFixed(2), items: newItems },
    reason: input.items.map(i => i.returnReason).filter(Boolean).join(", "),
    photos: input.photos ?? null,
  });
}

export const OrderService = {
  async list(db: Db, tenantId: number, filters: Record<string, unknown>, opts?: { userId: number; userRole: string }) {
    const f = filters as { status?: string; archived?: boolean; agentId?: number; page?: number; pageSize?: number; search?: string; showDeleted?: boolean; dateFrom?: string; dateTo?: string; paymentMethod?: string };
    const page = f.page ?? 1;
    const limit = f.pageSize ?? 25;
    const offset = (page - 1) * limit;

    const conditions = [eq(orders.tenantId, tenantId)];
    if (f.status) {
      conditions.push(eq(orders.status, f.status as "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned"));
    } else if (f.archived !== undefined) {
      // Archive = goods are no longer in play (delivered/cancelled/returned).
      // Active = still moving through the pipeline. A specific status filter
      // (above) always wins — the tab just picks a default grouping.
      conditions.push(f.archived
        ? inArray(orders.status, CLOSED_ORDER_STATUSES)
        : inArray(orders.status, OPEN_ORDER_STATUSES));
    }
    if (f.agentId) conditions.push(eq(orders.agentId, f.agentId));
    if (f.paymentMethod) conditions.push(eq(orders.paymentMethod, f.paymentMethod as "cash" | "card" | "transfer" | "debt"));
    // P0-14 FIX: Implement search filter
    if (f.search) conditions.push(sql`(${orders.orderNumber} LIKE ${'%' + f.search + '%'} OR ${shops.name} LIKE ${'%' + f.search + '%'})`);
    // P0-14 FIX: Implement date filters
    if (f.dateFrom) conditions.push(sql`${orders.createdAt} >= ${f.dateFrom}`);
    if (f.dateTo) conditions.push(sql`${orders.createdAt} <= ${f.dateTo + ' 23:59:59'}`);
    // Hide deleted orders unless explicitly requested
    if (!f.showDeleted) conditions.push(isNull(orders.deletedAt));
    // P0-14 FIX: Non-privileged users see only their own orders
    if (opts && !["ceo", "operator", "supervisor", "superadmin"].includes(opts.userRole)) {
      conditions.push(eq(orders.agentId, opts.userId));
    }

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
    }).from(orders)
      .leftJoin(shops, eq(orders.shopId, shops.id))
      .leftJoin(users, eq(orders.agentId, users.id))
      .leftJoin(territories, eq(shops.territoryId, territories.id))
      .where(and(...conditions));

    const [data, countResult] = await Promise.all([
      baseQuery.orderBy(desc(orders.createdAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(orders)
        .leftJoin(shops, eq(orders.shopId, shops.id))
        .where(and(...conditions)),
    ]);

    return { data, total: Number(countResult[0]?.count ?? 0), page, pageSize: limit };
  },

  async getById(db: Db, tenantId: number, orderId: number, _opts?: { userId: number; userRole: string }) {
    const [order] = await db.select({
      id: orders.id, orderNumber: orders.orderNumber, status: orders.status,
      total: orders.total, subtotal: orders.subtotal, discount: orders.discount,
      notes: orders.notes, createdAt: orders.createdAt, updatedAt: orders.updatedAt,
      shopId: orders.shopId, agentId: orders.agentId,
      courierId: orders.courierId, deliveryStatus: orders.deliveryStatus,
      deliveredAt: orders.deliveredAt, deletedAt: orders.deletedAt,
      paymentMethod: orders.paymentMethod, invoicePrintedAt: orders.invoicePrintedAt,
    }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt))).limit(1);
    if (!order) return null;

    const [items, [shop], [agent]] = await Promise.all([
      db.select({
        id: orderItems.id, productId: orderItems.productId, quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice, subtotal: orderItems.subtotal,
        deliveredQuantity: orderItems.deliveredQuantity,
        returnReason: orderItems.returnReason,
        productName: products.name, productCode: products.code, unit: products.unit,
      }).from(orderItems)
        .innerJoin(products, eq(orderItems.productId, products.id))
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
  },

  async myOrders(db: Db, tenantId: number, agentId: number) {
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
  },

  async create(db: Db, tenantId: number, agentId: number, input: { shopId: number; warehouseId?: number; items: Array<{ productId: number; quantity: string }>; notes?: string; discount?: string; idempotencyKey?: string; paymentMethod?: "cash" | "card" | "transfer" | "debt" }) {
    // discount is a percentage (0-100) entered by the user — converted to a
    // money amount below and stored as such (orders.discount stays a money
    // column so revenue/P&L reports that SUM it keep meaning "money discounted").
    const discountPercent = Number(input.discount ?? "0");
    if (discountPercent < 0) throw new Error("Скидка не может быть отрицательной");
    if (discountPercent > 100) throw new Error("Скидка не может превышать 100%");

    // P0-1 FIX: Validate shop belongs to this tenant
    const [shop] = await db.select({ id: shops.id }).from(shops)
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

    const raw = crypto.randomUUID().replace(/-/g, "");
    const orderNumber = `ORD-${raw.slice(0, 12).toUpperCase()}`;

    let orderId: number;
    let orderTotal: number;
    try {
      const txResult = await db.transaction(async (tx) => {
      // #FIX1: Look up prices from the database, never trust client
      const productIds = input.items.map(i => i.productId);
      const productRows = await tx.select({ id: products.id, unitPrice: products.unitPrice, costPrice: products.costPrice })
        .from(products)
        .where(and(
          sql`${products.id} IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})`,
          eq(products.tenantId, tenantId),
          eq(products.status, "active"),
        ));
      const priceMap = new Map<number, string>();
      const costMap = new Map<number, string>();
      for (const p of productRows) {
        priceMap.set(p.id, p.unitPrice);
        costMap.set(p.id, p.costPrice);
      }

      // Validate all products exist and are active
      for (const item of input.items) {
        if (!priceMap.has(item.productId)) {
          throw new Error(`Товар #${item.productId} не найден или неактивен`);
        }
      }

      // Calculate subtotal from server-side prices
      let subtotal = 0;
      for (const item of input.items) {
        const unitPrice = Number(priceMap.get(item.productId)!);
        subtotal += unitPrice * Number(item.quantity);
      }
      const discount = subtotal * (discountPercent / 100);
      const total = subtotal - discount;

      // Reserve from one explicit warehouse. Without this filter a product with
      // stock rows in several warehouses yielded an arbitrary row for the
      // availability check and a different one for the reservation.
      const reserveWarehouseId = await resolveOrderWarehouse(tx, tenantId, input.warehouseId);

      // SELECT stock rows with row-level locking to prevent race conditions
      const stockRows = await tx.select().from(warehouseStock)
        .where(and(
          sql`${warehouseStock.productId} IN (${sql.join(input.items.map(i => sql`${i.productId}`), sql`, `)})`,
          eq(warehouseStock.tenantId, tenantId),
          eq(warehouseStock.warehouseId, reserveWarehouseId),
        ))
        .for("update");

      const stockMap = new Map<number, typeof stockRows[number]>();
      for (const row of stockRows) stockMap.set(row.productId, row);

      for (const item of input.items) {
        const stock = stockMap.get(item.productId);
        const available = Number(stock?.available ?? 0);
        if (available < 0) {
          throw new Error(`Некорректный остаток товара на складе (доступно: ${available}). Обратитесь к администратору.`);
        }
        if (available < Number(item.quantity)) {
          throw new Error(`Недостаточно товара на складе (доступно: ${available}, запрошено: ${item.quantity})`);
        }
      }

      const [result] = await tx.insert(orders).values({
        tenantId, orderNumber, shopId: input.shopId, agentId, status: "new",
        subtotal: subtotal.toFixed(2), discount: discount.toFixed(2), total: total.toFixed(2),
        notes: input.notes,
        idempotencyKey: input.idempotencyKey ?? null,
        paymentMethod: input.paymentMethod ?? "cash",
      });
      const id = Number(result.insertId);

      await tx.insert(orderItems).values(input.items.map(item => {
        const unitPrice = Number(priceMap.get(item.productId)!);
        return {
          orderId: id, productId: item.productId, quantity: item.quantity,
          unitPrice: unitPrice.toFixed(2),
          costPrice: costMap.get(item.productId) ?? "0.00",
          subtotal: (unitPrice * Number(item.quantity)).toFixed(2),
        };
      }));

      if (input.items.length > 0) {
        // P0-2 FIX: Include warehouse_id in UPDATE to prevent cross-warehouse corruption
        await tx.execute(sql`
          UPDATE warehouse_stock
          SET
            reserved = reserved + CASE ${sql.join(input.items.map(i =>
              sql`WHEN product_id = ${i.productId} THEN ${Number(i.quantity)}`
            ), sql`\n`)} ELSE 0 END,
            available = available - CASE ${sql.join(input.items.map(i =>
              sql`WHEN product_id = ${i.productId} THEN ${Number(i.quantity)}`
            ), sql`\n`)} ELSE 0 END
          WHERE product_id IN (${sql.join(input.items.map(i => sql`${i.productId}`), sql`, `)})
            AND tenant_id = ${tenantId}
            AND warehouse_id = ${reserveWarehouseId}
        `);
      }

      // Update shop debt if payment method is "debt"
      if (input.paymentMethod === "debt" && total > 0) {
        await tx.execute(sql`
          UPDATE shops SET debt = debt + ${total} WHERE id = ${input.shopId} AND tenant_id = ${tenantId}
        `);
      }

      return { id, total };
    });
      orderId = txResult.id;
      orderTotal = txResult.total;
    } catch (err: unknown) {
      // Handle idempotency key race condition (MySQL error 23000 = duplicate entry)
      const code = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
      if (input.idempotencyKey && code === "ER_DUP_ENTRY") {
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
        await db.insert(notifications).values(operators.map(op => ({
          tenantId,
          userId: op.id,
          type: "order" as const,
          title: `Новый заказ ${orderNumber}`,
          message: `${shop?.name ?? "Магазин"} — ${orderTotal.toLocaleString("ru")} сум`,
          link: `/orders/${orderId}`,
        })));
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
    } catch (e) {
      logger.warn("Order notification failed", { error: String(e) });
    }

    return { id: orderId, orderNumber };
  },

  async cancel(db: Db, tenantId: number, orderId: number, opts: { userId: number; userRole: string }) {
    await db.transaction(async (tx) => {
      const isPrivileged = ["ceo", "operator", "superadmin"].includes(opts.userRole);
      const conditions = [eq(orders.id, orderId), eq(orders.tenantId, tenantId)];
      // Non-privileged users can only cancel their own orders
      if (!isPrivileged) {
        conditions.push(eq(orders.agentId, opts.userId));
      }
      // A soft-deleted order has already had its stock released — cancelling it
      // again would credit the warehouse twice.
      conditions.push(isNull(orders.deletedAt));
      const [order] = await tx.select({
        id: orders.id, status: orders.status, shopId: orders.shopId,
        total: orders.total, paymentMethod: orders.paymentMethod,
      }).from(orders).where(and(...conditions)).limit(1);
      if (!order) throw new Error("Заказ не найден");
      if (order.status !== "new") throw new Error("Можно отменить только новые заказы");

      // Credit orders added to the shop's debt at creation — take it back.
      if (order.paymentMethod === "debt") {
        await adjustShopDebt(tx, tenantId, order.shopId, -Number(order.total));
      }

      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      if (items.length > 0) {
        const cancelWhId = await resolveOrderWarehouse(tx, tenantId);

        // Lock stock rows to prevent race conditions
        for (const item of items) {
          await tx.select({ id: warehouseStock.id }).from(warehouseStock)
            .where(and(eq(warehouseStock.productId, item.productId), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, cancelWhId)))
            .for("update");
        }
        await tx.execute(sql`
          UPDATE warehouse_stock
          SET
            reserved = CASE ${sql.join(items.map(i =>
              sql`WHEN product_id = ${i.productId} THEN reserved - ${Number(i.quantity)}`
            ), sql`\n`)} ELSE reserved END,
            available = CASE ${sql.join(items.map(i =>
              sql`WHEN product_id = ${i.productId} THEN available + ${Number(i.quantity)}`
            ), sql`\n`)} ELSE available END
          WHERE product_id IN (${sql.join(items.map(i => sql`${i.productId}`), sql`, `)})
            AND tenant_id = ${tenantId}
            AND warehouse_id = ${cancelWhId}
        `);
      }
      await tx.update(orders).set({ status: "cancelled" }).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), eq(orders.status, "new")));
    });

    cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));

    return { success: true };
  },

  async updateStatus(db: Db, tenantId: number, orderId: number, newStatus: "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned") {
    await db.transaction(async (tx) => {
      const [order] = await tx.select({
        id: orders.id, status: orders.status, shopId: orders.shopId,
        agentId: orders.agentId, total: orders.total, subtotal: orders.subtotal,
        deliveryStatus: orders.deliveryStatus, paymentMethod: orders.paymentMethod,
      }).from(orders)
        // Soft-deleted orders already gave their stock back; moving them through
        // the lifecycle again would double-count it.
        .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt)))
        .limit(1);
      if (!order) throw new Error("Заказ не найден");

      // Nothing to do when the status is unchanged — and re-applying the stock
      // move would double-count it.
      if (order.status === newStatus) return { success: true };

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

      // A credit order owes while it is neither cancelled nor returned; moving
      // across that line books or releases the receivable.
      if (order.paymentMethod === "debt") {
        const owedBefore = owesDebt(order.status) ? Number(order.total) : 0;
        const owedAfter = owesDebt(newStatus) ? Number(order.total) : 0;
        if (owedAfter !== owedBefore) {
          await adjustShopDebt(tx, tenantId, order.shopId, owedAfter - owedBefore);
        }
      } else {
        // Cash/card/transfer orders book nothing up front — but the moment
        // the goods actually leave (status becomes "delivered"), whatever
        // wasn't paid is real debt the shop owes, whether or not any payment
        // was ever recorded (e.g. a plain "Выполнить" with no payment logged
        // at all). Moving away from "delivered" reverses it, same as an
        // operator undoing a mistaken completion for a debt order above.
        const wasDelivered = order.status === "delivered";
        const isDelivered = newStatus === "delivered";
        if (wasDelivered !== isDelivered) {
          const [{ paidSoFar }] = await tx.select({
            paidSoFar: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS DECIMAL(15,2))), 0)`,
          }).from(payments)
            .where(and(eq(payments.orderId, orderId), eq(payments.tenantId, tenantId), eq(payments.type, "payment")));
          const outstanding = Math.max(0, Number(order.total) - Number(paidSoFar));
          if (outstanding > 0) {
            await adjustShopDebt(tx, tenantId, order.shopId, isDelivered ? outstanding : -outstanding);
          }
        }
      }

      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      // The courier flow already moved the stock for this delivery; replaying
      // the same move here would deduct it a second time.
      const courierAlreadySettled = order.deliveryStatus === "delivered" && deductsStock(newStatus);

      if (items.length > 0 && !courierAlreadySettled && (d.current || d.reserved || d.available)) {
        const whId = await resolveOrderWarehouse(tx, tenantId);

        // Lock every affected row in one query before reading or writing.
        const stockRows = await tx.select({
          productId: warehouseStock.productId,
          currentStock: warehouseStock.currentStock,
          available: warehouseStock.available,
        })
          .from(warehouseStock)
          .where(and(
            eq(warehouseStock.tenantId, tenantId),
            eq(warehouseStock.warehouseId, whId),
            sql`${warehouseStock.productId} IN (${sql.join(items.map(i => sql`${i.productId}`), sql`, `)})`
          ))
          .for("update");

        // Refuse the move if it would drive any counter below zero, rather than
        // writing it and unwinding afterwards.
        const short = items.filter(i => {
          const row = stockRows.find(r => Number(r.productId) === i.productId);
          if (!row) return d.current < 0 || d.available < 0;
          const qty = Number(i.quantity);
          return (d.current < 0 && Number(row.currentStock) + d.current * qty < 0)
            || (d.available < 0 && Number(row.available) + d.available * qty < 0);
        });
        if (short.length > 0) {
          throw new Error(`Недостаточно товара на складе: ${short.map(i => `${i.productId}`).join(", ")}`);
        }

        // Each delta is −1, 0 or +1 per unit, so the sign travels inside the
        // number and every column is a plain "col = col + delta".
        await tx.execute(sql`
          UPDATE warehouse_stock
          SET current_stock = CASE ${sql.join(items.map(i =>
                sql`WHEN product_id = ${i.productId} THEN current_stock + ${d.current * Number(i.quantity)}`
              ), sql`\n`)} ELSE current_stock END,
              reserved = CASE ${sql.join(items.map(i =>
                sql`WHEN product_id = ${i.productId} THEN reserved + ${d.reserved * Number(i.quantity)}`
              ), sql`\n`)} ELSE reserved END,
              available = CASE ${sql.join(items.map(i =>
                sql`WHEN product_id = ${i.productId} THEN available + ${d.available * Number(i.quantity)}`
              ), sql`\n`)} ELSE available END
          WHERE product_id IN (${sql.join(items.map(i => sql`${i.productId}`), sql`, `)})
            AND tenant_id = ${tenantId}
            AND warehouse_id = ${whId}
        `);
      }
      await tx.update(orders).set({ status: newStatus }).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
    });

    cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));

    // Notify agent about status change (non-blocking)
    try {
      const [orderRow] = await db.select({ orderNumber: orders.orderNumber, agentId: orders.agentId, shopId: orders.shopId })
        .from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1);
      if (orderRow?.agentId) {
        const [shop] = await db.select({ name: shops.name }).from(shops).where(eq(shops.id, orderRow.shopId)).limit(1);
        const statusLabels: Record<string, string> = { completed: "выполнен", cancelled: "отменён", processing: "в обработке" };
        const label = statusLabels[newStatus] ?? newStatus;
        const { sendPushToUser } = await import("./push-service");
        await sendPushToUser(orderRow.agentId, {
          title: `Заказ ${orderRow.orderNumber}`,
          body: `Статус изменён: ${label}${shop?.name ? ` (${shop.name})` : ""}`,
          data: { type: "order.status_changed", orderId },
        }).catch(() => {});
      }
    } catch (e) {
      logger.warn("Status change notification failed", { error: String(e) });
    }

    return { success: true };
  },

  async delete(db: Db, tenantId: number, orderId: number) {
    await db.transaction(async (tx) => {
      const [order] = await tx.select({
        id: orders.id,
        status: orders.status,
        deletedAt: orders.deletedAt,
        shopId: orders.shopId,
        total: orders.total,
        paymentMethod: orders.paymentMethod,
      }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt))).limit(1);
      if (!order) throw new Error("Заказ не найден или уже удалён");

      // Deleting a still-open credit order withdraws the receivable it created.
      // Completed orders keep theirs — the goods were handed over.
      if (order.paymentMethod === "debt" && holdsStock(order.status)) {
        await adjustShopDebt(tx, tenantId, order.shopId, -Number(order.total));
      }

      // Release reserved stock if order is new or processing
      if (holdsStock(order.status)) {
        const items = await tx.select({
          productId: orderItems.productId,
          quantity: orderItems.quantity,
        }).from(orderItems).where(eq(orderItems.orderId, orderId));
        if (items.length > 0) {
          const deleteWhId = await resolveOrderWarehouse(tx, tenantId);

          // Lock stock rows before releasing
          for (const item of items) {
            await tx.select({ id: warehouseStock.id }).from(warehouseStock)
              .where(and(eq(warehouseStock.productId, item.productId), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, deleteWhId)))
              .for("update");
          }
          await tx.execute(sql`
            UPDATE warehouse_stock
            SET
              reserved = reserved - CASE ${sql.join(items.map(i =>
                sql`WHEN product_id = ${i.productId} THEN ${Number(i.quantity)}`
              ), sql`\n`)} ELSE 0 END,
              available = available + CASE ${sql.join(items.map(i =>
                sql`WHEN product_id = ${i.productId} THEN ${Number(i.quantity)}`
              ), sql`\n`)} ELSE 0 END
            WHERE product_id IN (${sql.join(items.map(i => sql`${i.productId}`), sql`, `)})
              AND tenant_id = ${tenantId}
              AND warehouse_id = ${deleteWhId}
          `);
        }
      }

      // Soft delete
      await tx.update(orders).set({ deletedAt: new Date() }).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
    });

    cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));

    return { success: true };
  },

  async update(
    db: Db, tenantId: number, orderId: number,
    data: { notes?: string; discount?: string; paymentMethod?: "cash" | "card" | "transfer" | "debt" },
  ) {
    // discount is a percentage (0-100), same contract as OrderService.create.
    if (data.discount !== undefined) {
      const pct = Number(data.discount);
      if (pct < 0) throw new Error("Скидка не может быть отрицательной");
      if (pct > 100) throw new Error("Скидка не может превышать 100%");
    }

    await db.transaction(async (tx) => {
      const [order] = await tx.select({
        id: orders.id,
        status: orders.status,
        subtotal: orders.subtotal,
        total: orders.total,
        shopId: orders.shopId,
        paymentMethod: orders.paymentMethod,
        deletedAt: orders.deletedAt,
      }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt))).limit(1);
      if (!order) throw new Error("Заказ не найден");

      const updates: Record<string, unknown> = {};
      if (data.notes !== undefined) updates.notes = data.notes;

      let newTotal = Number(order.total);
      if (data.discount !== undefined) {
        const subtotal = Number(order.subtotal);
        const discount = subtotal * (Number(data.discount) / 100);
        newTotal = subtotal - discount;
        updates.discount = discount.toFixed(2);
        updates.total = newTotal.toFixed(2);
      }
      if (data.paymentMethod !== undefined) updates.paymentMethod = data.paymentMethod;

      // Reconcile the shop's receivable in one move: switching to/from "debt" and
      // re-discounting both change what this order owes. Comparing old vs new
      // owed amount also covers the cash→debt and debt→cash flips, which a plain
      // "adjust by the total difference" would silently get wrong.
      const newPaymentMethod = data.paymentMethod ?? order.paymentMethod;
      const oldOwed = order.paymentMethod === "debt" && owesDebt(order.status) ? Number(order.total) : 0;
      const newOwed = newPaymentMethod === "debt" && owesDebt(order.status) ? newTotal : 0;
      if (newOwed !== oldOwed) {
        await adjustShopDebt(tx, tenantId, order.shopId, newOwed - oldOwed);
      }

      if (Object.keys(updates).length > 0) {
        await tx.update(orders).set(updates).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
      }
    });

    cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));

    return { success: true };
  },

  /**
   * Rewrites an order's lines: quantities, unit prices, added and removed
   * products. Lines are matched by `itemId`; an entry without one adds a new
   * product, and `quantity: 0` drops the line.
   *
   * Editing is allowed in any status, so stock is moved according to what the
   * current status already did to it (see stockModeFor): a "new" order shifts
   * its reservation, while a delivered one adjusts stock actually on hand.
   * Omitting `items` entirely leaves the lines untouched.
   */
  async updateItems(
    db: Db, tenantId: number, orderId: number,
    data: { items: Array<{ itemId?: number; productId?: number; quantity: number; unitPrice?: string }> },
  ) {
    await db.transaction(async (tx) => {
      const [order] = await tx.select({
        id: orders.id, status: orders.status, shopId: orders.shopId,
        subtotal: orders.subtotal, total: orders.total, discount: orders.discount,
        paymentMethod: orders.paymentMethod, deletedAt: orders.deletedAt,
      }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt))).limit(1);
      if (!order) throw new Error("Заказ не найден");

      const mode = stockModeFor(order.status);
      const whId = await resolveOrderWarehouse(tx, tenantId);
      const existingItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      const existingById = new Map(existingItems.map(i => [i.id, i]));

      // Validate that every new product belongs to this tenant before touching
      // anything — an unknown id must not leave the order half-rewritten.
      const newProductIds = data.items.filter(i => i.itemId === undefined).map(i => i.productId);
      if (newProductIds.some(id => id === undefined)) {
        throw new Error("Для новой позиции нужно указать товар");
      }
      const productPrices = new Map<number, { costPrice: string }>();
      if (newProductIds.length > 0) {
        const found = await tx.select({ id: products.id, costPrice: products.costPrice })
          .from(products)
          .where(and(eq(products.tenantId, tenantId), inArray(products.id, newProductIds as number[])));
        for (const p of found) productPrices.set(Number(p.id), { costPrice: p.costPrice });
        for (const id of newProductIds as number[]) {
          if (!productPrices.has(id)) throw new Error(`Товар #${id} не найден в вашей организации`);
        }
      }

      // Lock every stock row this edit can touch, in one pass, before any write.
      const touchedProductIds = [...new Set([
        ...existingItems.map(i => i.productId),
        ...(newProductIds as number[]),
      ])];
      for (const productId of touchedProductIds) {
        await tx.select({ id: warehouseStock.id }).from(warehouseStock)
          .where(and(eq(warehouseStock.productId, productId), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, whId)))
          .for("update");
      }

      const keptItemIds = new Set<number>();
      let newSubtotal = 0;

      for (const line of data.items) {
        if (line.quantity < 0) throw new Error("Количество не может быть отрицательным");

        // ── Existing line ──
        if (line.itemId !== undefined) {
          const item = existingById.get(line.itemId);
          if (!item) throw new Error(`Позиция заказа #${line.itemId} не найдена`);

          const oldQty = Number(item.quantity);
          const unitPrice = line.unitPrice !== undefined ? Number(line.unitPrice) : Number(item.unitPrice);
          if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Цена не может быть отрицательной");

          if (line.quantity === 0) {
            await applyStockDelta(tx, tenantId, whId, item.productId, -oldQty, mode);
            await tx.delete(orderItems).where(eq(orderItems.id, item.id));
            continue;
          }

          keptItemIds.add(item.id);
          await applyStockDelta(tx, tenantId, whId, item.productId, line.quantity - oldQty, mode);
          await tx.update(orderItems).set({
            quantity: String(line.quantity),
            unitPrice: unitPrice.toFixed(2),
            subtotal: (unitPrice * line.quantity).toFixed(2),
          }).where(eq(orderItems.id, item.id));

          newSubtotal += unitPrice * line.quantity;
          continue;
        }

        // ── New line ──
        if (line.quantity === 0) continue;
        const productId = line.productId as number;
        const unitPrice = Number(line.unitPrice ?? 0);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Цена не может быть отрицательной");

        await applyStockDelta(tx, tenantId, whId, productId, line.quantity, mode);
        await tx.insert(orderItems).values({
          orderId,
          productId,
          quantity: String(line.quantity),
          unitPrice: unitPrice.toFixed(2),
          costPrice: productPrices.get(productId)?.costPrice ?? "0.00",
          subtotal: (unitPrice * line.quantity).toFixed(2),
        });

        newSubtotal += unitPrice * line.quantity;
      }

      // Lines the caller did not mention stay as they are and still count.
      for (const item of existingItems) {
        if (keptItemIds.has(item.id)) continue;
        if (data.items.some(l => l.itemId === item.id)) continue; // removed above
        newSubtotal += Number(item.unitPrice) * Number(item.quantity);
      }

      if (newSubtotal <= 0) throw new Error("В заказе должна остаться хотя бы одна позиция");

      // Keep the discount proportional to the order's new size.
      const discountPct = Number(order.subtotal) > 0 ? (Number(order.discount) / Number(order.subtotal)) * 100 : 0;
      const newDiscount = newSubtotal * (discountPct / 100);
      const newTotal = newSubtotal - newDiscount;

      await tx.update(orders).set({
        subtotal: newSubtotal.toFixed(2),
        discount: newDiscount.toFixed(2),
        total: newTotal.toFixed(2),
      }).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));

      if (order.paymentMethod === "debt" && owesDebt(order.status)) {
        const totalDiff = newTotal - Number(order.total);
        if (totalDiff !== 0) await adjustShopDebt(tx, tenantId, order.shopId, totalDiff);
      }
    });

    cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));
    return { success: true };
  },

  async restore(db: Db, tenantId: number, orderId: number) {
    const [order] = await db.select({
      id: orders.id, deletedAt: orders.deletedAt, status: orders.status,
      shopId: orders.shopId, total: orders.total, paymentMethod: orders.paymentMethod,
    }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1);
    if (!order) throw new Error("Заказ не найден");
    if (!order.deletedAt) throw new Error("Заказ не удалён");

    await db.transaction(async (tx) => {
      await tx.update(orders).set({ deletedAt: null }).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));

      // Mirror of delete(): the receivable comes back with the order.
      if (order.paymentMethod === "debt" && holdsStock(order.status)) {
        await adjustShopDebt(tx, tenantId, order.shopId, Number(order.total));
      }

      // Re-reserve stock if order was new/processing when deleted
      if (holdsStock(order.status)) {
        const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
        const restoreWhId = await resolveOrderWarehouse(tx, tenantId);

        // Lock stock rows before checking and updating
        for (const item of items) {
          await tx.select({ id: warehouseStock.id }).from(warehouseStock)
            .where(and(eq(warehouseStock.productId, item.productId), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, restoreWhId)))
            .for("update");
        }
        for (const item of items) {
          const qty = Number(item.quantity);
          const [stock] = await tx.select({ available: warehouseStock.available })
            .from(warehouseStock)
            .where(and(eq(warehouseStock.productId, item.productId), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, restoreWhId)))
            .limit(1);
          const available = Number(stock?.available ?? 0);
          if (available < qty) {
            throw new Error(`Недостаточно товара на складе для восстановления (товар ID ${item.productId}: доступно ${available}, нужно ${qty})`);
          }
          await tx.execute(sql`
            UPDATE warehouse_stock
            SET available = available - ${qty}, reserved = reserved + ${qty}
            WHERE product_id = ${item.productId} AND tenant_id = ${tenantId} AND warehouse_id = ${restoreWhId}
          `);
        }
      }
    });

    cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));

    return { success: true };
  },

  // ── Batch operations ──────────────────────────────────────────────────────

  async batchGetOrdersForPrint(db: Db, tenantId: number, orderIds: number[]) {
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
      .leftJoin(shops, eq(orders.shopId, shops.id))
      .leftJoin(users, eq(orders.agentId, users.id))
      .leftJoin(territories, eq(shops.territoryId, territories.id))
      .leftJoin(couriers, eq(orders.courierId, couriers.id))
      .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, orderIds)));

    // Fetch items for all orders in one query
    const allItems = await db.select({
      orderId: orderItems.orderId,
      productId: orderItems.productId,
      quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice,
      costPrice: orderItems.costPrice,
      subtotal: orderItems.subtotal,
      productName: products.name,
      productCode: products.code,
      unit: products.unit,
    }).from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
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

    return ordersData.map(o => ({
      ...o,
      items: itemsByOrder.get(o.id) ?? [],
      shopDebtAmount: Number(o.shopDebt ?? 0),
      paymentHistory: paymentsByShop.get(o.shopId) ?? [],
    }));
  },

  async markInvoicesPrinted(db: Db, tenantId: number, orderIds: number[]) {
    if (orderIds.length === 0) return;
    await db.update(orders)
      .set({ invoicePrintedAt: new Date() })
      .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, orderIds)));
  },

  async bulkUpdateStatus(
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
        await this.updateStatus(db, tenantId, orderId, newStatus);
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
  },

  async bulkAssignAgent(db: Db, tenantId: number, orderIds: number[], agentId: number) {
    if (orderIds.length === 0) return { updated: 0 };

    // Verify agent exists and belongs to tenant
    const [agent] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.id, agentId), eq(users.tenantId, tenantId))).limit(1);
    if (!agent) throw new Error("Агент не найден");

    await db.update(orders)
      .set({ agentId })
      .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, orderIds)));

    return { updated: orderIds.length };
  },

  // ── Loading Lists ─────────────────────────────────────────────────────────

  async createLoadingList(
    db: Db, tenantId: number, createdBy: number,
    input: {
      orderIds: number[];
      format: "aggregated" | "byOrder" | "byRoute";
      warehouseId?: number;
      options?: { includeBarcodes?: boolean; includeWeight?: boolean; includeTotalWeight?: boolean };
    },
  ) {
    if (input.orderIds.length === 0) throw new Error("Выберите хотя бы один заказ");

    const ordersData = await db.select({
      id: orders.id, orderNumber: orders.orderNumber, status: orders.status,
      shopId: orders.shopId, agentId: orders.agentId, total: orders.total,
      paymentMethod: orders.paymentMethod,
      shopName: shops.name, shopAddress: shops.address, shopCity: shops.city,
      shopPhone: shops.phone, shopGpsLat: shops.gpsLat, shopGpsLng: shops.gpsLng,
      shopDebt: shops.debt, agentName: users.name,
      territoryName: territories.name,
      courierName: couriers.name,
    }).from(orders)
      .leftJoin(shops, eq(orders.shopId, shops.id))
      .leftJoin(users, eq(orders.agentId, users.id))
      .leftJoin(territories, eq(shops.territoryId, territories.id))
      .leftJoin(couriers, eq(orders.courierId, couriers.id))
      .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, input.orderIds)));

    if (ordersData.length === 0) throw new Error("Заказы не найдены");

    // Fetch items aggregated
    const items = await db.select({
      productId: orderItems.productId,
      productName: products.name,
      productCode: products.code,
      unit: products.unit,
      unitWeight: products.unitWeight,
      totalQty: sql<string>`SUM(${orderItems.quantity})`,
      totalPrice: sql<string>`SUM(${orderItems.subtotal})`,
    }).from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(and(eq(orders.tenantId, tenantId), inArray(orderItems.orderId, input.orderIds)))
      .groupBy(orderItems.productId, products.name, products.code, products.unit, products.unitWeight);

    // Fetch items grouped by (product, agent) for the route/agent-matrix format
    const itemsByAgent = await db.select({
      productId: orderItems.productId,
      productName: products.name,
      productCode: products.code,
      unit: products.unit,
      agentId: orders.agentId,
      agentName: users.name,
      totalQty: sql<string>`SUM(${orderItems.quantity})`,
    }).from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .leftJoin(users, eq(orders.agentId, users.id))
      .where(and(eq(orders.tenantId, tenantId), inArray(orderItems.orderId, input.orderIds)))
      .groupBy(orderItems.productId, products.name, products.code, products.unit, orders.agentId, users.name);

    const totalItems = items.reduce((s, i) => s + Number(i.totalQty), 0);
    const totalWeight = items.reduce((s, i) => s + Number(i.totalQty) * Number(i.unitWeight ?? 0), 0);

    // Generate list number
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    const listNumber = `ZL-${date}-${rand}`;

    // Insert loading list
    const [result] = await db.insert(loadingLists).values({
      tenantId, listNumber,
      warehouseId: input.warehouseId ?? null,
      agentId: ordersData[0]?.agentId ?? null,
      status: "preparing",
      totalOrders: ordersData.length,
      totalItems,
      totalWeight: totalWeight.toFixed(3),
      createdBy,
    });
    const listId = Number(result.insertId);

    // Link orders to list
    await db.insert(loadingListOrders).values(
      input.orderIds.map(orderId => ({ listId, orderId }))
    );

    // Audit
    try {
      const { recordAudit } = await import("./audit-log");
      await recordAudit(db, {
        tenantId, actorId: createdBy, action: "loading_list.created",
        targetType: "loading_list", targetId: listId,
        meta: { listNumber, orderIds: input.orderIds, totalWeight, format: input.format },
      });
    } catch { /* non-blocking */ }

    return {
      listId, listNumber, orders: ordersData, items, itemsByAgent,
      totalOrders: ordersData.length, totalItems, totalWeight,
    };
  },

  async listLoadingLists(db: Db, tenantId: number, opts?: { page?: number; pageSize?: number; status?: string }) {
    const page = opts?.page ?? 1;
    const limit = opts?.pageSize ?? 25;
    const offset = (page - 1) * limit;

    const conditions = [eq(loadingLists.tenantId, tenantId)];
    if (opts?.status) conditions.push(eq(loadingLists.status, opts.status as "preparing" | "ready" | "loading" | "loaded" | "delivered"));

    const [data, countResult] = await Promise.all([
      db.select({
        id: loadingLists.id,
        listNumber: loadingLists.listNumber,
        status: loadingLists.status,
        totalOrders: loadingLists.totalOrders,
        totalItems: loadingLists.totalItems,
        totalWeight: loadingLists.totalWeight,
        createdAt: loadingLists.createdAt,
        loadedAt: loadingLists.loadedAt,
        agentName: users.name,
      }).from(loadingLists)
        .leftJoin(users, eq(loadingLists.agentId, users.id))
        .where(and(...conditions))
        .orderBy(desc(loadingLists.createdAt))
        .limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(loadingLists).where(and(...conditions)),
    ]);

    return { data, total: Number(countResult[0]?.count ?? 0), page, pageSize: limit };
  },

  async updateLoadingListStatus(db: Db, tenantId: number, listId: number, newStatus: string) {
    const validTransitions: Record<string, string[]> = {
      preparing: ["ready"],
      ready: ["loading"],
      loading: ["loaded"],
      loaded: ["delivered"],
    };

    const [list] = await db.select({ id: loadingLists.id, status: loadingLists.status })
      .from(loadingLists)
      .where(and(eq(loadingLists.id, listId), eq(loadingLists.tenantId, tenantId)))
      .limit(1);
    if (!list) throw new Error("Загрузочный лист не найден");

    if (!validTransitions[list.status]?.includes(newStatus)) {
      throw new Error(`Невозможно перевести из "${list.status}" в "${newStatus}"`);
    }

    const updates: Record<string, unknown> = { status: newStatus };
    if (newStatus === "loaded") updates.loadedAt = new Date();
    if (newStatus === "delivered") updates.deliveredAt = new Date();

    await db.update(loadingLists).set(updates)
      .where(and(eq(loadingLists.id, listId), eq(loadingLists.tenantId, tenantId)));

    return { success: true };
  },

  // ── Partial Payment ────────────────────────────────────────────────────────

  async recordPartialPayment(
    db: Db, tenantId: number, userId: number,
    input: {
      orderId: number;
      paidAmount: string;
      method: "cash" | "card" | "transfer";
      debtDueDate?: string;
      notes?: string;
    },
  ) {
    await db.transaction((tx) => applyPartialPayment(tx, tenantId, userId, input));
    cache.invalidate(CacheKeys.dashboardKpis(tenantId));
    return { success: true };
  },

  // ── Partial Delivery ───────────────────────────────────────────────────────

  async recordPartialDelivery(
    db: Db, tenantId: number, userId: number,
    input: {
      orderId: number;
      items: Array<{ itemId: number; deliveredQuantity: number; returnReason?: string }>;
      photos?: string[];
    },
  ) {
    await db.transaction((tx) => applyPartialDelivery(tx, tenantId, userId, input));
    cache.invalidate(CacheKeys.dashboardKpis(tenantId));
    return { success: true };
  },

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
  async bulkCompleteWithPayment(db: Db, tenantId: number, userId: number, orderIds: number[]) {
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
          if (order.status !== "delivered") await this.updateStatus(db, tenantId, orderId, "delivered");
          updated++;
          continue;
        }

        if (order.status !== "delivered") {
          await this.updateStatus(db, tenantId, orderId, "delivered");
        }
        const remaining = total - Number(alreadyPaid);
        await db.transaction(tx => applyPartialPayment(tx, tenantId, userId, {
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
  },

  async recordDeliveryAndPayment(
    db: Db, tenantId: number, userId: number,
    input: {
      orderId: number;
      deliveredItems: Array<{ itemId: number; deliveredQuantity: number; returnReason?: string }>;
      payment: { paidAmount: string; method: "cash" | "card" | "transfer"; debtDueDate?: string; notes?: string };
      photos?: string[];
    },
  ) {
    await db.transaction(async (tx) => {
      await applyPartialDelivery(tx, tenantId, userId, {
        orderId: input.orderId,
        items: input.deliveredItems,
        photos: input.photos,
      });
      await applyPartialPayment(tx, tenantId, userId, {
        orderId: input.orderId,
        paidAmount: input.payment.paidAmount,
        method: input.payment.method,
        debtDueDate: input.payment.debtDueDate,
        notes: input.payment.notes,
      });
    });

    cache.invalidate(CacheKeys.dashboardKpis(tenantId));
    return { success: true };
  },

  // ── Get Order Adjustments ──────────────────────────────────────────────────

  async getAdjustments(db: Db, tenantId: number, orderId: number) {
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
      .leftJoin(users, eq(orderAdjustments.adjustedBy, users.id))
      .where(and(eq(orderAdjustments.orderId, orderId), eq(orderAdjustments.tenantId, tenantId)))
      .orderBy(desc(orderAdjustments.createdAt));
  },

  // ── Get Order Payments (extended) ──────────────────────────────────────────

  async getOrderPayments(db: Db, tenantId: number, orderId: number) {
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
      .leftJoin(users, eq(payments.createdBy, users.id))
      .where(and(eq(payments.orderId, orderId), eq(payments.tenantId, tenantId)))
      .orderBy(desc(payments.createdAt));
  },

};