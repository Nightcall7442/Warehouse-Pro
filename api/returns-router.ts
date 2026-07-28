import { z } from "zod";
import { createRouter, fieldSalesQuery, operatorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { returns, returnItems, orderItems, shops, users, products, orders, warehouseStock } from "@db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { cache, CacheKeys } from "./lib/cache";
import { sanitizeString } from "./lib/sanitize";

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
        .innerJoin(returns, eq(returnItems.returnId, returns.id))
        .leftJoin(products, eq(returnItems.productId, products.id))
        .where(and(eq(returnItems.returnId, input.id), eq(returns.tenantId, ctx.tenant.id)));

      return { ...ret, items };
    }),

  // Create return
  create: fieldSalesQuery
    .input(z.object({
      orderId: z.number().optional(),
      shopId: z.number().int().positive(),
      reason: z.enum(["defect", "wrong_item", "expired", "damaged", "other"]),
      notes: z.string().optional(),
      items: z.array(z.object({
        productId: z.number(),
        quantity: z.number().positive(),
        unitPrice: z.number().positive(),
        reason: z.string().optional(),
        condition: z.string().optional(),
      })).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      // Validate shop belongs to tenant
      const [shop] = await db.select({ id: shops.id }).from(shops)
        .where(and(eq(shops.id, input.shopId), eq(shops.tenantId, ctx.tenant.id))).limit(1);
      if (!shop) throw new Error("Магазин не найден");

      const raw = crypto.randomUUID().replace(/-/g, "");
      const returnNumber = `RET-${raw.slice(0, 12).toUpperCase()}`;

      // Validate items against original order if provided
      if (input.orderId) {
        const [order] = await db.select({ tenantId: orders.tenantId })
          .from(orders).where(eq(orders.id, input.orderId)).limit(1);
        if (!order || order.tenantId !== ctx.tenant.id) {
          throw new Error(`Заказ #${input.orderId} не найден`);
        }

        const orderItemsData = await db.select().from(orderItems)
          .where(and(eq(orderItems.orderId, input.orderId)))
          .leftJoin(products, eq(orderItems.productId, products.id));

        // Sum quantities already returned for this order
        const existingReturns = await db.select({
          productId: returnItems.productId,
          totalReturned: sql<string>`COALESCE(SUM(${returnItems.quantity}), 0)`,
        }).from(returnItems)
          .innerJoin(returns, eq(returnItems.returnId, returns.id))
          .where(and(eq(returns.orderId, input.orderId), eq(returns.tenantId, ctx.tenant.id)))
          .groupBy(returnItems.productId);
        const returnedMap = new Map<number, number>();
        for (const er of existingReturns) returnedMap.set(er.productId, Number(er.totalReturned));

        for (const item of input.items) {
          const original = orderItemsData.find(o => o.order_items.productId === item.productId);
          if (!original) {
            throw new Error(`Товар ID ${item.productId} отсутствует в заказе #${input.orderId}`);
          }
          const alreadyReturned = returnedMap.get(item.productId) ?? 0;
          if (alreadyReturned + Number(item.quantity) > Number(original.order_items.quantity)) {
            throw new Error(`Количество возврата превышает остаток для товара ID ${item.productId} (уже возвращено: ${alreadyReturned}, заказано: ${original.order_items.quantity})`);
          }
        }
        // Use original order unit prices, not client-supplied
        input.items = input.items.map(item => {
          const original = orderItemsData.find(o => o.order_items.productId === item.productId);
          return {
            ...item,
            unitPrice: Number(original!.order_items.unitPrice),
          };
        });
      }

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
          notes: input.notes ? sanitizeString(input.notes) : null,
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
          reason: item.reason ? sanitizeString(item.reason) : null,
          condition: item.condition ? sanitizeString(item.condition) : null,
        })));

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
      const tenantId = ctx.tenant.id;

      // Validate status transitions
      const [ret] = await db.select({ status: returns.status, totalAmount: returns.totalAmount })
        .from(returns).where(and(eq(returns.id, input.id), eq(returns.tenantId, tenantId)))
        .limit(1);
      if (!ret) throw new Error("Возврат не найден");

      const validTransitions: Record<string, string[]> = {
        pending: ["approved", "rejected"],
        approved: ["completed"],
        rejected: [],
        completed: [],
      };
      const allowed = validTransitions[ret.status];
      if (!allowed || !allowed.includes(input.status)) {
        throw new Error(`Невозможно перевести из "${ret.status}" в "${input.status}"`);
      }

      // Only add stock on "completed" — never before approval
      if (input.status === "completed") {
        await db.transaction(async (tx) => {
          // Lock stock rows and add items back to inventory
          const items = await tx.select().from(returnItems).where(eq(returnItems.returnId, input.id));
          for (const item of items) {
            await tx.select({ id: warehouseStock.id }).from(warehouseStock)
              .where(and(eq(warehouseStock.productId, item.productId), eq(warehouseStock.tenantId, tenantId)))
              .for("update");
          }
          if (items.length > 0) {
            await tx.execute(sql`
              UPDATE warehouse_stock
              SET
                current_stock = current_stock + CASE ${sql.join(items.map(i =>
                  sql`WHEN product_id = ${i.productId} THEN ${Number(i.quantity)}`
                ), sql`\n`)} ELSE 0 END,
                available = available + CASE ${sql.join(items.map(i =>
                  sql`WHEN product_id = ${i.productId} THEN ${Number(i.quantity)}`
                ), sql`\n`)} ELSE 0 END
              WHERE product_id IN (${sql.join(items.map(i => sql`${i.productId}`), sql`, `)})
                AND tenant_id = ${tenantId}
            `);
          }

          // Adjust shop debt: reduce it by the return amount
          if (ret.totalAmount && Number(ret.totalAmount) > 0) {
            await tx.execute(sql`
              UPDATE shops
              SET debt = GREATEST(0, CAST(debt AS DECIMAL(12,2)) - ${Number(ret.totalAmount)})
              WHERE id = (SELECT shop_id FROM returns WHERE id = ${input.id} AND tenant_id = ${tenantId})
                AND tenant_id = ${tenantId}
            `);
          }

          await tx.update(returns).set({ status: input.status })
            .where(and(eq(returns.id, input.id), eq(returns.tenantId, tenantId)));
        });
      } else {
        await db.update(returns)
          .set({ status: input.status })
          .where(and(eq(returns.id, input.id), eq(returns.tenantId, tenantId)));
      }

      cache.invalidate(CacheKeys.returns(tenantId));
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
