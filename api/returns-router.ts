import { z } from "zod";
import { createRouter, fieldSalesQuery, operatorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { returns, returnItems, orders, shops, users, products, warehouseStock } from "@db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { cache, CacheKeys } from "./lib/cache";

export const returnsRouter = createRouter({
  // List returns
  list: fieldSalesQuery
    .input(z.object({
      status: z.enum(["pending", "approved", "rejected", "completed"]).optional(),
      shopId: z.number().optional(),
      orderId: z.number().optional(),
      page: z.number().default(1),
      pageSize: z.number().default(25),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const f = input ?? {};
      const conditions = [eq(returns.tenantId, ctx.tenant.id)];
      if (f.status) conditions.push(eq(returns.status, f.status));
      if (f.shopId) conditions.push(eq(returns.shopId, f.shopId));
      if (f.orderId) conditions.push(eq(returns.orderId, f.orderId));

      const [data, countResult] = await Promise.all([
        db.select({
          id: returns.id,
          returnNumber: returns.returnNumber,
          orderId: returns.orderId,
          shopId: returns.shopId,
          shopName: shops.name,
          status: returns.status,
          reason: returns.reason,
          notes: returns.notes,
          totalAmount: returns.totalAmount,
          createdAt: returns.createdAt,
        }).from(returns)
          .leftJoin(shops, eq(returns.shopId, shops.id))
          .where(and(...conditions))
          .orderBy(desc(returns.createdAt))
          .limit(f.pageSize ?? 25)
          .offset(((f.page ?? 1) - 1) * (f.pageSize ?? 25)),
        db.select({ count: sql<number>`count(*)` }).from(returns).where(and(...conditions)),
      ]);

      return { data, total: Number(countResult[0]?.count ?? 0) };
    }),

  // Get return by ID with items
  getById: fieldSalesQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const [ret] = await db.select({
        id: returns.id,
        returnNumber: returns.returnNumber,
        orderId: returns.orderId,
        shopId: returns.shopId,
        shopName: shops.name,
        agentId: returns.agentId,
        agentName: users.name,
        status: returns.status,
        reason: returns.reason,
        notes: returns.notes,
        totalAmount: returns.totalAmount,
        createdAt: returns.createdAt,
      }).from(returns)
        .leftJoin(shops, eq(returns.shopId, shops.id))
        .leftJoin(users, eq(returns.agentId, users.id))
        .where(and(eq(returns.id, input.id), eq(returns.tenantId, ctx.tenant.id)))
        .limit(1);

      if (!ret) return null;

      const items = await db.select({
        id: returnItems.id,
        productId: returnItems.productId,
        productName: products.name,
        productCode: products.code,
        quantity: returnItems.quantity,
        unitPrice: returnItems.unitPrice,
        subtotal: returnItems.subtotal,
        reason: returnItems.reason,
        condition: returnItems.condition,
      }).from(returnItems)
        .leftJoin(products, eq(returnItems.productId, products.id))
        .where(eq(returnItems.returnId, input.id));

      return { ...ret, items };
    }),

  // Create return
  create: fieldSalesQuery
    .input(z.object({
      orderId: z.number().optional(),
      shopId: z.number(),
      reason: z.enum(["defect", "wrong_item", "expired", "damaged", "other"]),
      notes: z.string().optional(),
      items: z.array(z.object({
        productId: z.number(),
        quantity: z.number(),
        unitPrice: z.number(),
        reason: z.string().optional(),
        condition: z.string().optional(),
      })).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const raw = crypto.randomUUID().replace(/-/g, "");
      const returnNumber = `RET-${raw.slice(0, 12).toUpperCase()}`;

      const totalAmount = input.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

      // Use transaction for atomicity
      const returnId = await db.transaction(async (tx) => {
        const [result] = await tx.insert(returns).values({
          tenantId: ctx.tenant.id,
          orderId: input.orderId ?? null,
          shopId: input.shopId,
          agentId: ctx.user.id,
          returnNumber,
          reason: input.reason,
          notes: input.notes,
          totalAmount: totalAmount.toFixed(2),
          createdBy: ctx.user.id,
        });

        const id = Number(result.insertId);

        // Insert return items
        await tx.insert(returnItems).values(input.items.map(item => ({
          returnId: id,
          productId: item.productId,
          quantity: item.quantity.toFixed(2),
          unitPrice: item.unitPrice.toFixed(2),
          subtotal: (item.unitPrice * item.quantity).toFixed(2),
          reason: item.reason,
          condition: item.condition,
        })));

        // Update stock (return items back to inventory) — batch update
        if (input.items.length > 0) {
          const productIds = input.items.map(i => i.productId);
          await tx.execute(sql`
            UPDATE warehouse_stock
            SET
              current_stock = current_stock + CASE ${sql.join(input.items.map(i =>
                sql`WHEN product_id = ${i.productId} THEN ${i.quantity}`
              ), sql`\n`)} ELSE 0 END,
              available = available + CASE ${sql.join(input.items.map(i =>
                sql`WHEN product_id = ${i.productId} THEN ${i.quantity}`
              ), sql`\n`)} ELSE 0 END
            WHERE product_id IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})
              AND tenant_id = ${ctx.tenant.id}
          `);
        }

        return id;
      });

      cache.invalidate(CacheKeys.returns(ctx.tenant.id));
      return { id: returnId, returnNumber };
    }),

  // Update return status (operator only)
  updateStatus: operatorQuery
    .input(z.object({
      id: z.number(),
      status: z.enum(["pending", "approved", "rejected", "completed"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      await db.update(returns)
        .set({ status: input.status })
        .where(and(eq(returns.id, input.id), eq(returns.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  // Returns summary by reason
  summary: operatorQuery.query(async ({ ctx }) => {
    const db = getDb();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];

    return db.select({
      reason: returns.reason,
      count: sql<number>`COUNT(*)`,
      totalAmount: sql<string>`COALESCE(SUM(${returns.totalAmount}), 0)`,
    }).from(returns)
      .where(and(
        eq(returns.tenantId, ctx.tenant.id),
        sql`${returns.createdAt} >= ${monthStart}`,
      ))
      .groupBy(returns.reason);
  }),
});
