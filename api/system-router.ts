import { z } from "zod";
import { createRouter, superAdminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { cache } from "./lib/cache";
import { sseBus } from "./lib/sse";
import { getMetricsSummary } from "./lib/metrics";
import { env } from "./lib/env";
import { sql } from "drizzle-orm";
import { getReqStats, getAllSeries, recordRequestPoint } from "./lib/timeseries";
import { getErrors, getErrorById, getErrorStats } from "./lib/error-log";

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
  status: superAdminQuery.query(async () => {
    const uptime = Math.floor(process.uptime());
    const mem = process.memoryUsage();

    // DB health + response time
    let dbHealthy = false;
    let dbResponseMs = 0;
    try {
      const dbStart = Date.now();
      const db = getDb();
      await db.execute(sql`SELECT 1`);
      dbResponseMs = Date.now() - dbStart;
      dbHealthy = true;
    } catch {
      dbHealthy = false;
    }

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
