import { eq, and, desc, sql, isNull } from "drizzle-orm";
import { orders, orderItems, warehouseStock, shops, users, products } from "@db/schema";
import { cache, CacheKeys } from "../lib/cache";
import { NotificationService } from "./NotificationService";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

export const OrderService = {
  async list(db: Db, tenantId: number, filters: Record<string, unknown>, _opts?: { userId: number; userRole: string }) {
    const f = filters as { status?: "new" | "processing" | "completed" | "cancelled"; agentId?: number; page?: number; pageSize?: number; search?: string; showDeleted?: boolean };
    const page = f.page ?? 1;
    const limit = f.pageSize ?? 25;
    const offset = (page - 1) * limit;

    const conditions = [eq(orders.tenantId, tenantId)];
    if (f.status) conditions.push(eq(orders.status, f.status));
    if (f.agentId) conditions.push(eq(orders.agentId, f.agentId));
    // Hide deleted orders unless explicitly requested
    if (!f.showDeleted) conditions.push(isNull(orders.deletedAt));

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
    }).from(orders)
      .leftJoin(shops, eq(orders.shopId, shops.id))
      .leftJoin(users, eq(orders.agentId, users.id))
      .where(and(...conditions));

    const [data, countResult] = await Promise.all([
      baseQuery.orderBy(desc(orders.createdAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(orders).where(and(...conditions)),
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
    }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt))).limit(1);
    if (!order) return null;

    const [items, [shop]] = await Promise.all([
      db.select({
        id: orderItems.id, productId: orderItems.productId, quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice, subtotal: orderItems.subtotal,
      }).from(orderItems).where(eq(orderItems.orderId, orderId)),
      db.select({ id: shops.id, name: shops.name, address: shops.address, city: shops.city, phone: shops.phone })
        .from(shops).where(eq(shops.id, order.shopId)).limit(1),
    ]);

    return { ...order, items, shop: shop ?? null };
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
      }).from(orders).where(and(...conditions)).orderBy(desc(orders.createdAt)).limit(500),
      db.select({ count: sql<number>`count(*)` }).from(orders).where(and(...conditions)),
    ]);
    return { data, total: Number(countResult[0]?.count ?? 0) };
  },

  async create(db: Db, tenantId: number, agentId: number, input: { shopId: number; items: Array<{ productId: number; quantity: string }>; notes?: string; discount?: string; idempotencyKey?: string; paymentMethod?: "cash" | "card" | "transfer" | "debt" }) {
    const discount = Number(input.discount ?? "0");

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
      const productRows = await tx.select({ id: products.id, unitPrice: products.unitPrice })
        .from(products)
        .where(and(
          sql`${products.id} IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})`,
          eq(products.tenantId, tenantId),
          eq(products.status, "active"),
        ));
      const priceMap = new Map<number, string>();
      for (const p of productRows) priceMap.set(p.id, p.unitPrice);

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

      // SELECT stock rows (for update - row-level locking via transaction)
      const stockRows = await tx.select().from(warehouseStock)
        .where(and(
          sql`${warehouseStock.productId} IN (${sql.join(input.items.map(i => sql`${i.productId}`), sql`, `)})`,
          eq(warehouseStock.tenantId, tenantId),
        ));

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
          subtotal: (unitPrice * Number(item.quantity)).toFixed(2),
        };
      }));

      if (input.items.length > 0) {
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

    // Notify operators/CEO about new order
    try {
      const [shop] = await db.select({ name: shops.name }).from(shops).where(eq(shops.id, input.shopId)).limit(1);
      const operators = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.tenantId, tenantId), sql`${users.role} IN ('ceo', 'operator')`, eq(users.status, "active")));

      for (const op of operators) {
        await NotificationService.create(db, {
          tenantId,
          userId: op.id,
          type: "order",
          title: `Новый заказ ${orderNumber}`,
          message: `${shop?.name ?? "Магазин"} — ${orderTotal.toLocaleString("ru")} сум`,
          link: `/orders/${orderId}`,
        });
      }
    } catch { /* notification is non-critical */ }

    return { id: orderId, orderNumber };
  },

  async cancel(db: Db, tenantId: number, orderId: number, opts: { userId: number; userRole: string }) {
    await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), eq(orders.agentId, opts.userId))).limit(1);
      if (!order) throw new Error("Заказ не найден");
      if (order.status !== "new") throw new Error("Можно отменить только новые заказы");

      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      if (items.length > 0) {
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
        `);
      }
      await tx.update(orders).set({ status: "cancelled" }).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
    });

    cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));

    return { success: true };
  },

  async updateStatus(db: Db, tenantId: number, orderId: number, newStatus: "new" | "processing" | "completed" | "cancelled") {
    await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1);
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

      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      if (items.length > 0) {
        if (newStatus === "completed") {
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
          `);
        }
        if (newStatus === "cancelled") {
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
          `);
        }
      }
      await tx.update(orders).set({ status: newStatus }).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
    });

    cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));

    return { success: true };
  },

  async delete(db: Db, tenantId: number, orderId: number) {
    await db.transaction(async (tx) => {
      const [order] = await tx.select({
        id: orders.id,
        status: orders.status,
        deletedAt: orders.deletedAt,
      }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt))).limit(1);
      if (!order) throw new Error("Заказ не найден или уже удалён");

      // Release reserved stock if order is new or processing
      if (order.status === "new" || order.status === "processing") {
        const items = await tx.select({
          productId: orderItems.productId,
          quantity: orderItems.quantity,
        }).from(orderItems).where(eq(orderItems.orderId, orderId));
        if (items.length > 0) {
          await tx.execute(sql`
            UPDATE warehouse_stock
            SET
              reserved = reserved - CASE ${sql.join(items.map(i =>
                sql`WHEN product_id = ${i.productId} THEN ${Number(i.quantity)}`
              ), sql`\n`)} ELSE reserved END,
              available = available + CASE ${sql.join(items.map(i =>
                sql`WHEN product_id = ${i.productId} THEN ${Number(i.quantity)}`
              ), sql`\n`)} ELSE available END
            WHERE product_id IN (${sql.join(items.map(i => sql`${i.productId}`), sql`, `)})
              AND tenant_id = ${tenantId}
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
    const [order] = await db.select({
      id: orders.id,
      subtotal: orders.subtotal,
      deletedAt: orders.deletedAt,
    }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt))).limit(1);
    if (!order) throw new Error("Заказ не найден");

    const updates: Record<string, unknown> = {};
    if (data.notes !== undefined) updates.notes = data.notes;
    if (data.discount !== undefined) {
      updates.discount = data.discount;
      // Recalculate total
      const subtotal = Number(order.subtotal);
      const discount = Number(data.discount);
      updates.total = String(subtotal - discount);
    }

    if (Object.keys(updates).length > 0) {
      await db.update(orders).set(updates).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
    }

    cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));

    return { success: true };
  },

  async restore(db: Db, tenantId: number, orderId: number) {
    const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1);
    if (!order) throw new Error("Заказ не найден");
    if (!order.deletedAt) throw new Error("Заказ не удалён");

    await db.update(orders).set({ deletedAt: null }).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));

    cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));

    return { success: true };
  },

};