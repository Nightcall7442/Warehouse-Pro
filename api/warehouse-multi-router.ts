import { z } from "zod";
import { createRouter, adminQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { warehouses, warehouseStock, stockTransfers, products } from "@db/schema";
import { eq, and, like, sql, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const warehouseMultiRouter = createRouter({
  /** List all warehouses for current tenant */
  list: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db.select()
      .from(warehouses)
      .where(eq(warehouses.tenantId, ctx.tenant.id))
      .orderBy(desc(warehouses.isDefault), warehouses.name);
  }),

  /** Create a new warehouse */
  create: adminQuery
    .input(z.object({
      name:    z.string().min(1).max(255),
      address: z.string().max(500).optional(),
      city:    z.string().max(100).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [result] = await db.insert(warehouses).values({
        tenantId: ctx.tenant.id,
        name: input.name,
        address: input.address,
        city: input.city,
      });
      return { id: Number(result.insertId) };
    }),

  /** Update warehouse */
  update: adminQuery
    .input(z.object({
      id:      z.number(),
      name:    z.string().min(1).max(255).optional(),
      address: z.string().max(500).optional(),
      city:    z.string().max(100).optional(),
      status:  z.enum(["active", "inactive"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(warehouses)
        .set(data)
        .where(and(eq(warehouses.id, id), eq(warehouses.tenantId, ctx.tenant.id)));
      return { success: true };
    }),

  /** Set default warehouse */
  setDefault: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      await db.transaction(async (tx) => {
        await tx.update(warehouses).set({ isDefault: false }).where(eq(warehouses.tenantId, ctx.tenant.id));
        await tx.update(warehouses).set({ isDefault: true }).where(and(eq(warehouses.id, input.id), eq(warehouses.tenantId, ctx.tenant.id)));
      });
      return { success: true };
    }),

  /** Get stock for a specific warehouse — same shape as warehouse.list */
  getStock: authedQuery
    .input(z.object({
      warehouseId: z.number().optional(),
      search:      z.string().optional(),
      page:        z.number().default(1),
      pageSize:    z.number().min(1).max(100).default(25),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const page     = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 25;
      const offset   = (page - 1) * pageSize;

      const stockCond = [eq(warehouseStock.tenantId, tenantId)];
      if (input?.warehouseId) stockCond.push(eq(warehouseStock.warehouseId, input.warehouseId));
      if (input?.search) stockCond.push(like(products.name, `%${input.search}%`));
      const where = and(...stockCond);

      const [data, countResult, summary] = await Promise.all([
        db.select({
          id: warehouseStock.id, productId: warehouseStock.productId,
          warehouseId: warehouseStock.warehouseId,
          currentStock: warehouseStock.currentStock, reserved: warehouseStock.reserved,
          available: warehouseStock.available, productName: products.name,
          productCode: products.code, category: products.category,
          unit: products.unit, unitWeight: products.unitWeight,
          unitPrice: products.unitPrice, costPrice: products.costPrice, reorderPoint: products.reorderPoint,
        })
          .from(warehouseStock)
          .leftJoin(products, eq(warehouseStock.productId, products.id))
          .where(where).limit(pageSize).offset(offset).orderBy(products.name),
        db.select({ count: sql<number>`count(*)` })
          .from(warehouseStock).leftJoin(products, eq(warehouseStock.productId, products.id)).where(where),
        db.select({
          totalSKUs:     sql<number>`count(*)`,
          totalWeight:   sql<string>`COALESCE(SUM(CAST(${warehouseStock.currentStock} AS DECIMAL) * CAST(COALESCE(${products.unitWeight}, '0') AS DECIMAL)), 0)`,
          lowStockCount: sql<number>`count(CASE WHEN ${warehouseStock.available} < ${products.reorderPoint} THEN 1 END)`,
        }).from(warehouseStock).leftJoin(products, eq(warehouseStock.productId, products.id)).where(where),
      ]);

      return { data, total: Number(countResult[0]?.count ?? 0), page, pageSize, summary: summary[0] };
    }),

  /** Create a stock transfer between warehouses */
  createTransfer: adminQuery
    .input(z.object({
      fromWarehouseId: z.number(),
      toWarehouseId:   z.number(),
      productId:       z.number(),
      quantity:        z.number().positive(),
      notes:           z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      if (input.fromWarehouseId === input.toWarehouseId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Нельзя перемещать товар на тот же склад" });
      }

      // Check available stock in source warehouse
      const [sourceStock] = await db.select()
        .from(warehouseStock)
        .where(and(
          eq(warehouseStock.tenantId, ctx.tenant.id),
          eq(warehouseStock.warehouseId, input.fromWarehouseId),
          eq(warehouseStock.productId, input.productId),
        ))
        .limit(1);

      if (!sourceStock || Number(sourceStock.available) < input.quantity) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Недостаточно товара на складе отправителе" });
      }

      const [result] = await db.insert(stockTransfers).values({
        tenantId: ctx.tenant.id,
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        productId: input.productId,
        quantity: String(input.quantity),
        notes: input.notes,
        createdBy: ctx.user.id,
      });

      return { id: Number(result.insertId) };
    }),

  /** Complete a stock transfer */
  completeTransfer: adminQuery
    .input(z.object({ transferId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      const [transfer] = await db.select()
        .from(stockTransfers)
        .where(and(
          eq(stockTransfers.id, input.transferId),
          eq(stockTransfers.tenantId, ctx.tenant.id),
          eq(stockTransfers.status, "pending"),
        ))
        .limit(1);

      if (!transfer) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Перемещение не найдено или уже выполнено" });
      }

      await db.transaction(async (tx) => {
        // Lock source stock row to prevent race conditions
        const [lockedStock] = await tx.select()
          .from(warehouseStock)
          .where(and(
            eq(warehouseStock.tenantId, ctx.tenant.id),
            eq(warehouseStock.warehouseId, transfer.fromWarehouseId),
            eq(warehouseStock.productId, transfer.productId),
          ))
          .for("update");

        if (!lockedStock || Number(lockedStock.available) < Number(transfer.quantity)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Недостаточно товара на складе отправителе" });
        }

        // Deduct from source
        await tx.update(warehouseStock)
          .set({
            currentStock: sql`${warehouseStock.currentStock} - ${transfer.quantity}`,
            available: sql`${warehouseStock.available} - ${transfer.quantity}`,
          })
          .where(and(
            eq(warehouseStock.tenantId, ctx.tenant.id),
            eq(warehouseStock.warehouseId, transfer.fromWarehouseId),
            eq(warehouseStock.productId, transfer.productId),
          ));

        // Add to destination (upsert)
        const [existing] = await tx.select()
          .from(warehouseStock)
          .where(and(
            eq(warehouseStock.tenantId, ctx.tenant.id),
            eq(warehouseStock.warehouseId, transfer.toWarehouseId),
            eq(warehouseStock.productId, transfer.productId),
          ))
          .limit(1);

        if (existing) {
          await tx.update(warehouseStock)
            .set({
              currentStock: sql`${warehouseStock.currentStock} + ${transfer.quantity}`,
              available: sql`${warehouseStock.available} + ${transfer.quantity}`,
            })
            .where(eq(warehouseStock.id, existing.id));
        } else {
          await tx.insert(warehouseStock).values({
            tenantId: ctx.tenant.id,
            warehouseId: transfer.toWarehouseId,
            productId: transfer.productId,
            currentStock: transfer.quantity,
            reserved: "0",
            available: transfer.quantity,
          });
        }

        // Mark transfer as completed
        await tx.update(stockTransfers)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(stockTransfers.id, input.transferId));
      });

      return { success: true };
    }),

  /** List transfers */
  listTransfers: authedQuery
    .input(z.object({
      status: z.enum(["pending", "completed", "all"]).default("all"),
      limit:  z.number().int().min(1).max(100).default(20),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conditions = [eq(stockTransfers.tenantId, ctx.tenant.id)];

      if (input?.status && input.status !== "all") {
        conditions.push(eq(stockTransfers.status, input.status));
      }

      return db.select({
        id: stockTransfers.id,
        fromWarehouseId: stockTransfers.fromWarehouseId,
        toWarehouseId: stockTransfers.toWarehouseId,
        productId: stockTransfers.productId,
        quantity: stockTransfers.quantity,
        status: stockTransfers.status,
        notes: stockTransfers.notes,
        createdAt: stockTransfers.createdAt,
        completedAt: stockTransfers.completedAt,
        productName: products.name,
      })
        .from(stockTransfers)
        .innerJoin(products, eq(stockTransfers.productId, products.id))
        .where(and(...conditions))
        .orderBy(desc(stockTransfers.createdAt))
        .limit(input?.limit ?? 20);
    }),
});