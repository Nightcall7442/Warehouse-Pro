import { z } from "zod";
import { createRouter, operatorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  warehouseStock, products, stockMovements,
  orderItems, orders, arrivals, arrivalItems,
} from "@db/schema";
import { eq, and, sql, desc } from "drizzle-orm";

export const warehouseReportsRouter = createRouter({
  /** Stock breakdown by product category */
  stockByCategory: operatorQuery.query(async ({ ctx }) => {
    const db = getDb();
    const tenantId = ctx.tenant.id;

    const result = await db.select({
      category: sql<string>`COALESCE(${products.category}, 'Без категории')`,
      totalProducts: sql<number>`COUNT(DISTINCT ${products.id})`,
      totalUnits: sql<number>`COALESCE(SUM(${warehouseStock.currentStock}), 0)`,
      totalValue: sql<number>`COALESCE(SUM(${warehouseStock.currentStock} * COALESCE(${products.costPrice}, 0)), 0)`,
      totalRetail: sql<number>`COALESCE(SUM(${warehouseStock.currentStock} * COALESCE(${products.unitPrice}, 0)), 0)`,
      lowStockCount: sql<number>`COUNT(CASE WHEN ${warehouseStock.available} <= ${products.reorderPoint} THEN 1 END)`,
    })
      .from(warehouseStock)
      .leftJoin(products, eq(warehouseStock.productId, products.id))
      .where(eq(warehouseStock.tenantId, tenantId))
      .groupBy(sql`COALESCE(${products.category}, 'Без категории')`)
      .orderBy(desc(sql`COALESCE(SUM(${warehouseStock.currentStock} * COALESCE(${products.costPrice}, 0)), 0)`));

    return result;
  }),

  /** Stock movement trends — daily in/out for last N days */
  movementTrends: operatorQuery
    .input(z.object({ days: z.number().default(30) }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const days = input?.days ?? 30;
      const cutoff = new Date(Date.now() - days * 86400000);

      const result = await db.select({
        date: sql<string>`DATE(${stockMovements.createdAt})`,
        inQty: sql<number>`COALESCE(SUM(CASE WHEN ${stockMovements.type} = 'in' THEN ${stockMovements.quantity} ELSE 0 END), 0)`,
        outQty: sql<number>`COALESCE(SUM(CASE WHEN ${stockMovements.type} = 'out' THEN ${stockMovements.quantity} ELSE 0 END), 0)`,
        adjustmentQty: sql<number>`COALESCE(SUM(CASE WHEN ${stockMovements.type} = 'adjustment' THEN ${stockMovements.quantity} ELSE 0 END), 0)`,
        movements: sql<number>`COUNT(*)`,
      })
        .from(stockMovements)
        .where(and(
          eq(stockMovements.tenantId, tenantId),
          sql`${stockMovements.createdAt} >= ${cutoff}`,
        ))
        .groupBy(sql`DATE(${stockMovements.createdAt})`)
        .orderBy(sql`DATE(${stockMovements.createdAt})`);

      return result;
    }),

  /** Top products by inventory value */
  topByValue: operatorQuery
    .input(z.object({ limit: z.number().default(10) }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;

      return db.select({
        productId: products.id,
        productName: products.name,
        productCode: products.code,
        category: products.category,
        unit: products.unit,
        currentStock: warehouseStock.currentStock,
        available: warehouseStock.available,
        costPrice: products.costPrice,
        unitPrice: products.unitPrice,
        costValue: sql<number>`COALESCE(${warehouseStock.currentStock} * COALESCE(${products.costPrice}, 0), 0)`,
        retailValue: sql<number>`COALESCE(${warehouseStock.currentStock} * COALESCE(${products.unitPrice}, 0), 0)`,
        margin: sql<number>`COALESCE(${warehouseStock.currentStock} * (COALESCE(${products.unitPrice}, 0) - COALESCE(${products.costPrice}, 0)), 0)`,
      })
        .from(warehouseStock)
        .leftJoin(products, eq(warehouseStock.productId, products.id))
        .where(and(eq(warehouseStock.tenantId, tenantId), sql`${warehouseStock.currentStock} > 0`))
        .orderBy(desc(sql`COALESCE(${warehouseStock.currentStock} * COALESCE(${products.costPrice}, 0), 0)`))
        .limit(input?.limit ?? 10);
    }),

  /** Arrival logistics costs summary */
  arrivalCosts: operatorQuery
    .input(z.object({ days: z.number().default(30) }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const days = input?.days ?? 30;
      const cutoff = new Date(Date.now() - days * 86400000);

      const [summary] = await db.select({
        totalArrivals: sql<number>`COUNT(*)`,
        totalFuelCost: sql<number>`COALESCE(SUM(${arrivals.fuelCost}), 0)`,
        totalTollCost: sql<number>`COALESCE(SUM(${arrivals.tollCost}), 0)`,
        totalOtherCost: sql<number>`COALESCE(SUM(${arrivals.otherCost}), 0)`,
        totalExpense: sql<number>`COALESCE(SUM(${arrivals.totalExpense}), 0)`,
        totalUnits: sql<number>`COALESCE((SELECT SUM(${arrivalItems.quantity}) FROM ${arrivalItems} INNER JOIN ${arrivals} a ON ${arrivalItems.arrivalId} = a.id WHERE a.tenant_id = ${tenantId} AND a.created_at >= ${cutoff}), 0)`,
      })
        .from(arrivals)
        .where(and(
          eq(arrivals.tenantId, tenantId),
          sql`${arrivals.createdAt} >= ${cutoff}`,
        ));

      // Daily breakdown
      const daily = await db.select({
        date: sql<string>`DATE(${arrivals.createdAt})`,
        arrivals: sql<number>`COUNT(*)`,
        fuelCost: sql<number>`COALESCE(SUM(${arrivals.fuelCost}), 0)`,
        tollCost: sql<number>`COALESCE(SUM(${arrivals.tollCost}), 0)`,
        totalExpense: sql<number>`COALESCE(SUM(${arrivals.totalExpense}), 0)`,
      })
        .from(arrivals)
        .where(and(
          eq(arrivals.tenantId, tenantId),
          sql`${arrivals.createdAt} >= ${cutoff}`,
        ))
        .groupBy(sql`DATE(${arrivals.createdAt})`)
        .orderBy(sql`DATE(${arrivals.createdAt})`);

      return { summary, daily };
    }),

  /** Stock turnover — products sold vs avg inventory over period */
  turnover: operatorQuery
    .input(z.object({ days: z.number().default(30) }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const days = input?.days ?? 30;
      const cutoff = new Date(Date.now() - days * 86400000);

      const result = await db.select({
        productId: products.id,
        productName: products.name,
        productCode: products.code,
        unit: products.unit,
        currentStock: warehouseStock.currentStock,
        soldQty: sql<number>`COALESCE((SELECT SUM(${orderItems.quantity}) FROM ${orderItems} INNER JOIN ${orders} o ON ${orderItems.orderId} = o.id WHERE ${orderItems.productId} = ${products.id} AND o.tenant_id = ${tenantId} AND o.status = 'completed' AND o.created_at >= ${cutoff}), 0)`,
      })
        .from(warehouseStock)
        .leftJoin(products, eq(warehouseStock.productId, products.id))
        .where(and(eq(warehouseStock.tenantId, tenantId), sql`${warehouseStock.currentStock} > 0`))
        .orderBy(desc(sql`COALESCE((SELECT SUM(${orderItems.quantity}) FROM ${orderItems} INNER JOIN ${orders} o ON ${orderItems.orderId} = o.id WHERE ${orderItems.productId} = ${products.id} AND o.tenant_id = ${tenantId} AND o.status = 'completed' AND o.created_at >= ${cutoff}), 0)`))
        .limit(20);

      return result.map(r => {
        const stock = Number(r.currentStock ?? 0);
        const sold = Number(r.soldQty);
        const avgInventory = stock + sold / 2; // rough average
        const turnoverRate = avgInventory > 0 ? (sold / avgInventory).toFixed("2") : "0";
        const daysToSell = sold > 0 ? Math.round(stock / (sold / days)) : 999;
        return { ...r, turnoverRate, daysToSell };
      });
    }),

  /** Dynamic reorder point — calculates days until stockout based on sales velocity */
  reorderAlerts: operatorQuery
    .input(z.object({ days: z.number().default(30) }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const days = input?.days ?? 30;
      const cutoff = new Date(Date.now() - days * 86400000);

      // Get products with current stock and sales velocity
      const result = await db.select({
        productId: products.id,
        productName: products.name,
        productCode: products.code,
        category: products.category,
        currentStock: warehouseStock.currentStock,
        reorderPoint: warehouseStock.reorderPoint,
        soldQty: sql<string>`COALESCE((SELECT SUM(${orderItems.quantity}) FROM ${orderItems} INNER JOIN ${orders} o ON ${orderItems.orderId} = o.id WHERE ${orderItems.productId} = ${products.id} AND o.tenant_id = ${tenantId} AND o.status = 'completed' AND o.created_at >= ${cutoff}), 0)`,
      })
        .from(warehouseStock)
        .innerJoin(products, eq(warehouseStock.productId, products.id))
        .where(eq(warehouseStock.tenantId, tenantId))
        .orderBy(sql`COALESCE((SELECT SUM(${orderItems.quantity}) FROM ${orderItems} INNER JOIN ${orders} o ON ${orderItems.orderId} = o.id WHERE ${orderItems.productId} = ${products.id} AND o.tenant_id = ${tenantId} AND o.status = 'completed' AND o.created_at >= ${cutoff}), 0) DESC`)
        .limit(50);

      return result.map(r => {
        const stock = Number(r.currentStock ?? 0);
        const sold = Number(r.soldQty);
        const dailyVelocity = sold / days; // units per day
        const daysUntilStockout = dailyVelocity > 0 ? Math.round(stock / dailyVelocity) : 999;

        // Dynamic reorder point: velocity * lead time (assume 7 days lead time)
        const dynamicReorderPoint = Math.ceil(dailyVelocity * 7);

        // Alert levels
        let alertLevel: "ok" | "warning" | "critical" = "ok";
        if (daysUntilStockout <= 3) alertLevel = "critical";
        else if (daysUntilStockout <= 7) alertLevel = "warning";

        return {
          ...r,
          dailyVelocity: dailyVelocity.toFixed("2"),
          daysUntilStockout,
          dynamicReorderPoint,
          alertLevel,
        };
      });
    }),
});
