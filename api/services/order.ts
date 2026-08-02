import { eq, and, desc, sql, isNull, inArray } from "drizzle-orm";
import { orders, orderItems, warehouseStock, shops, users, products, notifications, warehouses, payments, loadingLists, loadingListOrders, auditLog, debtReminders, orderAdjustments, stockMovements, territories } from "@db/schema";
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
function holdsStock(status: string): boolean {
  return ["new", "processing", "shipped", "pending"].includes(status);
}

/** Status that triggers stock deduction (goods left the warehouse). */
function deductsStock(status: string): boolean {
  return status === "delivered" || status === "completed" || status === "partial_return_kept";
}

/** Status that releases stock (goods returned to warehouse). */
function releasesStock(status: string): boolean {
  return status === "cancelled" || status === "returned" || status === "partially_returned";
}

/** Delivered statuses — includes legacy "completed" for backwards compatibility. */
const DELIVERED_STATUSES = ["delivered", "completed"];

export const OrderService = {
  async list(db: Db, tenantId: number, filters: Record<string, unknown>, opts?: { userId: number; userRole: string }) {
    const f = filters as { status?: string; agentId?: number; page?: number; pageSize?: number; search?: string; showDeleted?: boolean; dateFrom?: string; dateTo?: string; paymentMethod?: string };
    const page = f.page ?? 1;
    const limit = f.pageSize ?? 25;
    const offset = (page - 1) * limit;

    const conditions = [eq(orders.tenantId, tenantId)];
    if (f.status) conditions.push(eq(orders.status, f.status as "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned" | "partially_returned" | "partial_return_kept"));
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

  async updateStatus(db: Db, tenantId: number, orderId: number, newStatus: "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned" | "partially_returned" | "partial_return_kept") {
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

      if (order.status === newStatus) {
        if (["delivered", "completed", "cancelled", "returned"].includes(order.status)) {
          return { success: true };
        }
      }

      const validTransitions: Record<string, string[]> = {
        new:                  ["processing", "cancelled"],
        processing:           ["new", "shipped", "cancelled"],
        shipped:              ["processing", "delivered", "pending", "returned", "partially_returned", "partial_return_kept", "cancelled"],
        pending:              ["shipped", "delivered", "cancelled"],
        delivered:            ["returned", "partially_returned", "partial_return_kept"],
        completed:            ["returned", "partially_returned", "partial_return_kept"], // legacy alias for delivered
        partially_returned:   ["returned", "delivered"],
        partial_return_kept:  ["delivered"],
        returned:             [],
        cancelled:            [],
      };
      if (!validTransitions[order.status]?.includes(newStatus)) {
        throw new Error(`Невозможно перевести из "${order.status}" в "${newStatus}"`);
      }

      // Cancelling/returning a credit order releases the receivable it created.
      if (releasesStock(newStatus) && order.paymentMethod === "debt" && holdsStock(order.status)) {
        await adjustShopDebt(tx, tenantId, order.shopId, -Number(order.total));
      }

      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      if (items.length > 0) {
        if (deductsStock(newStatus)) {
          // Skip stock deduction if courier already delivered (markDelivered handles it)
          if (order.deliveryStatus !== "delivered") {
            const stockWhId = await resolveOrderWarehouse(tx, tenantId);

            // Lock all stock rows in one batch query (prevents deadlock)
            const stockRows = await tx.select({ productId: warehouseStock.productId, currentStock: warehouseStock.currentStock })
              .from(warehouseStock)
              .where(and(
                eq(warehouseStock.tenantId, tenantId),
                eq(warehouseStock.warehouseId, stockWhId),
                sql`${warehouseStock.productId} IN (${sql.join(items.map(i => sql`${i.productId}`), sql`, `)})`
              ))
              .for("update");

            // Check for sufficient stock before deducting
            const insufficient = items.filter(i => {
              const row = stockRows.find(r => Number(r.productId) === i.productId);
              return !row || Number(row.currentStock) < Number(i.quantity);
            });
            if (insufficient.length > 0) {
              throw new Error(`Недостаточно товара на складе: ${insufficient.map(i => `${i.productId}`).join(", ")}`);
            }

            await tx.execute(sql`
              UPDATE warehouse_stock
              SET
                current_stock = CASE ${sql.join(items.map(i =>
                  sql`WHEN product_id = ${i.productId} THEN current_stock - ${Number(i.quantity)}`
                ), sql`\n`)} ELSE current_stock END,
                reserved = CASE ${sql.join(items.map(i =>
                  sql`WHEN product_id = ${i.productId} THEN reserved - ${Number(i.quantity)}`
                ), sql`\n`)} ELSE reserved END
              WHERE product_id IN (${sql.join(items.map(i => sql`${i.productId}`), sql`, `)})
                AND tenant_id = ${tenantId}
                AND warehouse_id = ${stockWhId}
            `);

            // Verify no negative stock (rollback if needed — should not happen due to check above)
            const updated = await tx.select({ productId: warehouseStock.productId, currentStock: warehouseStock.currentStock })
              .from(warehouseStock)
              .where(and(
                eq(warehouseStock.tenantId, tenantId),
                eq(warehouseStock.warehouseId, stockWhId),
                sql`${warehouseStock.productId} IN (${sql.join(items.map(i => sql`${i.productId}`), sql`, `)})`
              ));
            const short = items.filter(i => {
              const row = updated.find(r => Number(r.productId) === i.productId);
              return row && Number(row.currentStock) < 0;
            });
            if (short.length > 0) {
              await tx.execute(sql`
                UPDATE warehouse_stock
                SET
                  current_stock = CASE ${sql.join(short.map(i =>
                    sql`WHEN product_id = ${i.productId} THEN current_stock + ${Number(i.quantity)}`
                  ), sql`\n`)} ELSE current_stock END,
                  reserved = CASE ${sql.join(short.map(i =>
                    sql`WHEN product_id = ${i.productId} THEN reserved + ${Number(i.quantity)}`
                  ), sql`\n`)} ELSE reserved END
                WHERE product_id IN (${sql.join(short.map(i => sql`${i.productId}`), sql`, `)})
                  AND tenant_id = ${tenantId}
                  AND warehouse_id = ${stockWhId}
              `);
              throw new Error(`Недостаточно товара на складе: ${short.map(i => `${i.productId}`).join(", ")}`);
            }
          }
        }
        if (releasesStock(newStatus)) {
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

  async update(db: Db, tenantId: number, orderId: number, data: { notes?: string; discount?: string }) {
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
      if (data.discount !== undefined) {
        const subtotal = Number(order.subtotal);
        const discount = subtotal * (Number(data.discount) / 100);
        const newTotal = subtotal - discount;
        updates.discount = discount.toFixed(2);
        updates.total = newTotal.toFixed(2);

        // The shop's debt was booked from the old total — move it by the difference,
        // otherwise a re-discounted credit order leaves the receivable overstated.
        if (order.paymentMethod === "debt" && holdsStock(order.status)) {
          await adjustShopDebt(tx, tenantId, order.shopId, newTotal - Number(order.total));
        }
      }

      if (Object.keys(updates).length > 0) {
        await tx.update(orders).set(updates).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
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
    }).from(orders)
      .leftJoin(shops, eq(orders.shopId, shops.id))
      .leftJoin(users, eq(orders.agentId, users.id))
      .leftJoin(territories, eq(shops.territoryId, territories.id))
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
    newStatus: "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned" | "partially_returned" | "partial_return_kept",
    actorId?: number, comment?: string,
  ) {
    if (orderIds.length === 0) return { updated: 0 };
    if (orderIds.length > 100) throw new Error("Максимум 100 заказов за раз");

    let updated = 0;
    for (const orderId of orderIds) {
      try {
        await this.updateStatus(db, tenantId, orderId, newStatus);
        updated++;
      } catch (e) {
        logger.warn("Bulk status update failed for order", { orderId, error: String(e) });
      }
    }

    // Audit log
    try {
      const { recordAudit } = await import("./audit-log");
      await recordAudit(db, {
        tenantId, actorId, action: "order.bulk_status_change",
        targetType: "order", meta: { orderIds, newStatus, updated, comment },
      });
    } catch { /* audit is non-blocking */ }

    return { updated };
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
      shopName: shops.name, shopAddress: shops.address, shopCity: shops.city,
      shopPhone: shops.phone, shopGpsLat: shops.gpsLat, shopGpsLng: shops.gpsLng,
      shopDebt: shops.debt, agentName: users.name,
      territoryName: territories.name,
    }).from(orders)
      .leftJoin(shops, eq(orders.shopId, shops.id))
      .leftJoin(users, eq(orders.agentId, users.id))
      .leftJoin(territories, eq(shops.territoryId, territories.id))
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
      listId, listNumber, orders: ordersData, items,
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
    const paid = Number(input.paidAmount);
    if (paid <= 0) throw new Error("Сумма оплаты должна быть положительной");

    await db.transaction(async (tx) => {
      const [order] = await tx.select({
        id: orders.id, status: orders.status, total: orders.total,
        shopId: orders.shopId, orderNumber: orders.orderNumber,
      }).from(orders)
        .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt)))
        .limit(1);
      if (!order) throw new Error("Заказ не найден");

      const total = Number(order.total);
      if (paid > total) throw new Error("Сумма оплаты не может превышать сумму заказа");

      const debt = total - paid;

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

      // Update shop debt: at order creation the full total was added to debt
      // (for "debt" payment method). Now the customer pays part of it —
      // reduce the debt by the paid amount.
      if (paid > 0) {
        await tx.execute(sql`
          UPDATE shops SET debt = GREATEST(0, CAST(debt AS DECIMAL(12,2)) - ${paid})
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

      // Update order status
      await tx.update(orders).set({
        status: debt > 0 ? "partial_return_kept" : "delivered",
      }).where(and(eq(orders.id, order.id), eq(orders.tenantId, tenantId)));

      // Log adjustment
      await tx.insert(orderAdjustments).values({
        tenantId,
        orderId: order.id,
        adjustedBy: userId,
        type: "partial_payment",
        oldValue: { status: order.status, total: order.total },
        newValue: { status: debt > 0 ? "partial_return_kept" : "delivered", paid: paid.toFixed(2), debt: Math.max(0, debt).toFixed(2) },
        reason: input.notes ?? null,
      });
    });

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
    if (input.items.length === 0) throw new Error("Выберите хотя бы один товар");

    await db.transaction(async (tx) => {
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

      for (const item of input.items) {
        const [orderItem] = await tx.select({
          id: orderItems.id, quantity: orderItems.quantity,
          unitPrice: orderItems.unitPrice, subtotal: orderItems.subtotal,
          productId: orderItems.productId,
        }).from(orderItems)
          .where(and(eq(orderItems.id, item.itemId), eq(orderItems.orderId, order.id)))
          .limit(1);
        if (!orderItem) throw new Error(`Позиция заказа #${item.itemId} не найдена`);

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

        // Return undelivered stock to warehouse
        if (returnedQty > 0) {
          const [defaultWh] = await tx.select({ id: warehouses.id }).from(warehouses)
            .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true))).limit(1);
          if (defaultWh) {
            await tx.execute(sql`
              UPDATE warehouse_stock
              SET current_stock = current_stock + ${returnedQty},
                  available = available + ${returnedQty},
                  reserved = GREATEST(0, reserved - ${returnedQty})
              WHERE product_id = ${orderItem.productId} AND tenant_id = ${tenantId} AND warehouse_id = ${defaultWh.id}
            `);

            // Log stock movement
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

      await tx.update(orders).set({
        subtotal: newSubtotal.toFixed(2),
        total: newTotal.toFixed(2),
        status: "partially_returned",
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
    });

    cache.invalidate(CacheKeys.dashboardKpis(tenantId));
    return { success: true };
  },

  // ── Combined Delivery + Payment ────────────────────────────────────────────

  async recordDeliveryAndPayment(
    db: Db, tenantId: number, userId: number,
    input: {
      orderId: number;
      deliveredItems: Array<{ itemId: number; deliveredQuantity: number; returnReason?: string }>;
      payment: { paidAmount: string; method: "cash" | "card" | "transfer"; debtDueDate?: string; notes?: string };
      photos?: string[];
    },
  ) {
    // Step 1: Record partial delivery (adjusts order total)
    await this.recordPartialDelivery(db, tenantId, userId, {
      orderId: input.orderId,
      items: input.deliveredItems,
      photos: input.photos,
    });

    // Step 2: Record partial payment against the adjusted total
    await this.recordPartialPayment(db, tenantId, userId, {
      orderId: input.orderId,
      paidAmount: input.payment.paidAmount,
      method: input.payment.method,
      debtDueDate: input.payment.debtDueDate,
      notes: input.payment.notes,
    });

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