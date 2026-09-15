import { z } from "zod";
import { createRouter, adminQuery, authedQuery, operatorQuery, can } from "./middleware";
import { getDb } from "./queries/connection";
import { warehouses, warehouseStock, stockTransfers, products } from "@db/schema";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { applyStockEffect, receiveStock } from "./services/stock-ledger";
import { recordAudit, auditActor } from "./services/audit-log";

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
      // If this is the first warehouse for the tenant, make it the default
      const [existing] = await db.select({ id: warehouses.id }).from(warehouses)
        .where(eq(warehouses.tenantId, ctx.tenant.id)).limit(1);
      const isDefault = !existing;

      const [result] = await db.insert(warehouses).values({
        tenantId: ctx.tenant.id,
        name: input.name,
        address: input.address,
        city: input.city,
        isDefault,
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
        // Lock target row inside transaction to prevent race condition
        const [target] = await tx.select({ id: warehouses.id })
          .from(warehouses)
          .where(and(eq(warehouses.id, input.id), eq(warehouses.tenantId, ctx.tenant.id)))
          .for("update")
          .limit(1);
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Склад не найден" });

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
      const warehouseCondition = input?.warehouseId ? sql`AND ws.warehouse_id = ${input.warehouseId}` : sql``;

      const dataQuery = sql`
        SELECT COALESCE(ws.id, 0) AS id, p.id AS productId, ws.warehouse_id AS warehouseId,
               COALESCE(ws.current_stock, '0') AS currentStock,
               COALESCE(ws.reserved, '0') AS reserved,
               COALESCE(ws.available, '0') AS available,
               p.name AS productName, p.code AS productCode,
               p.category, p.unit, p.unit_weight AS unitWeight,
               p.unit_price AS unitPrice, p.cost_price AS costPrice,
               p.reorder_point AS reorderPoint
        FROM products p
        LEFT JOIN warehouse_stock ws ON ws.product_id = p.id AND ws.tenant_id = p.tenant_id ${warehouseCondition}
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
               COALESCE(SUM(CAST(COALESCE(ws.current_stock, '0') AS DECIMAL(15,3)) * CAST(COALESCE(p.unit_weight, '0') AS DECIMAL(15,3))), 0) AS totalWeight,
               COUNT(CASE WHEN CAST(p.reorder_point AS DECIMAL(15,3)) > 0 AND CAST(COALESCE(ws.available, '0') AS DECIMAL(15,3)) <= CAST(p.reorder_point AS DECIMAL(15,3)) THEN 1 END) AS lowStockCount
        FROM products p
        LEFT JOIN warehouse_stock ws ON ws.product_id = p.id AND ws.tenant_id = p.tenant_id ${warehouseCondition}
        WHERE p.tenant_id = ${tenantId} AND p.status = 'active' ${searchCondition}
      `;

      const [dataResult, countResult, summaryResult] = await Promise.all([
        db.execute(dataQuery),
        db.execute(countQuery),
        db.execute(summaryQuery),
      ]);

      const rows = Array.isArray((dataResult as unknown[][])[0]) ? (dataResult as unknown[][])[0] : [];

      // The buying price leaves only for the two roles that need it. This
      // procedure runs under authedQuery, so without this an agent, a courier
      // or a merchandiser could read the company's cost on every product — the
      // same leak that was closed in product-router, in a query that shape of
      // fix never reached because it is raw SQL in a different file.
      const canSeeCost = ctx.user.role === "ceo" || ctx.user.role === "operator";
      const data = canSeeCost
        ? rows
        // Blanked rather than deleted: the web stock table reads the field, and
        // an absent key would read as "free" rather than "not yours to see".
        : rows.map(r => ({ ...(r as unknown as Record<string, unknown>), costPrice: undefined }));
      const countRows = (countResult as unknown[][])[0] as Array<{ cnt: number | string }> | undefined;
      const total = Number(countRows?.[0]?.cnt ?? 0);
      const summary = Array.isArray((summaryResult as unknown[][])[0]) ? (summaryResult as unknown[][])[0] : [{}];

      return { data, total, page, pageSize, summary: summary[0] ?? {} };
    }),

  /**
   * Перемещение между складами — документ в один шаг.
   *
   * Было: по одному товару, «создать» → «принять», между шагами товар нигде,
   * и только директор. Владелец (16.09.2026): много позиций, товар сразу на
   * складе-получателе, делает и оператор с правом «warehouse.adjust» — тем
   * же, что даёт ручную правку остатков: перемещение — та же рука на остатке.
   *
   * Строки stock_transfers остаются по одной на позицию — это история; статус
   * ставится «completed» сразу. Прежний двухшаговый путь (completeTransfer)
   * оставлен только для строк, застрявших «в пути» до этой правки.
   */
  createTransfer: operatorQuery.use(can("warehouse.adjust"))
    .input(z.object({
      fromWarehouseId: z.number(),
      toWarehouseId:   z.number(),
      items: z.array(z.object({
        productId: z.number(),
        quantity:  z.number().positive(),
      })).min(1).max(200),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      if (input.fromWarehouseId === input.toWarehouseId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Нельзя перемещать товар на тот же склад" });
      }
      // Одна позиция — одна строка: повтор товара в документе сложил бы его дважды.
      const seen = new Set<number>();
      for (const it of input.items) {
        if (seen.has(it.productId)) throw new TRPCError({ code: "BAD_REQUEST", message: "Товар повторяется в документе" });
        seen.add(it.productId);
      }

      // Оба склада — свои. Чужой склад-получатель раньше не проверялся вовсе,
      // и строка остатка заводилась с номером чужого склада.
      const ownedWarehouses = await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses)
        .where(and(eq(warehouses.tenantId, ctx.tenant.id), inArray(warehouses.id, [input.fromWarehouseId, input.toWarehouseId])));
      const byId = new Map(ownedWarehouses.map(w => [w.id, w.name]));
      if (!byId.has(input.fromWarehouseId) || !byId.has(input.toWarehouseId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Склад не найден" });
      }

      return db.transaction(async (tx) => {
        const ids: number[] = [];
        let total = 0;
        for (const it of input.items) {
          // Строка источника — под замком: два одновременных документа не
          // спишут одно и то же дважды.
          const [sourceStock] = await tx.select()
            .from(warehouseStock)
            .where(and(
              eq(warehouseStock.tenantId, ctx.tenant.id),
              eq(warehouseStock.warehouseId, input.fromWarehouseId),
              eq(warehouseStock.productId, it.productId),
            ))
            .for("update")
            .limit(1);
          if (!sourceStock || Number(sourceStock.available) < it.quantity) {
            const [p] = await tx.select({ name: products.name }).from(products)
              .where(and(eq(products.id, it.productId), eq(products.tenantId, ctx.tenant.id))).limit(1);
            throw new TRPCError({ code: "BAD_REQUEST", message: `Недостаточно товара на складе отправителе: ${p?.name ?? it.productId}` });
          }

          const [result] = await tx.insert(stockTransfers).values({
            tenantId: ctx.tenant.id,
            fromWarehouseId: input.fromWarehouseId,
            toWarehouseId: input.toWarehouseId,
            productId: it.productId,
            quantity: String(it.quantity),
            status: "completed",
            completedAt: new Date(),
            notes: input.notes,
            createdBy: ctx.user.id,
          });
          const transferId = Number(result.insertId);
          ids.push(transferId);
          total += it.quantity;

          /*
            Одно физическое перемещение — две записи через дверь: ушло с одного
            склада (с партий по FEFO), пришло на другой.
            ponytail: партия на приёмной стороне не переносится — товар ложится
            без срока; переносить партии, когда склады начнут отчитываться по
            срокам порознь.
          */
          await applyStockEffect(tx, {
            tenantId: ctx.tenant.id, warehouseId: input.fromWarehouseId,
            items: [{ productId: it.productId, quantity: String(it.quantity) }],
            shift: { onHand: -1, held: 0 }, reason: "transfer_out", referenceId: transferId,
            notes: `Перемещение на склад «${byId.get(input.toWarehouseId)}»`,
          });
          await receiveStock(tx, {
            tenantId: ctx.tenant.id, warehouseId: input.toWarehouseId,
            productId: it.productId, quantity: String(it.quantity),
            reason: "transfer_in", referenceId: transferId,
            notes: `Перемещение со склада «${byId.get(input.fromWarehouseId)}»`,
          });
        }

        await recordAudit(tx as unknown as typeof db, {
          ...auditActor(ctx), action: "stock.transfer_completed", targetType: "stock_transfer", targetId: ids[0],
          meta: { fromWarehouse: byId.get(input.fromWarehouseId), toWarehouse: byId.get(input.toWarehouseId), items: input.items.length, quantity: total, notes: input.notes },
        }, { strict: true });

        return { ids, count: ids.length };
      });
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

        /*
          Одно физическое перемещение — две записи через дверь: ушло с одного
          склада (с партий по FEFO), пришло на другой. Раньше оба склада
          правились своим SQL, партии источника не трогались, а строка на
          складе-получателе заводилась третьим путём.
          ponytail: партия на приёмной стороне не переносится — товар ложится
          без срока; переносить партии, когда склады начнут отчитываться по
          срокам порознь.
        */
        await applyStockEffect(tx, {
          tenantId: ctx.tenant.id, warehouseId: transfer.fromWarehouseId,
          items: [{ productId: transfer.productId, quantity: transfer.quantity }],
          shift: { onHand: -1, held: 0 }, reason: "transfer_out", referenceId: input.transferId,
          notes: "Перемещение на другой склад",
        });
        await receiveStock(tx, {
          tenantId: ctx.tenant.id, warehouseId: transfer.toWarehouseId,
          productId: transfer.productId, quantity: transfer.quantity,
          reason: "transfer_in", referenceId: input.transferId,
          notes: "Перемещение с другого склада",
        });

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
        await recordAudit(tx as unknown as typeof db, {
          ...auditActor(ctx), action: "stock.transfer_completed", targetType: "stock_transfer", targetId: input.transferId,
          meta: { fromWarehouseId: transfer.fromWarehouseId, toWarehouseId: transfer.toWarehouseId, productId: transfer.productId, quantity: transfer.quantity },
        }, { strict: true });
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
        .innerJoin(products, and(eq(stockTransfers.productId, products.id), eq(products.tenantId, ctx.tenant.id)))
        .where(and(...conditions))
        .orderBy(desc(stockTransfers.createdAt))
        .limit(input?.limit ?? 20);
    }),
});