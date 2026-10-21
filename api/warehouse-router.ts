import { z } from "zod";
import { createRouter, operatorQuery, can } from "./middleware";
import { warehouseStock, products, stockMovements, settings, orderItems, orders, warehouses } from "@db/schema";
import { eq, like, and, sql, desc } from "drizzle-orm";
import { movementReferenceNumber } from "./lib/movement-reference";
import { StockService } from "./services/stock";
import { reorderPlan } from "./services/reorder";
import { dayStartUtc } from "./lib/date-range";
import { firstRow } from "./lib/db-rows";
import { businessDaysAgo } from "@contracts/business-time";

export const warehouseRouter = createRouter({
  list: operatorQuery
    .input(z.object({
      page:        z.number().default(1),
      // Capped at 500 for a paginated screen, but an export has to be able to
      // ask for everything: a report that silently stops at row 500 says
      // nothing on the sheet about the rows it dropped. The default is
      // unchanged, so only a caller that deliberately asks gets more.
      pageSize:    z.number().min(1).max(10000).default(25),
      search:      z.string().optional(),
      // Category is a varchar on the product, not a foreign key.
      category:    z.string().max(100).optional(),
      warehouseId: z.number().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db       = ctx.db;
      const tenantId = ctx.tenant.id;
      const page     = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 25;
      const offset   = (page - 1) * pageSize;

      // If no warehouseId specified, use default warehouse
      let targetWarehouseId = input?.warehouseId;
      if (!targetWarehouseId) {
        const [defaultWh] = await db.select({ id: warehouses.id })
          .from(warehouses)
          .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)))
          .limit(1);
        targetWarehouseId = defaultWh?.id;
      }

      const stockCond = [eq(warehouseStock.tenantId, tenantId)];
      if (targetWarehouseId) stockCond.push(eq(warehouseStock.warehouseId, targetWarehouseId));
      if (input?.search) stockCond.push(like(products.name, `%${input.search}%`));
      if (input?.category) stockCond.push(eq(products.category, input.category));
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
          .leftJoin(products, and(eq(warehouseStock.productId, products.id), eq(products.tenantId, ctx.tenant.id)))
          .where(where).limit(pageSize).offset(offset).orderBy(products.name),
        db.select({ count: sql<number>`count(*)` })
          .from(warehouseStock).leftJoin(products, and(eq(warehouseStock.productId, products.id), eq(products.tenantId, ctx.tenant.id))).where(where),
        db.select({
          totalSKUs:     sql<number>`count(*)`,
          totalWeight:   sql<string>`COALESCE(SUM(CAST(${warehouseStock.currentStock} AS DECIMAL(15,3)) * CAST(COALESCE(${products.unitWeight}, '0') AS DECIMAL(15,3))), 0)`,
          lowStockCount: sql<number>`count(CASE WHEN ${products.reorderPoint} > 0 AND ${warehouseStock.available} <= ${products.reorderPoint} THEN 1 END)`,
        }).from(warehouseStock).leftJoin(products, and(eq(warehouseStock.productId, products.id), eq(products.tenantId, ctx.tenant.id))).where(where),
      ]);

      return { data, total: Number(countResult[0]?.count ?? 0), page, pageSize, summary: summary[0] };
    }),

  movements: operatorQuery
    .input(z.object({ productId: z.number() }))
    .query(async ({ input, ctx }) => {
      return ctx.db.select({
        id: stockMovements.id, type: stockMovements.type, quantity: stockMovements.quantity,
        referenceType: stockMovements.referenceType, referenceId: stockMovements.referenceId,
        referenceNumber: movementReferenceNumber,
        notes: stockMovements.notes, createdAt: stockMovements.createdAt, productName: products.name,
        // Единица нужна экрану: без неё история движений подписывала любое
        // количество килограммами — и штуки, и ящики, и литры. Соединение с
        // товаром здесь уже есть, поле стоит ничего.
        unit: products.unit,
      })
        .from(stockMovements)
        .leftJoin(products, and(eq(stockMovements.productId, products.id), eq(products.tenantId, ctx.tenant.id)))
        .where(and(eq(stockMovements.productId, input.productId), eq(stockMovements.tenantId, ctx.tenant.id)))
        .orderBy(desc(stockMovements.createdAt)).limit(50);
    }),

  // Создание склада — используется в Onboarding
  create: operatorQuery
    .input(z.object({
      name:    z.string().min(1),
      address: z.string().optional(),
      city:    z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // warehouses — просто настройка tenant, склад уже создаётся при регистрации.
      // Сохраняем название в settings.companyName если ещё не задано.
      const db       = ctx.db;
      const tenantId = ctx.tenant.id;
      const [existing] = await db.select().from(settings).where(eq(settings.tenantId, tenantId)).limit(1);
      if (existing) {
        if (!existing.companyName || existing.companyName === "Warehouse Pro") {
          await db.update(settings).set({ companyName: input.name, companyAddress: input.address ?? null }).where(eq(settings.tenantId, tenantId));
        }
      } else {
        await db.insert(settings).values({ tenantId, companyName: input.name, companyAddress: input.address ?? null });
      }
      return { success: true };
    }),

  adjustStock: operatorQuery.use(can("warehouse.adjust"))
    .input(z.object({
      productId:   z.number().int().positive(),
      warehouseId: z.number().int().positive().optional(),
      quantity:    z.string().refine(v => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0;
      }, "Количество должно быть положительным числом"),
      type:      z.enum(["in", "out", "adjustment"]),
      notes:     z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { getClientIp } = await import("./lib/rate-limit");
      const { needsStockApproval } = await import("./lib/role-permissions");
      // Оператор без права проводить (warehouse.apply) правку не теряет: она
      // уходит директору заявкой. Ответ говорит об этом pendingApproval —
      // старый экран его не читает и просто покажет «готово».
      const mode = await needsStockApproval(ctx.db, ctx.tenant.id, ctx.user.role) ? "request" : "apply";
      return StockService.adjust(ctx.db, ctx.tenant.id, input.productId, Number(input.quantity), input.type, input.notes, {
        id: ctx.user.id,
        name: ctx.user.name,
        ip: getClientIp(ctx.req) ?? undefined,
      }, input.warehouseId, mode);
    }),

  // ── Stock Valuation ─────────────────────────────────────────────────────────
  // warehouseId — по одному складу; без него — по всем. Экран передаёт склад
  // явно, когда складов больше одного: сумма «по всем» без подписи — вторая
  // правда рядом с каталогом, который считает только основной.
  valuation: operatorQuery
    .input(z.object({ warehouseId: z.number().int().positive().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db = ctx.db;
      const tenantId = ctx.tenant.id;

      const [summary] = await db.select({
        totalCostValue:  sql<string>`COALESCE(SUM(${warehouseStock.currentStock} * COALESCE(${products.costPrice}, 0)), 0)`,
        totalRetailValue: sql<string>`COALESCE(SUM(${warehouseStock.currentStock} * COALESCE(${products.unitPrice}, 0)), 0)`,
        totalUnits:      sql<string>`COALESCE(SUM(${warehouseStock.currentStock}), 0)`,
      })
        .from(warehouseStock)
        .leftJoin(products, and(eq(warehouseStock.productId, products.id), eq(products.tenantId, ctx.tenant.id)))
        .where(and(eq(warehouseStock.tenantId, tenantId), ...(input?.warehouseId ? [eq(warehouseStock.warehouseId, input.warehouseId)] : [])));

      /*
        «В пути» и недостача при перемещении — рядом с оценкой склада.

        Товар документа «в пути» со склада-отправителя уже ушёл, а на
        получатель ещё не пришёл: без этой строки он выпадал из оценки обоих.
        По складу — едущее НА него (он его ждёт); по всем — всё едущее.
        Цена — партии, с которой товар ушёл, иначе карточки.

        Недостача — что не доехало при приёмке за последние 30 рабочих дней
        по Ташкенту: деньги, которые склад потерял в дороге и которых в
        остатке уже нет нигде.
      */
      const whDoc = input?.warehouseId ? sql`AND d.to_warehouse_id = ${input.warehouseId}` : sql``;
      const since = dayStartUtc(businessDaysAgo(30));
      const transitRows = await db.execute(sql`
        SELECT
          COALESCE(SUM(CASE WHEN d.status = 'in_transit' THEN st.quantity END), 0) AS inTransitUnits,
          COALESCE(SUM(CASE WHEN d.status = 'in_transit' THEN st.quantity * COALESCE(st.batch_cost, p.cost_price, 0) END), 0) AS inTransitCost,
          COALESCE(SUM(CASE WHEN d.status = 'received_short' AND d.received_at >= ${since} THEN st.quantity - COALESCE(st.received_quantity, 0) END), 0) AS shortUnits
        FROM stock_transfer_docs d
        INNER JOIN stock_transfers st ON st.doc_id = d.id AND st.tenant_id = d.tenant_id
        LEFT JOIN products p ON p.id = st.product_id AND p.tenant_id = d.tenant_id
        WHERE d.tenant_id = ${tenantId} AND d.status IN ('in_transit', 'received_short') ${whDoc}
      `);
      const shortRows = await db.execute(sql`
        SELECT COALESCE(SUM(d.shortage_cost), 0) AS shortCost FROM stock_transfer_docs d
        WHERE d.tenant_id = ${tenantId} AND d.status = 'received_short' AND d.received_at >= ${since} ${whDoc}
      `);
      const t = firstRow<{ inTransitUnits: string; inTransitCost: string; shortUnits: string }>(transitRows);
      const sc = firstRow<{ shortCost: string }>(shortRows);
      const round2 = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

      return {
        ...(summary ?? { totalCostValue: "0", totalRetailValue: "0", totalUnits: "0" }),
        inTransitUnits: round2(t?.inTransitUnits),
        inTransitCost: round2(t?.inTransitCost),
        transitShortageUnits: round2(t?.shortUnits),
        transitShortageCost: round2(sc?.shortCost),
      };
    }),

  // ── Dead Stock — products with stock but no orders in last N days ──────────
  deadStock: operatorQuery
    .input(z.object({ days: z.number().default(30), warehouseId: z.number().int().positive().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db = ctx.db;
      const tenantId = ctx.tenant.id;
      const days = input?.days ?? 30;
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();

      return db.select({
        productId: products.id,
        productName: products.name,
        productCode: products.code,
        currentStock: warehouseStock.currentStock,
        unit: products.unit,
        unitPrice: products.unitPrice,
        costPrice: products.costPrice,
        category: products.category,
        value: sql<string>`COALESCE(${warehouseStock.currentStock} * COALESCE(${products.costPrice}, 0), 0)`,
        lastOrderDate: sql<Date | null>`MAX(CASE WHEN ${orders.status} = 'delivered' THEN ${orders.createdAt} END)`,
        daysSinceOrder: sql<number>`CASE WHEN MAX(CASE WHEN ${orders.status} = 'delivered' THEN ${orders.createdAt} END) IS NULL THEN 99999 ELSE DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 5 HOUR), DATE(MAX(CASE WHEN ${orders.status} = 'delivered' THEN ${orders.createdAt} END) + INTERVAL 5 HOUR)) END`,
      })
        .from(warehouseStock)
        .leftJoin(products, and(eq(warehouseStock.productId, products.id), eq(products.tenantId, ctx.tenant.id)))
        .leftJoin(orderItems, eq(orderItems.productId, products.id))
        .leftJoin(orders, eq(orderItems.orderId, orders.id))
        .where(and(
          eq(warehouseStock.tenantId, tenantId),
          ...(input?.warehouseId ? [eq(warehouseStock.warehouseId, input.warehouseId)] : []),
          sql`${warehouseStock.currentStock} > 0`,
          sql`(${orders.tenantId} IS NULL OR ${orders.tenantId} = ${tenantId})`,
        ))
        .groupBy(products.id, products.name, products.code, products.unit, products.unitPrice, products.costPrice, products.category, warehouseStock.currentStock)
        .having(sql`MAX(CASE WHEN ${orders.status} = 'delivered' AND ${orders.createdAt} >= ${cutoff} THEN 1 END) IS NULL`)
        .orderBy(desc(sql`COALESCE(${warehouseStock.currentStock} * COALESCE(${products.costPrice}, 0), 0)`));
    }),

  // ── Auto-Replenishment Suggestions ──────────────────────────────────────────
  /*
    Что и сколько дозаказать на складе (services/reorder.ts → reorderPlan).

    Склад не выбран — основной, а не все разом: один товар приходил строкой
    на каждый склад. Сколько — от свободного остатка, а не физического, и за
    вычетом того, что уже едет (открытые заказы поставщикам и приходы без
    заказа). Ответ — тот же плоский список с прежними полями; новые поля
    (свободно, максимум, в пути, поставщик) только добавлены.
  */
  reorderSuggestions: operatorQuery
    .input(z.object({ warehouseId: z.number().int().positive().optional() }).optional())
    .query(({ input, ctx }) => reorderPlan(ctx.db, ctx.tenant.id, input?.warehouseId)),

  /** Create missing warehouse_stock rows for products that don't have one */
  backfillStock: operatorQuery.use(can("warehouse.adjust"))
    .mutation(async ({ ctx }) => {
      const db       = ctx.db;
      const tenantId = ctx.tenant.id;

      // Find products without a warehouseStock row
      const missing = await db.execute(sql`
        SELECT p.id
        FROM products p
        LEFT JOIN warehouse_stock ws ON ws.product_id = p.id AND ws.tenant_id = ${tenantId}
        WHERE p.tenant_id = ${tenantId}
          AND ws.id IS NULL
      `);

      // db.execute resolves to mysql2's [rows, fields] — itself an array, so a
      // plain Array.isArray() check on it does not tell the two apart.
      const [rows] = missing as unknown as [Array<{ id: number }>, unknown];
      if (rows.length === 0) return { created: 0 };

      // Get default warehouse for tenant
      const [defaultWarehouse] = await db.select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)))
        .limit(1);

      if (!defaultWarehouse) return { created: 0 };

      await db.insert(warehouseStock).values(
        rows.map(r => ({
          tenantId,
          warehouseId: defaultWarehouse.id,
          productId: Number(r.id),
          currentStock: "0.00",
          reserved: "0.00",
          available: "0.00",
        }))
      );

      return { created: rows.length };
    }),

  // Удалить все товары со склада (CEO only — destructive operation)
});
