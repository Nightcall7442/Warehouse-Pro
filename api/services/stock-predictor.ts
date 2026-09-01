/**
 * Stock Predictor — Predicts stockout dates and recommends reorders.
 */

import { getDb } from "../queries/connection";
import { warehouseStock, orderItems, orders, products, arrivals, arrivalItems } from "@db/schema";
import { eq, and, sql, gte, lt } from "drizzle-orm";
import { revenueOrderConditions } from "../lib/order-status";
import { withCache } from "../lib/cache";
import type { DemandPoint } from "./forecast-engine";

/**
 * Сколько живёт готовый прогноз по исчерпанию запасов.
 *
 * Прогноз строится на окне в недели, поэтому от минуты к минуте он не меняется,
 * а вот пересчёт его стоит двух групповых запросов по всей истории заказов
 * тенанта. Без кэша каждый клик по «Обновить» и каждый рефетч React Query
 * заводил новую такую цепочку рядом с ещё не закончившейся предыдущей.
 * Две минуты — тот же порядок, что и у остальных тяжёлых сводок (CacheTTL.kpis).
 */
const STOCKOUT_CACHE_TTL_MS = 2 * 60 * 1000;

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
    quantity: sql<string>`SUM(CAST(${orderItems.quantity} AS DECIMAL(15,3)))`,
  })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(
      // Через общий набор условий, а не руками. Он и заведён потому, что при
      // переписывании вручную терялся фильтр удалённых заказов — здесь он был
      // потерян ровно так же: удалённый заказ считался спросом и завышал
      // среднедневное потребление.
      ...revenueOrderConditions(tenantId),
      eq(orderItems.productId, productId),
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
  return withCache(
    `forecast:stockout:${tenantId}:${lookbackDays}`,
    STOCKOUT_CACHE_TTL_MS,
    () => computeStockouts(tenantId, lookbackDays),
  );
}

async function computeStockouts(
  tenantId: number,
  lookbackDays: number
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

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - lookbackDays);
  // Верхняя граница окна — полночь сегодняшнего дня. Начатый день неполон, и
  // его частичные продажи занижали бы среднее. Так же считал и прежний код:
  // getProductDemand достраивал ряд ровно на lookbackDays дней НАЗАД от
  // startDate, и сегодняшняя дата в этот ряд не попадала — выбранные строки за
  // сегодня молча выбрасывались при сшивании по дате.
  const windowEnd = new Date();
  windowEnd.setHours(0, 0, 0, 0);

  // Спрос и ожидаемые приходы — ДВА групповых запроса на весь тенант вместо
  // двух запросов на каждую строку склада.
  //
  // Раньше цикл ниже звал getProductDemand и запрос по arrival_items для
  // каждой строки warehouse_stock: 3000 активных товаров на двух складах —
  // это 6000 строк × 2 последовательных round-trip, 12 000 обращений к MySQL
  // подряд внутри одного HTTP-вызова. На удалённой базе (RTT 2-5 мс) ответ не
  // успевал прийти до таймаута клиента, но сервер продолжал крутить цикл до
  // конца и держал соединение; пользователь жал «Обновить» — и рядом
  // заводилась вторая такая же цепочка.
  //
  // Разбивка по дням тут не нужна: среднедневное потребление — это сумма за
  // окно, делённая на длину окна, а дни без продаж дают ноль и на сумму не
  // влияют. Помесячный ряд по одному товару по-прежнему отдаёт
  // getProductDemand — там он нужен движку прогноза.
  const demandRows = await db.select({
    productId: orderItems.productId,
    quantity: sql<string>`SUM(CAST(${orderItems.quantity} AS DECIMAL(15,3)))`,
  })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(
      // Тот же общий набор: организация, выручковые статусы и — главное —
      // отсечение удалённых заказов.
      ...revenueOrderConditions(tenantId),
      gte(orders.createdAt, startDate),
      lt(orders.createdAt, windowEnd),
    ))
    .groupBy(orderItems.productId);

  const demandTotals = new Map<number, number>();
  for (const row of demandRows) {
    demandTotals.set(row.productId, Number(row.quantity));
  }

  const pendingRows = await db.select({
    productId: arrivalItems.productId,
    total: sql<string>`SUM(CAST(${arrivalItems.quantity} AS DECIMAL(15,3)))`,
  })
    .from(arrivalItems)
    .innerJoin(arrivals, eq(arrivalItems.arrivalId, arrivals.id))
    .where(and(
      eq(arrivals.tenantId, tenantId),
      eq(arrivals.status, "pending"),
    ))
    .groupBy(arrivalItems.productId);

  const pendingByProduct = new Map<number, number>();
  for (const row of pendingRows) {
    pendingByProduct.set(row.productId, Number(row.total));
  }

  const predictions: StockoutPrediction[] = [];

  for (const stock of stockRows) {
    // Округление то же, что и в avgDailyConsumption: два знака после запятой.
    // Делитель — длина окна в днях, а не число дней с продажами, иначе товар,
    // проданный один раз за месяц, выглядел бы уходящим каждый день.
    const avg = Math.round(((demandTotals.get(stock.productId) ?? 0) / lookbackDays) * 100) / 100;
    const current = Number(stock.currentStock);
    const reorder = Number(stock.reorderPoint);
    const pending = pendingByProduct.get(stock.productId) ?? 0;

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
