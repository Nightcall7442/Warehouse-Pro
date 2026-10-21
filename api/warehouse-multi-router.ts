import { z } from "zod";
import { createRouter, adminQuery, authedQuery, operatorQuery, can } from "./middleware";
import { getDb } from "./queries/connection";
import { warehouses, warehouseStock, stockTransfers, stockTransferDocs, products, orders, users } from "@db/schema";
import { eq, and, or, sql, desc, isNull, inArray, gt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { OPEN_ORDER_STATUSES } from "./lib/order-status";
import { recordAudit, auditActor } from "./services/audit-log";
import {
  transferStock, completeLegacyTransfer, listTransferDocs, previewTransfer, receiveTransfer, cancelTransfer,
} from "./services/stock-transfer";

/** Кто провёл — для журнала и строк документа. */
const actorOf = (ctx: { user: { id: number; name: string | null; role: string } }) =>
  ({ id: ctx.user.id, name: ctx.user.name ?? undefined, role: ctx.user.role });

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
      /*
        Точка продаж (ADR 0012): с этого склада, кроме основного, продают —
        заказы агентов, закреплённых за ним (user.update warehouseId).
        Необязательное: старые клиенты его не шлют, и склад остаётся каким был.
      */
      isSalesPoint: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const { id, ...data } = input;
      const [before] = await db.select({ name: warehouses.name, status: warehouses.status, isDefault: warehouses.isDefault, isSalesPoint: warehouses.isSalesPoint })
        .from(warehouses).where(and(eq(warehouses.id, id), eq(warehouses.tenantId, tenantId))).limit(1);
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Склад не найден" });

      /*
        Склад перестаёт продавать — отключением или снятием отметки «точка
        продаж». Пока за ним закреплены сотрудники, их каталог и заказы молча
        переехали бы на основной склад: агент увидел бы чужой остаток, не
        понимая почему. Пока на нём лежит резерв открытых заказов — их
        отгрузка шла бы с отключённого склада. Сначала переназначить людей и
        довезти заказы, потом выключать.
      */
      const stopsSelling = (data.status === "inactive" && before.status !== "inactive")
        || (data.isSalesPoint === false && before.isSalesPoint && !before.isDefault);
      if (stopsSelling) {
        const [assigned] = await db.select({ n: sql<number>`count(*)` }).from(users)
          .where(and(eq(users.tenantId, tenantId), eq(users.warehouseId, id), eq(users.status, "active")));
        const n = Number(assigned?.n ?? 0);
        if (n > 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `С этого склада продают ${n} сотр. — сначала назначьте им другой склад в «Сотрудниках»` });
        }
      }
      if (data.status === "inactive" && before.status !== "inactive") {
        // Основной склад — источник продаж и приходов по умолчанию; без него
        // заказ не оформить вовсе. Сначала назначить основным другой.
        if (before.isDefault) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Основной склад не отключают — сначала сделайте основным другой" });
        }
        const [held] = await db.select({ n: sql<number>`count(*)` }).from(warehouseStock)
          .where(and(eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, id), gt(warehouseStock.reserved, "0")));
        const h = Number(held?.n ?? 0);
        if (h > 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Нельзя отключить склад: позиций под резервом открытых заказов ${h} — довезите или отмените заказы` });
        }
      }
      /*
        Отключённый склад не принимает и не отдаёт перемещений
        (services/stock-transfer.ts). Отключи его, пока к нему или от него
        что-то едет, — документ повиснет: принять его будет некуда, а товар
        уже ушёл с другого склада.
      */
      if (data.status === "inactive") {
        const [row] = await db.select({ n: sql<number>`count(*)` }).from(stockTransferDocs)
          .where(and(
            eq(stockTransferDocs.tenantId, ctx.tenant.id), eq(stockTransferDocs.status, "in_transit"),
            or(eq(stockTransferDocs.fromWarehouseId, id), eq(stockTransferDocs.toWarehouseId, id)),
          ));
        const n = Number(row?.n ?? 0);
        if (n > 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Нельзя отключить склад: перемещений в пути ${n} — примите или отмените их` });
        }
      }
      await db.update(warehouses)
        .set(data)
        .where(and(eq(warehouses.id, id), eq(warehouses.tenantId, ctx.tenant.id)));
      // След — когда склад начинает или перестаёт продавать: с этим спорят о
      // том, откуда ушёл товар.
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (data.isSalesPoint !== undefined && data.isSalesPoint !== Boolean(before.isSalesPoint)) changes.isSalesPoint = { from: Boolean(before.isSalesPoint), to: data.isSalesPoint };
      if (data.status !== undefined && data.status !== before.status) changes.status = { from: before.status, to: data.status };
      if (Object.keys(changes).length > 0) {
        await recordAudit(db, {
          ...auditActor(ctx), action: "warehouse.updated", targetType: "warehouse", targetId: id,
          targetLabel: data.name ?? before.name, meta: { changes },
        });
      }
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

      /*
        inTransitIn — сколько этого товара едет НА склад строки по документам
        «в пути». Со склада-отправителя он уже ушёл, на получатель ещё не
        пришёл; без этой колонки он пропадал бы из списка остатков вовсе.
        Строка остатка получателя заведена до отправки (ensureStockRows),
        поэтому соединение по ws.warehouse_id находит её всегда.
      */
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
               p.reorder_point AS reorderPoint,
               COALESCE(tr.qty, 0) AS inTransitIn
        FROM products p
        LEFT JOIN warehouse_stock ws ON ws.product_id = p.id AND ws.tenant_id = p.tenant_id ${warehouseCondition}
        LEFT JOIN (
          SELECT st.product_id, d.to_warehouse_id, SUM(st.quantity) AS qty
          FROM stock_transfers st
          INNER JOIN stock_transfer_docs d ON d.id = st.doc_id AND d.tenant_id = st.tenant_id
          WHERE st.tenant_id = ${tenantId} AND d.status = 'in_transit'
          GROUP BY st.product_id, d.to_warehouse_id
        ) tr ON tr.product_id = p.id AND tr.to_warehouse_id = ws.warehouse_id
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
   * Перемещение между складами — документ («ПМ-12»).
   *
   * Было: по одному товару, «создать» → «принять», между шагами товар нигде,
   * и только директор. Владелец (16.09.2026): много позиций, товар сразу на
   * складе-получателе, делает и оператор с правом «warehouse.adjust» — тем
   * же, что даёт ручную правку остатков: перемещение — та же рука на остатке.
   *
   * Теперь товар едет своими партиями (номер, срок, себестоимость), партии
   * можно выбрать вручную, а организация может включить второй шаг — «в
   * пути» до приёмки (settings.transferTwoStep). mode и picks необязательны:
   * без них — как раньше, по настройке и по FEFO. Подробно — в
   * services/stock-transfer.ts.
   */
  createTransfer: operatorQuery.use(can("warehouse.adjust"))
    .input(z.object({
      fromWarehouseId: z.number(),
      toWarehouseId:   z.number(),
      items: z.array(z.object({
        productId: z.number(),
        quantity:  z.number().positive(),
        picks: z.array(z.object({
          batchId:  z.number().int().positive().nullable(),
          quantity: z.number().positive(),
        })).max(50).optional(),
      })).min(1).max(200),
      notes: z.string().max(500).optional(),
      mode:  z.enum(["instant", "transit"]).optional(),
    }))
    .mutation(({ input, ctx }) => transferStock(getDb(), ctx.tenant.id, actorOf(ctx), input)),

  /**
   * Провести строку, застрявшую «в пути» до перехода на документы. Строки
   * документов сюда не попадают: у них приёмка receiveTransfer.
   */
  completeTransfer: adminQuery
    .input(z.object({ transferId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await completeLegacyTransfer(getDb(), ctx.tenant.id, actorOf(ctx), input.transferId);
      return { success: true };
    }),

  /** Документы перемещений со строками и партиями — раздел «Перемещения». */
  transferDocs: operatorQuery
    .input(z.object({
      status: z.enum(["in_transit", "received", "received_short", "cancelled", "all"]).default("all"),
      limit:  z.number().int().min(1).max(100).default(30),
    }).optional())
    .query(({ input, ctx }) => listTransferDocs(getDb(), ctx.tenant.id, { status: input?.status ?? "all", limit: input?.limit ?? 30 })),

  /** Что уйдёт по FEFO и какие уценки это заденет — до проведения. */
  previewTransfer: operatorQuery
    .input(z.object({
      fromWarehouseId: z.number(),
      items: z.array(z.object({ productId: z.number(), quantity: z.number().positive() })).max(200),
    }))
    .query(({ input, ctx }) => previewTransfer(getDb(), ctx.tenant.id, input)),

  /** Принять перемещение «в пути» — по строкам, не больше отправленного. */
  receiveTransfer: operatorQuery.use(can("warehouse.adjust"))
    .input(z.object({
      docId: z.number().int().positive(),
      lines: z.array(z.object({
        lineId:           z.number().int().positive(),
        receivedQuantity: z.number().min(0),
      })).max(500).optional(),
    }))
    .mutation(({ input, ctx }) => receiveTransfer(getDb(), ctx.tenant.id, actorOf(ctx), input)),

  /** Отменить перемещение, которое ещё в пути: товар вернётся теми же партиями. */
  cancelTransfer: operatorQuery.use(can("warehouse.adjust"))
    .input(z.object({ docId: z.number().int().positive() }))
    .mutation(({ input, ctx }) => cancelTransfer(getDb(), ctx.tenant.id, actorOf(ctx), input)),

  /**
   * Строки перемещений. legacy — только строки без документа: застрявшие
   * «в пути» до перехода на документы, их ещё можно провести completeTransfer.
   */
  listTransfers: authedQuery
    .input(z.object({
      status: z.enum(["pending", "completed", "all"]).default("all"),
      limit:  z.number().int().min(1).max(100).default(20),
      legacy: z.boolean().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conditions = [eq(stockTransfers.tenantId, ctx.tenant.id)];

      if (input?.status && input.status !== "all") {
        conditions.push(eq(stockTransfers.status, input.status));
      }
      if (input?.legacy) conditions.push(isNull(stockTransfers.docId));

      return db.select({
        id: stockTransfers.id,
        docId: stockTransfers.docId,
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