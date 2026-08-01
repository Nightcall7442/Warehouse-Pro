import { eq, and, desc, sql, isNull } from "drizzle-orm";
import { orders, orderItems, shops, users, products } from "@db/schema";
import { beforeNextDay, safeDateParse, sinceDay } from "../../lib/date-range";
import type { ActorOpts, Db, ListFilters } from "./types";

/**
 * The read side: paginated lists and the order detail view.
 *
 * These shapes are what the UI consumes, so they are kept together and away from
 * the write path — a column added for a screen shouldn't touch order lifecycle code.
 */

const PRIVILEGED_ROLES = ["ceo", "operator", "supervisor", "superadmin"];

export const OrderReadModel = {
  async list(db: Db, tenantId: number, filters: ListFilters, opts?: ActorOpts) {
    const page = filters.page ?? 1;
    const limit = filters.pageSize ?? 25;
    const offset = (page - 1) * limit;

    const conditions = [eq(orders.tenantId, tenantId)];
    if (filters.status) conditions.push(eq(orders.status, filters.status));
    if (filters.agentId) conditions.push(eq(orders.agentId, filters.agentId));
    // P0-14 FIX: Implement search filter
    if (filters.search) {
      conditions.push(sql`(${orders.orderNumber} LIKE ${'%' + filters.search + '%'} OR ${shops.name} LIKE ${'%' + filters.search + '%'})`);
    }
    // FIX: P0.1 — filters arrive as unknown values, so validate the days and use
    // sargable day boundaries instead of comparing against a built-up string.
    const dateFrom = safeDateParse(filters.dateFrom);
    const dateTo = safeDateParse(filters.dateTo);
    if (dateFrom) conditions.push(sinceDay(orders.createdAt, dateFrom));
    if (dateTo) conditions.push(beforeNextDay(orders.createdAt, dateTo));
    // Hide deleted orders unless explicitly requested
    if (!filters.showDeleted) conditions.push(isNull(orders.deletedAt));
    // P0-14 FIX: Non-privileged users see only their own orders
    if (opts && !PRIVILEGED_ROLES.includes(opts.userRole)) {
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

  async getById(db: Db, tenantId: number, orderId: number) {
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
};
