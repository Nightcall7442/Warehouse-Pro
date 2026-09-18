import { z } from "zod";
import { createRouter, adminQuery, authedQuery, operatorQuery, can } from "./middleware";
import { getDb } from "./queries/connection";
import { warehouses, warehouseStock, stockTransfers, products, orders } from "@db/schema";
import { eq, and, sql, desc, isNull, inArray, gt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { OPEN_ORDER_STATUSES } from "./lib/order-status";
import { applyStockEffect, receiveStock } from "./services/stock-ledger";
import { transferStock } from "./services/stock-transfer";
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

        /*
          Пока есть открытые заказы (те, что держат резерв — holdsStock) или
          резерв на любом складе, умолчание не меняется.
          Заказы помнят свой склад (orders.warehouseId), но старые — нет, а
          каталог и новые заказы тут же переключатся на другой склад:
          агент увидит остаток нового, а резерв старых заказов останется на
          прежнем. Сначала довезти или отменить открытое — потом менять.
        */
        const [open] = await tx.select({ n: sql<number>`count(*)` }).from(orders)
          .where(and(eq(orders.tenantId, ctx.tenant.id), isNull(orders.deletedAt), inArray(orders.status, OPEN_ORDER_STATUSES)));
        const [held] = await tx.select({ n: sql<number>`count(*)` }).from(warehouseStock)
          .where(and(eq(warehouseStock.tenantId, ctx.tenant.id), gt(warehouseStock.reserved, "0")));
        if (Number(open?.n ?? 0) > 0 || Number(held?.n ?? 0) > 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Сменить склад по умолчанию нельзя: открытых заказов ${Number(open?.n ?? 0)}, позиций с резервом ${Number(held?.n ?? 0)}. Довезите или отмените открытые заказы и повторите.`,
          });
        }

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
    .mutation(({ input, ctx }) => transferStock(getDb(), ctx.tenant.id, { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role }, input)),

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