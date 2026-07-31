import { z } from "zod";
import { createRouter, superAdminQuery } from "./middleware";
import { cache } from "./lib/cache";
import { sseBus } from "./lib/sse";
import { getMetricsSummary } from "./lib/metrics";
import { env } from "./lib/env";
import { sql, eq } from "drizzle-orm";
import { getReqStats, getAllSeries, recordRequestPoint } from "./lib/timeseries";
import { getErrors, getErrorById, getErrorStats, getGroupedErrors, getErrorTrend, purgeOldErrors } from "./lib/error-log";
import { orders, products, shops, users } from "@db/schema";

const APP_VERSION = process.env.APP_VERSION ?? "2.0.0";

// ── Request counter (in-memory) ──────────────────────────────────────────────
let totalRequestCount = 0;
let totalErrorCount = 0;
let totalResponseTime = 0;

export function recordRequest(responseTimeMs: number, isError: boolean) {
  totalRequestCount++;
  totalResponseTime += responseTimeMs;
  if (isError) totalErrorCount++;
  recordRequestPoint(responseTimeMs, isError);
}

export const systemRouter = createRouter({
  /** Full system status — health, DB, cache, SSE, memory, metrics */
  status: superAdminQuery.query(async ({ ctx }) => {
    const uptime = Math.floor(process.uptime());
    const mem = process.memoryUsage();

    // DB health + response time + connection pool
    let dbHealthy = false;
    let dbResponseMs = 0;
    const dbConnections = { active: 0, idle: 0, total: 0 };
    try {
      const dbStart = Date.now();
      const db = ctx.db;
      await db.execute(sql`SELECT 1`);
      dbResponseMs = Date.now() - dbStart;
      dbHealthy = true;

      // Connection pool stats (MySQL SHOW STATUS)
      try {
        const [connResult] = await db.execute(sql`SHOW STATUS WHERE Variable_name IN ('Threads_connected', 'Threads_running')`);
        const rows = (connResult as unknown[][])[0] as Record<string, string>[] | undefined;
        if (rows) {
          for (const row of rows) {
            if (row.Variable_name === "Threads_connected") dbConnections.total = Number(row.Value);
            if (row.Variable_name === "Threads_running") dbConnections.active = Number(row.Value);
          }
          dbConnections.idle = dbConnections.total - dbConnections.active;
        }
      } catch { /* SHOW STATUS may not be available */ }
    } catch {
      dbHealthy = false;
    }

    // Business metrics (last 24h)
    const businessMetrics = { orders24h: 0, revenue24h: "0", newProducts: 0, activeUsers: 0, totalShops: 0 };
    try {
      const db = ctx.db;
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [orderCount] = await db.select({ count: sql<number>`count(*)` })
        .from(orders).where(sql`${orders.createdAt} >= ${dayAgo}`);
      businessMetrics.orders24h = Number(orderCount?.count ?? 0);

      const [revenue] = await db.select({ total: sql<string>`COALESCE(SUM(CAST(total AS DECIMAL(10,2))), 0)` })
        .from(orders).where(sql`${orders.createdAt} >= ${dayAgo} AND status = 'completed'`);
      businessMetrics.revenue24h = String(revenue?.total ?? "0");

      const [prodCount] = await db.select({ count: sql<number>`count(*)` })
        .from(products).where(sql`${products.createdAt} >= ${dayAgo}`);
      businessMetrics.newProducts = Number(prodCount?.count ?? 0);

      const [userCount] = await db.select({ count: sql<number>`count(*)` })
        .from(users).where(sql`${users.lastSignInAt} >= ${dayAgo}`);
      businessMetrics.activeUsers = Number(userCount?.count ?? 0);

      const [shopCount] = await db.select({ count: sql<number>`count(*)` })
        .from(shops).where(eq(shops.status, "active"));
      businessMetrics.totalShops = Number(shopCount?.count ?? 0);
    } catch { /* business metrics are optional */ }

    // Cache stats
    const cacheStats = cache.getStats();

    // SSE stats
    const sseStats = sseBus.getStats();

    // Metrics summary
    const metricsSummary = getMetricsSummary();

    // Request stats (with percentiles)
    const reqStats = getReqStats();

    // Time-series data for charts
    const series = getAllSeries();

    return {
      server: {
        status: dbHealthy ? "ok" : "degraded",
        version: APP_VERSION,
        uptime,
        uptimeFormatted: formatUptime(uptime),
        environment: env.isProduction ? "production" : "development",
        nodeVersion: process.version,
        pid: process.pid,
      },
      database: {
        connected: dbHealthy,
        responseTimeMs: dbResponseMs,
        connections: dbConnections,
      },
      cache: {
        hits: cacheStats.hits,
        misses: cacheStats.misses,
        size: cacheStats.size,
        hitRate: cacheStats.hitRate,
      },
      sse: {
        channels: sseStats.channels,
        totalListeners: sseStats.totalListeners,
      },
      memory: {
        rss: formatBytes(mem.rss),
        heapUsed: formatBytes(mem.heapUsed),
        heapTotal: formatBytes(mem.heapTotal),
        external: formatBytes(mem.external),
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
        rssMB: Math.round(mem.rss / (1024 * 1024)),
        heapUsedMB: Math.round(mem.heapUsed / (1024 * 1024)),
        heapTotalMB: Math.round(mem.heapTotal / (1024 * 1024)),
      },
      requests: {
        total: totalRequestCount,
        errors: totalErrorCount,
        avgResponseTime: reqStats.avgResponseTime,
        errorRate: reqStats.errorRate,
        rps: reqStats.rps,
        p50: reqStats.p50,
        p95: reqStats.p95,
        p99: reqStats.p99,
        windowTotal: reqStats.total,
        windowErrors: reqStats.errors,
      },
      metrics: metricsSummary,
      business: businessMetrics,
      series,
      timestamp: new Date().toISOString(),
    };
  }),

  /** List errors with filtering */
  errors: superAdminQuery
    .input(z.object({
      limit: z.number().optional(),
      offset: z.number().optional(),
      code: z.string().optional(),
      path: z.string().optional(),
      since: z.number().optional(),
    }).optional())
    .query(({ input }) => {
      return getErrors(input);
    }),

  /** Get single error detail */
  errorDetail: superAdminQuery
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      return getErrorById(input.id) ?? null;
    }),

  /** Error statistics */
  errorStats: superAdminQuery.query(() => {
    return getErrorStats();
  }),

  /** Check and send alerts if thresholds exceeded */
  checkAlerts: superAdminQuery.query(async () => {
    const reqStats = getReqStats();
    const alerts: string[] = [];

    // Error rate alert (> 5%)
    if (Number(reqStats.errorRate) > 5) {
      alerts.push(`🔴 Error rate: ${reqStats.errorRate}% (${reqStats.windowErrors} errors in window)`);
    }

    // P95 latency alert (> 500ms)
    if (reqStats.p95 > 500) {
      alerts.push(`🟡 P95 latency: ${reqStats.p95}ms (threshold: 500ms)`);
    }

    // Send Telegram alert if any
    if (alerts.length > 0) {
      try {
        const { notifyAdmin } = await import("./telegram-router");
        const msg = `⚠️ <b>System Alert</b>\n\n${alerts.join("\n")}`;
        await notifyAdmin(msg);
      } catch { /* Telegram not configured */ }
    }

    return { alerts, checked: new Date().toISOString() };
  }),

  /** Grouped errors — deduplicated by message+path with count and severity */
  groupedErrors: superAdminQuery
    .input(z.object({ minutes: z.number().optional() }).optional())
    .query(({ input }) => {
      return getGroupedErrors({ since: Date.now() - (input?.minutes ?? 60) * 60_000 });
    }),

  /** Error trend — error counts per minute for the last N minutes */
  errorTrend: superAdminQuery
    .input(z.object({ minutes: z.number().optional() }).optional())
    .query(({ input }) => {
      return getErrorTrend(input?.minutes ?? 60);
    }),

  /** Quick action: clear cache */
  clearCache: superAdminQuery.mutation(() => {
    cache.clear();
    return { success: true, message: "Cache cleared" };
  }),

  /** Quick action: purge old errors from memory */
  purgeErrors: superAdminQuery.mutation(() => {
    return purgeOldErrors(100);
  }),

  /** Quick action: DB health check */
  dbHealth: superAdminQuery.query(async ({ ctx }) => {
    try {
      const start = Date.now();
      const db = ctx.db;
      await db.execute(sql`SELECT 1`);
      const ms = Date.now() - start;
      return { healthy: true, responseMs: ms };
    } catch (e) {
      return { healthy: false, error: String(e) };
    }
  }),
});

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}д`);
  if (h > 0) parts.push(`${h}ч`);
  if (m > 0) parts.push(`${m}м`);
  parts.push(`${s}с`);
  return parts.join(" ");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
