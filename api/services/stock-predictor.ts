/**
 * Stock Predictor — Predicts stockout dates and recommends reorders.
 */

import { getDb } from "../queries/connection";
import { warehouseStock, orderItems, orders, products, arrivals, arrivalItems } from "@db/schema";
import { eq, and, sql, gte, desc , inArray } from "drizzle-orm";
import { DemandPoint } from "./forecast-engine";

/** Stockout prediction for a single product */
export interface StockoutPrediction {
  productId: number;
  productName: string;
  productCode: string;
  currentStock: number;
  avgDailyConsumption: number;
  daysUntilStockout: number;
  reorderPoint: number;
  needsReorder: boolean;
  urgency: "critical" | "warning" | "ok";
  pendingArrivals: number;
}

/** Reorder recommendation */
export interface ReorderRecommendation {
  productId: number;
  productName: string;
  productCode: string;
  currentStock: number;
  reorderPoint: number;
  avgDailyConsumption: number;
  suggestedQuantity: number;
  daysUntilStockout: number;
  urgency: "critical" | "warning" | "ok";
}

/**
 * Get historical daily demand for a product (last N days)
 */
export async function getProductDemand(
  tenantId: number,
  productId: number,
  days = 30
): Promise<DemandPoint[]> {
  const db = getDb();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const rows = await db.select({
    date: sql<string>`DATE(${orders.createdAt})`,
    quantity: sql<string>`SUM(CAST(${orderItems.quantity} AS DECIMAL))`,
  })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(
      eq(orders.tenantId, tenantId),
      eq(orderItems.productId, productId),
      inArray(orders.status, ["delivered", "completed"]),
      gte(orders.createdAt, startDate),
    ))
    .groupBy(sql`DATE(${orders.createdAt})`)
    .orderBy(sql`DATE(${orders.createdAt})`);

  // Fill gaps (days with zero sales)
  const demandMap = new Map<string, number>();
  for (const row of rows) {
    demandMap.set(row.date, Number(row.quantity));
  }

  const result: DemandPoint[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split("T")[0];
    result.push({
      date: dateStr,
      quantity: demandMap.get(dateStr) ?? 0,
    });
  }

  return result;
}

/**
 * Calculate average daily consumption for a product
 */
export function avgDailyConsumption(demand: DemandPoint[]): number {
  if (demand.length === 0) return 0;
  const total = demand.reduce((sum, d) => sum + d.quantity, 0);
  return Math.round((total / demand.length) * 100) / 100;
}

/**
 * Predict stockout for all products in a tenant
 */
export async function predictStockouts(
  tenantId: number,
  lookbackDays = 30
): Promise<StockoutPrediction[]> {
  const db = getDb();

  // Get all products with stock
  const stockRows = await db.select({
    productId: warehouseStock.productId,
    productName: products.name,
    productCode: products.code,
    currentStock: warehouseStock.currentStock,
    reorderPoint: products.reorderPoint,
  })
    .from(warehouseStock)
    .innerJoin(products, eq(warehouseStock.productId, products.id))
    .where(and(
      eq(warehouseStock.tenantId, tenantId),
      eq(products.status, "active"),
    ));

  const predictions: StockoutPrediction[] = [];

  for (const stock of stockRows) {
    const demand = await getProductDemand(tenantId, stock.productId, lookbackDays);
    const avg = avgDailyConsumption(demand);
    const current = Number(stock.currentStock);
    const reorder = Number(stock.reorderPoint);

    // Get pending arrivals
    const pendingRows = await db.select({
      total: sql<string>`SUM(CAST(${arrivalItems.quantity} AS DECIMAL))`,
    })
      .from(arrivalItems)
      .innerJoin(arrivals, eq(arrivalItems.arrivalId, arrivals.id))
      .where(and(
        eq(arrivals.tenantId, tenantId),
        eq(arrivalItems.productId, stock.productId),
        eq(arrivals.status, "pending"),
      ));
    const pending = Number(pendingRows[0]?.total ?? 0);

    const effectiveStock = current + pending;
    const daysUntilStockout = avg > 0 ? Math.floor(effectiveStock / avg) : 999;

    let urgency: "critical" | "warning" | "ok" = "ok";
    if (daysUntilStockout <= 3) urgency = "critical";
    else if (daysUntilStockout <= 7) urgency = "warning";

    predictions.push({
      productId: stock.productId,
      productName: stock.productName,
      productCode: stock.productCode,
      currentStock: current,
      avgDailyConsumption: avg,
      daysUntilStockout,
      reorderPoint: reorder,
      needsReorder: effectiveStock <= reorder,
      urgency,
      pendingArrivals: pending,
    });
  }

  // Sort by urgency (critical first)
  const urgencyOrder = { critical: 0, warning: 1, ok: 2 };
  predictions.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency] || a.daysUntilStockout - b.daysUntilStockout);

  return predictions;
}

/**
 * Generate reorder recommendations
 */
export async function getReorderRecommendations(
  tenantId: number,
  lookbackDays = 30,
  leadTimeDays = 3
): Promise<ReorderRecommendation[]> {
  const predictions = await predictStockouts(tenantId, lookbackDays);

  return predictions
    .filter(p => p.needsReorder || p.urgency !== "ok")
    .map(p => {
      // Suggested quantity: cover lead time + 14 days buffer
      const suggestedQty = Math.ceil(p.avgDailyConsumption * (leadTimeDays + 14));
      return {
        productId: p.productId,
        productName: p.productName,
        productCode: p.productCode,
        currentStock: p.currentStock,
        reorderPoint: p.reorderPoint,
        avgDailyConsumption: p.avgDailyConsumption,
        suggestedQuantity: Math.max(suggestedQty, p.reorderPoint - p.currentStock),
        daysUntilStockout: p.daysUntilStockout,
        urgency: p.urgency,
      };
    });
}
