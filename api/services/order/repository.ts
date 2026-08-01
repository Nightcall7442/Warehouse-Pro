import { eq, and, isNull, sql } from "drizzle-orm";
import { orders, orderItems, shops, products } from "@db/schema";
import type { Db, OrderStatus, Tx } from "./types";

/**
 * Order writes and the single-row lookups the lifecycle operations need.
 *
 * No business rules here: callers decide *whether* to move a status or release
 * stock, this module only performs the read or the write. Read models for the UI
 * live in ./read-model.ts.
 */

/** Insert shape minus the status, which is always "new" on creation. */
type NewOrderRow = Omit<typeof orders.$inferInsert, "status">;

export const OrderRepository = {
  /** Shop lookup scoped to the tenant — used to reject cross-tenant order creation. */
  async findShop(db: Db, tenantId: number, shopId: number) {
    const [shop] = await db.select({ id: shops.id }).from(shops)
      .where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId))).limit(1);
    return shop ?? null;
  },

  async findByIdempotencyKey(db: Db, tenantId: number, key: string) {
    const [existing] = await db.select({ id: orders.id, orderNumber: orders.orderNumber })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.idempotencyKey, key)))
      .limit(1);
    return existing ?? null;
  },

  async activeProductPrices(tx: Tx, tenantId: number, productIds: number[]) {
    return tx.select({ id: products.id, unitPrice: products.unitPrice, costPrice: products.costPrice })
      .from(products)
      .where(and(
        sql`${products.id} IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})`,
        eq(products.tenantId, tenantId),
        eq(products.status, "active"),
      ));
  },

  async insertOrder(tx: Tx, values: NewOrderRow): Promise<number> {
    const [result] = await tx.insert(orders).values({ ...values, status: "new" });
    return Number(result.insertId);
  },

  async insertItems(tx: Tx, rows: Array<{
    orderId: number; productId: number; quantity: string;
    unitPrice: string; costPrice: string; subtotal: string;
  }>) {
    if (rows.length === 0) return;
    await tx.insert(orderItems).values(rows);
  },

  async items(tx: Tx, orderId: number) {
    return tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  },

  /**
   * The order as the lifecycle operations need it. `conditions` differ per
   * operation (own-orders-only, not-yet-deleted, …), so they are passed in.
   */
  async snapshotForUpdate(tx: Tx, tenantId: number, orderId: number, opts: {
    ownAgentId?: number;
    excludeDeleted?: boolean;
    extraFields?: boolean;
  } = {}) {
    const conditions = [eq(orders.id, orderId), eq(orders.tenantId, tenantId)];
    if (opts.ownAgentId !== undefined) conditions.push(eq(orders.agentId, opts.ownAgentId));
    if (opts.excludeDeleted) conditions.push(isNull(orders.deletedAt));

    const [order] = await tx.select({
      id: orders.id, status: orders.status, shopId: orders.shopId,
      total: orders.total, subtotal: orders.subtotal, paymentMethod: orders.paymentMethod,
      agentId: orders.agentId, deliveryStatus: orders.deliveryStatus, deletedAt: orders.deletedAt,
    }).from(orders).where(and(...conditions)).limit(1);
    return order ?? null;
  },

  async setStatus(tx: Tx, tenantId: number, orderId: number, status: OrderStatus, onlyFrom?: OrderStatus) {
    const conditions = [eq(orders.id, orderId), eq(orders.tenantId, tenantId)];
    if (onlyFrom) conditions.push(eq(orders.status, onlyFrom));
    await tx.update(orders).set({ status }).where(and(...conditions));
  },

  async setFields(tx: Tx, tenantId: number, orderId: number, updates: Record<string, unknown>) {
    if (Object.keys(updates).length === 0) return;
    await tx.update(orders).set(updates).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
  },

  async softDelete(tx: Tx, tenantId: number, orderId: number) {
    await tx.update(orders).set({ deletedAt: new Date() }).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
  },

  async undelete(tx: Tx, tenantId: number, orderId: number) {
    await tx.update(orders).set({ deletedAt: null }).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
  },

  /** Deleted-or-not snapshot, needed by restore() before it opens its transaction. */
  async findForRestore(db: Db, tenantId: number, orderId: number) {
    const [order] = await db.select({
      id: orders.id, deletedAt: orders.deletedAt, status: orders.status,
      shopId: orders.shopId, total: orders.total, paymentMethod: orders.paymentMethod,
    }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1);
    return order ?? null;
  },
};
