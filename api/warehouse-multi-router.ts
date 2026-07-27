import { z } from "zod";
import { createRouter, adminQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { warehouses, warehouseStock, stockTransfers, products } from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
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
      // Verify target warehouse exists before resetting defaults
      const [target] = await db.select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.id, input.id), eq(warehouses.tenantId, ctx.tenant.id)))
        .limit(1);
      if (!target) throw new Error("Склад не найден");

      await db.transaction(async (tx) => {
        await tx.update(warehouses).set({ isDefault: false }).where(eq(warehouses.tenantId, ctx.tenant.id));
        await tx.update(warehouses).set({ isDefault: true }).where(eq(warehouses.id, input.id));
      });
      return { success: true };
    }),

  /** Get stock for a specific warehouse — same shape as warehouse.list */
  getStock: authedQuery
    .input(z.object({
      warehouseId: z.number().optional(),
      search:      z.string().optional(),
      page:        z.number().default(1),
      pageSize:    z.number().min(1).max(10000).default(25),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;
      const page     = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 25;
      const offset   = (page - 1) * pageSize;
      const search   = input?.search ?? "";

      // Use parameterized Drizzle sql templates to prevent SQL injection
      const searchCondition = search ? sql`AND p.name LIKE ${"%" + search + "%"}` : sql``;

      const dataQuery = sql`
        SELECT COALESCE(ws.id, 0) AS id, p.id AS productId,
               COALESCE(ws.current_stock, '0') AS currentStock,
               COALESCE(ws.reserved, '0') AS reserved,
               COALESCE(ws.available, '0') AS available,
               p.name AS productName, p.code AS productCode,
               p.category, p.unit, p.unit_weight AS unitWeight,
               p.unit_price AS unitPrice, p.cost_price AS costPrice,
               p.reorder_point AS reorderPoint
        FROM products p
        LEFT JOIN warehouse_stock ws ON ws.product_id = p.id AND ws.tenant_id = p.tenant_id
        WHERE p.tenant_id = ${tenantId} AND p.status = 'active' ${searchCondition}
        ORDER BY p.name
        LIMIT ${pageSize} OFFSET ${offset}
      `;

      const countQuery = sql`
        SELECT COUNT(*) AS cnt
        FROM products p
        WHERE p.tenant_id = ${tenantId} AND p.status = 'active' ${searchCondition}
      `;

      const summaryQuery = sql`
        SELECT COUNT(*) AS totalSKUs,
               COALESCE(SUM(CAST(COALESCE(ws.current_stock, '0') AS DECIMAL) * CAST(COALESCE(p.unit_weight, '0') AS DECIMAL)), 0) AS totalWeight,
               COUNT(CASE WHEN CAST(COALESCE(ws.available, '0') AS DECIMAL) < CAST(p.reorder_point AS DECIMAL) THEN 1 END) AS lowStockCount
        FROM products p
        LEFT JOIN warehouse_stock ws ON ws.product_id = p.id AND ws.tenant_id = p.tenant_id
        WHERE p.tenant_id = ${tenantId} AND p.status = 'active' ${searchCondition}
      `;

      const [dataResult, countResult, summaryResult] = await Promise.all([
        db.execute(dataQuery),
        db.execute(countQuery),
        db.execute(summaryQuery),
      ]);

      const data = Array.isArray((dataResult as unknown[][])[0]) ? (dataResult as unknown[][])[0] : [];
      const total = Number(((countResult as unknown[][])[0] as Record<string, unknown>)?.cnt ?? 0);
      const summary = Array.isArray((summaryResult as unknown[][])[0]) ? (summaryResult as unknown[][])[0] : [{}];

      return { data, total, page, pageSize, summary: summary[0] ?? {} };
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

      await db.transaction(async (tx) => {
        // Lock transfer row inside transaction — this is the critical fix
        // for race conditions: two concurrent calls queue on this lock,
        // and only the first one sees status === "pending".
        const [transfer] = await tx.select()
          .from(stockTransfers)
          .where(and(
            eq(stockTransfers.id, input.transferId),
            eq(stockTransfers.tenantId, ctx.tenant.id),
          ))
          .for("update")
          .limit(1);

        if (!transfer || transfer.status !== "pending") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Перемещение не найдено или уже выполнено" });
        }

        // Lock source stock row
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
          .for("update")
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

        // Mark transfer as completed — with status check for double-execution safety
        const [updateResult] = await tx.update(stockTransfers)
          .set({ status: "completed", completedAt: new Date() })
          .where(and(
            eq(stockTransfers.id, input.transferId),
            eq(stockTransfers.status, "pending"),
          ));

        if ((updateResult as { affectedRows?: number }).affectedRows !== 1) {
          throw new TRPCError({ code: "CONFLICT", message: "Перемещение уже было выполнено" });
        }
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