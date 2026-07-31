import { eq, and, desc, sql, isNull } from "drizzle-orm";
import { orders, orderItems, warehouseStock, shops, users, products, notifications, warehouses } from "@db/schema";
import { cache, CacheKeys } from "../lib/cache";
import { beforeNextDay, safeDateParse, sinceDay } from "../lib/date-range";
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

/** Stock is only committed to an order while it is new or processing. */
function holdsStock(status: string): boolean {
  return status === "new" || status === "processing";
}

export const OrderService = {
  async list(db: Db, tenantId: number, filters: Record<string, unknown>, opts?: { userId: number; userRole: string }) {
    const f = filters as { status?: "new" | "processing" | "completed" | "cancelled"; agentId?: number; page?: number; pageSize?: number; search?: string; showDeleted?: boolean; dateFrom?: string; dateTo?: string };
    const page = f.page ?? 1;
    const limit = f.pageSize ?? 25;
    const offset = (page - 1) * limit;

    const conditions = [eq(orders.tenantId, tenantId)];
    if (f.status) conditions.push(eq(orders.status, f.status));
    if (f.agentId) conditions.push(eq(orders.agentId, f.agentId));
    // P0-14 FIX: Implement search filter
    if (f.search) conditions.push(sql`(${orders.orderNumber} LIKE ${'%' + f.search + '%'} OR ${shops.name} LIKE ${'%' + f.search + '%'})`);
    // P0-14 FIX: Implement date filters
    // FIX: P0.1 — filters arrive as unknown values, so validate the days and use
    // sargable day boundaries instead of comparing against a built-up string.
    const dateFrom = safeDateParse(f.dateFrom);
    const dateTo = safeDateParse(f.dateTo);
    if (dateFrom) conditions.push(sinceDay(orders.createdAt, dateFrom));
    if (dateTo) conditions.push(beforeNextDay(orders.createdAt, dateTo));
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
    }).from(orders)
      .leftJoin(shops, eq(orders.shopId, shops.id))
      .leftJoin(users, eq(orders.agentId, users.id))
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
      paymentMethod: orders.paymentMethod,
    }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt))).limit(1);
    if (!order) return null;

    const [items, [shop], [agent]] = await Promise.all([
      db.select({
        id: orderItems.id, productId: orderItems.productId, quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice, subtotal: orderItems.subtotal,
        productName: products.name, productCode: products.code,
      }).from(orderItems)
        .innerJoin(products, eq(orderItems.productId, products.id))
        .where(eq(orderItems.orderId, orderId)),
      db.select({ id: shops.id, name: shops.name, address: shops.address, city: shops.city, phone: shops.phone })
        .from(shops).where(and(eq(shops.id, order.shopId), eq(shops.tenantId, tenantId))).limit(1),
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
    const discount = Number(input.discount ?? "0");
    if (discount < 0) throw new Error("Скидка не может быть отрицательной");

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
      if (discount > subtotal) {
        throw new Error(`Скидка (${discount}) не может превышать сумму заказа (${subtotal})`);
      }
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

  async updateStatus(db: Db, tenantId: number, orderId: number, newStatus: "new" | "processing" | "completed" | "cancelled") {
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
        if (order.status === "completed" || order.status === "cancelled") {
          return { success: true };
        }
      }

      const validTransitions: Record<string, string[]> = { new: ["processing", "completed", "cancelled"], processing: ["completed", "cancelled"] };
      if (!validTransitions[order.status]?.includes(newStatus)) {
        throw new Error(`Невозможно перевести из "${order.status}" в "${newStatus}"`);
      }

      // Cancelling a credit order releases the receivable it created. Completed
      // orders are left alone — the goods changed hands and the debt stands.
      if (newStatus === "cancelled" && order.paymentMethod === "debt" && holdsStock(order.status)) {
        await adjustShopDebt(tx, tenantId, order.shopId, -Number(order.total));
      }

      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      if (items.length > 0) {
        if (newStatus === "completed") {
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
        if (newStatus === "cancelled") {
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
    if (data.discount !== undefined && Number(data.discount) < 0) {
      throw new Error("Скидка не может быть отрицательной");
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
        const discount = Number(data.discount);
        if (discount > subtotal) throw new Error("Скидка не может превышать сумму заказа");
        const newTotal = subtotal - discount;
        updates.discount = data.discount;
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

};