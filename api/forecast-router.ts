import { z } from "zod";
import { createRouter, supervisorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { orderItems, orders, products } from "@db/schema";
import { eq, and, sql, gte, desc , inArray } from "drizzle-orm";
import { cache, CacheTTL } from "./lib/cache";
import {
  simpleMovingAverage,
  exponentialSmoothing,
  linearTrendForecast,
  weeklySeasonality,
  bestForecastMethod,
} from "./services/forecast-engine";
import {
  getProductDemand,
  predictStockouts,
  getReorderRecommendations,
} from "./services/stock-predictor";

export const forecastRouter = createRouter({
  /** Demand forecast for a specific product */
  demandForecast: supervisorQuery
    .input(z.object({
      productId: z.number(),
      horizon: z.number().min(1).max(90).default(14),
      method: z.enum(["sma", "es", "linear", "auto"]).default("auto"),
      lookbackDays: z.number().min(7).max(365).default(60),
    }))
    .query(async ({ input, ctx }) => {
      const tenantId = ctx.tenant.id;
      const cacheKey = `forecast:${tenantId}:${input.productId}:${input.horizon}:${input.method}`;
      const cached = cache.get(cacheKey);
      if (cached) return cached;

      const demand = await getProductDemand(tenantId, input.productId, input.lookbackDays);
      if (demand.length < 7) {
        return { forecast: [], method: "none", message: "Недостаточно данных (мин. 7 дней)" };
      }

      let result: { method: string; forecast: ReturnType<typeof simpleMovingAverage> };

      switch (input.method) {
        case "sma":
          result = { method: "SMA-7", forecast: simpleMovingAverage(demand, 7, input.horizon) };
          break;
        case "es":
          result = { method: "ES-0.3", forecast: exponentialSmoothing(demand, 0.3, input.horizon) };
          break;
        case "linear":
          result = { method: "Linear", forecast: linearTrendForecast(demand, input.horizon) };
          break;
        default:
          result = bestForecastMethod(demand, input.horizon);
      }

      const seasonality = weeklySeasonality(demand);
      const response = { ...result, seasonality, historicalPoints: demand.length };
      cache.set(cacheKey, response, CacheTTL.analytics);
      return response;
    }),

  /** Stockout predictions for all products */
  stockoutPrediction: supervisorQuery
    .input(z.object({
      lookbackDays: z.number().min(7).max(90).default(30),
    }).optional())
    .query(async ({ input, ctx }) => {
      const tenantId = ctx.tenant.id;
      const lookback = input?.lookbackDays ?? 30;
      return predictStockouts(tenantId, lookback);
    }),

  /** Reorder recommendations */
  reorderRecommendation: supervisorQuery
    .input(z.object({
      lookbackDays: z.number().min(7).max(90).default(30),
      leadTimeDays: z.number().min(1).max(30).default(3),
    }).optional())
    .query(async ({ input, ctx }) => {
      const tenantId = ctx.tenant.id;
      const lookback = input?.lookbackDays ?? 30;
      const leadTime = input?.leadTimeDays ?? 3;
      return getReorderRecommendations(tenantId, lookback, leadTime);
    }),

  /** Category-level demand trend */
  categoryTrend: supervisorQuery
    .input(z.object({
      category: z.string(),
      period: z.enum(["7d", "30d", "90d"]).default("30d"),
    }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const days = input.period === "7d" ? 7 : input.period === "90d" ? 90 : 30;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const rows = await db.select({
        date: sql<string>`DATE(${orders.createdAt})`,
        quantity: sql<string>`SUM(CAST(${orderItems.quantity} AS DECIMAL))`,
        revenue: sql<string>`SUM(CAST(${orderItems.subtotal} AS DECIMAL))`,
      })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .innerJoin(products, eq(orderItems.productId, products.id))
        .where(and(
          eq(orders.tenantId, tenantId),
          inArray(orders.status, ["delivered", "completed"]),
          eq(products.category, input.category),
          gte(orders.createdAt, startDate),
        ))
        .groupBy(sql`DATE(${orders.createdAt})`)
        .orderBy(sql`DATE(${orders.createdAt})`);

      return {
        category: input.category,
        period: input.period,
        data: rows.map(r => ({
          date: r.date,
          quantity: Number(r.quantity),
          revenue: Number(r.revenue),
        })),
      };
    }),

  /** Top products by demand velocity */
  trendingProducts: supervisorQuery
    .input(z.object({
      period: z.enum(["7d", "30d"]).default("7d"),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;
      const period = input?.period ?? "7d";
      const days = period === "7d" ? 7 : 30;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const rows = await db.select({
        productId: orderItems.productId,
        productName: products.name,
        productCode: products.code,
        totalQty: sql<string>`SUM(CAST(${orderItems.quantity} AS DECIMAL))`,
        totalRevenue: sql<string>`SUM(CAST(${orderItems.subtotal} AS DECIMAL))`,
        orderCount: sql<number>`COUNT(DISTINCT ${orders.id})`,
      })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .innerJoin(products, eq(orderItems.productId, products.id))
        .where(and(
          eq(orders.tenantId, tenantId),
          inArray(orders.status, ["delivered", "completed"]),
          gte(orders.createdAt, startDate),
        ))
        .groupBy(orderItems.productId, products.name, products.code)
        .orderBy(desc(sql`SUM(CAST(${orderItems.quantity} AS DECIMAL))`))
        .limit(10);

      return rows.map(r => ({
        productId: r.productId,
        productName: r.productName,
        productCode: r.productCode,
        totalQuantity: Number(r.totalQty),
        totalRevenue: Number(r.totalRevenue),
        orderCount: r.orderCount,
      }));
    }),
});
