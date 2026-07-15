import { z } from "zod";
import { createRouter, operatorQuery } from "./middleware";
import { warehouseStock, products, stockMovements, settings, orderItems, orders, warehouses } from "@db/schema";
import { eq, like, and, sql, desc } from "drizzle-orm";
import { StockService } from "./services/stock";

export const warehouseRouter = createRouter({
  list: operatorQuery
    .input(z.object({
      page:        z.number().default(1),
      pageSize:    z.number().default(25),
      search:      z.string().optional(),
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

  movements: operatorQuery
    .input(z.object({ productId: z.number() }))
    .query(async ({ input, ctx }) => {
      return ctx.db.select({
        id: stockMovements.id, type: stockMovements.type, quantity: stockMovements.quantity,
        referenceType: stockMovements.referenceType, referenceId: stockMovements.referenceId,
        notes: stockMovements.notes, createdAt: stockMovements.createdAt, productName: products.name,
      })
        .from(stockMovements)
        .leftJoin(products, eq(stockMovements.productId, products.id))
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

  adjustStock: operatorQuery
    .input(z.object({
      productId: z.number().int().positive(),
      quantity:  z.string().refine(v => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0;
      }, "Количество должно быть положительным числом"),
      type:      z.enum(["in", "out", "adjustment"]),
      notes:     z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { getClientIp } = await import("./lib/rate-limit");
      return StockService.adjust(ctx.db, ctx.tenant.id, input.productId, Number(input.quantity), input.type, input.notes, {
        id: ctx.user.id,
        name: ctx.user.name,
        ip: getClientIp(ctx.req),
      });
    }),

  // ── Stock Valuation ─────────────────────────────────────────────────────────
  valuation: operatorQuery
    .query(async ({ ctx }) => {
      const db = ctx.db;
      const tenantId = ctx.tenant.id;

      const [summary] = await db.select({
        totalCostValue:  sql<string>`COALESCE(SUM(${warehouseStock.currentStock} * COALESCE(${products.costPrice}, 0)), 0)`,
        totalRetailValue: sql<string>`COALESCE(SUM(${warehouseStock.currentStock} * COALESCE(${products.unitPrice}, 0)), 0)`,
        totalUnits:      sql<string>`COALESCE(SUM(${warehouseStock.currentStock}), 0)`,
      })
        .from(warehouseStock)
        .leftJoin(products, eq(warehouseStock.productId, products.id))
        .where(eq(warehouseStock.tenantId, tenantId));

      return summary ?? { totalCostValue: "0", totalRetailValue: "0", totalUnits: "0" };
    }),

  // ── Dead Stock — products with stock but no orders in last N days ──────────
  deadStock: operatorQuery
    .input(z.object({ days: z.number().default(30) }).optional())
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
        lastOrderDate: sql<Date | null>`MAX(CASE WHEN ${orders.status} = 'completed' THEN ${orders.createdAt} END)`,
        daysSinceOrder: sql<number>`CASE WHEN MAX(CASE WHEN ${orders.status} = 'completed' THEN ${orders.createdAt} END) IS NULL THEN 99999 ELSE DATEDIFF(NOW(), MAX(CASE WHEN ${orders.status} = 'completed' THEN ${orders.createdAt} END)) END`,
      })
        .from(warehouseStock)
        .leftJoin(products, eq(warehouseStock.productId, products.id))
        .leftJoin(orderItems, eq(orderItems.productId, products.id))
        .leftJoin(orders, eq(orderItems.orderId, orders.id))
        .where(and(
          eq(warehouseStock.tenantId, tenantId),
          sql`${warehouseStock.currentStock} > 0`,
          sql`(${orders.tenantId} IS NULL OR ${orders.tenantId} = ${tenantId})`,
        ))
        .groupBy(products.id, products.name, products.code, products.unit, products.unitPrice, products.costPrice, products.category, warehouseStock.currentStock)
        .having(sql`MAX(CASE WHEN ${orders.status} = 'completed' AND ${orders.createdAt} >= ${cutoff} THEN 1 END) IS NULL`)
        .orderBy(desc(sql`COALESCE(${warehouseStock.currentStock} * COALESCE(${products.costPrice}, 0), 0)`));
    }),

  // ── Auto-Replenishment Suggestions ──────────────────────────────────────────
  reorderSuggestions: operatorQuery.query(async ({ ctx }) => {
    const db = ctx.db;
    const tenantId = ctx.tenant.id;
    const days30 = new Date(Date.now() - 30 * 86400000).toISOString();

    // Products below reorder point with sales velocity
    const results = await db.select({
      productId: products.id,
      productName: products.name,
      productCode: products.code,
      currentStock: warehouseStock.currentStock,
      reorderPoint: products.reorderPoint,
      unit: products.unit,
      unitPrice: products.unitPrice,
      costPrice: products.costPrice,
      avgDailySales: sql<string>`COALESCE((SELECT SUM(${orderItems.quantity}) FROM ${orderItems} INNER JOIN ${orders} ON ${orderItems.orderId} = ${orders.id} WHERE ${orderItems.productId} = ${products.id} AND ${orders.tenantId} = ${tenantId} AND ${orders.status} = 'completed' AND ${orders.createdAt} >= ${days30}) / 30, 0)`,
    })
      .from(warehouseStock)
      .leftJoin(products, eq(warehouseStock.productId, products.id))
      .where(and(
        eq(warehouseStock.tenantId, tenantId),
        sql`${warehouseStock.available} <= ${products.reorderPoint}`,
      ))
      .orderBy(sql`${warehouseStock.available} / NULLIF(${products.reorderPoint}, 0)`);

    return results.map(r => {
      const avgDaily = Number(r.avgDailySales);
      const current = Number(r.currentStock ?? 0);
      const reorderAt = Number(r.reorderPoint ?? 0);
      const daysUntilStockout = avgDaily > 0 ? Math.round(current / avgDaily) : 999;
      const suggestedQty = Math.max(0, reorderAt * 2 - current); // Заказать до 2x порога

      return {
        ...r,
        avgDailySales: avgDaily.toFixed(1),
        daysUntilStockout,
        suggestedQty: Math.round(suggestedQty),
        suggestedCost: Math.round(suggestedQty * Number(r.costPrice ?? 0)),
      };
    });
  }),

  /** Create missing warehouse_stock rows for products that don't have one */
  backfillStock: operatorQuery
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

      const rows = (missing as any).rows ?? missing;
      if (rows.length === 0) return { created: 0 };

      // Get default warehouse for tenant
      const [defaultWarehouse] = await db.select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)))
        .limit(1);

      if (!defaultWarehouse) return { created: 0 };

      await db.insert(warehouseStock).values(
        rows.map((r: any) => ({
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

  // Удалить все товары со склада
  deleteAll: operatorQuery
    .mutation(async ({ ctx }) => {
      const db = ctx.db;
      const tenantId = ctx.tenant.id;

      // Удаляем все записи стока
      await db.delete(warehouseStock)
        .where(eq(warehouseStock.tenantId, tenantId));

      // Помечаем все товары как inactive
      await db.update(products)
        .set({ status: "inactive", updatedAt: new Date() })
        .where(eq(products.tenantId, tenantId));

      return { success: true };
    }),
});
