/**
 * In-memory time-series metrics store.
 * Collects system metrics at regular intervals for charting.
 */

interface DataPoint {
  timestamp: number;
  value: number;
}

interface MetricSeries {
  name: string;
  data: DataPoint[];
  maxValue: number;
}

const MAX_POINTS = 120; // 2 minutes at 1s intervals
const SERIES = new Map<string, MetricSeries>();

// ── Request tracking ─────────────────────────────────────────────────────────
let reqWindow: { ts: number; count: number; errors: number; totalTime: number }[] = [];
const WINDOW_SIZE = 60; // 60-second sliding window

export function recordRequestPoint(responseTimeMs: number, isError: boolean) {
  const now = Date.now();
  const windowKey = Math.floor(now / 1000);

  // Add to current second window
  let current = reqWindow.find((w) => w.ts === windowKey);
  if (!current) {
    current = { ts: windowKey, count: 0, errors: 0, totalTime: 0 };
    reqWindow.push(current);
  }
  current.count++;
  current.totalTime += responseTimeMs;
  if (isError) current.errors++;

  // Trim old windows
  const cutoff = now - WINDOW_SIZE * 1000;
  reqWindow = reqWindow.filter((w) => w.ts * 1000 > cutoff);

  // Record into time-series
  pushPoint("req_per_sec", windowKey * 1000, current.count);
  pushPoint("avg_response_ms", windowKey * 1000, current.count > 0 ? current.totalTime / current.count : 0);
  pushPoint("errors_per_sec", windowKey * 1000, current.errors);
}

function pushPoint(name: string, ts: number, value: number) {
  let series = SERIES.get(name);
  if (!series) {
    series = { name, data: [], maxValue: 0 };
    SERIES.set(name, series);
  }
  // Update last point if same second, else push new
  const last = series.data[series.data.length - 1];
  if (last && Math.abs(last.timestamp - ts) < 1000) {
    last.value = value;
  } else {
    series.data.push({ timestamp: ts, value });
    if (series.data.length > MAX_POINTS) {
      series.data.shift();
    }
  }
  if (value > series.maxValue) series.maxValue = value;
}

// ── Memory tracking ──────────────────────────────────────────────────────────
let memInterval: ReturnType<typeof setInterval> | null = null;

export function startMemoryTracking() {
  if (memInterval) return;
  memInterval = setInterval(() => {
    const mem = process.memoryUsage();
    const ts = Date.now();
    pushPoint("heap_used_mb", ts, Math.round(mem.heapUsed / (1024 * 1024)));
    pushPoint("heap_total_mb", ts, Math.round(mem.heapTotal / (1024 * 1024)));
    pushPoint("rss_mb", ts, Math.round(mem.rss / (1024 * 1024)));
  }, 5000); // every 5 seconds
}

export function stopMemoryTracking() {
  if (memInterval) {
    clearInterval(memInterval);
    memInterval = null;
  }
}

// ── Query API ────────────────────────────────────────────────────────────────
export function getSeries(name: string): MetricSeries | undefined {
  return SERIES.get(name);
}

export function getAllSeries(): Record<string, { data: DataPoint[]; maxValue: number }> {
  const result: Record<string, { data: DataPoint[]; maxValue: number }> = {};
  for (const [name, series] of SERIES) {
    result[name] = { data: series.data, maxValue: series.maxValue };
  }
  return result;
}

// ── Stats helpers ────────────────────────────────────────────────────────────
export function getReqStats() {
  const now = Date.now();
  const cutoff = now - 60_000;
  const recent = reqWindow.filter((w) => w.ts * 1000 > cutoff);

  let total = 0, errors = 0, totalTime = 0;
  for (const w of recent) {
    total += w.count;
    errors += w.errors;
    totalTime += w.totalTime;
  }

  // Percentiles from recent data
  const responseTimes = getSeries("avg_response_ms")?.data ?? [];
  const recentTimes = responseTimes
    .filter((d) => d.timestamp > cutoff)
    .map((d) => d.value)
    .sort((a, b) => a - b);

  const p50 = percentile(recentTimes, 50);
  const p95 = percentile(recentTimes, 95);
  const p99 = percentile(recentTimes, 99);

  return {
    total,
    errors,
    avgResponseTime: total > 0 ? Math.round(totalTime / total) : 0,
    errorRate: total > 0 ? ((errors / total) * 100).toFixed(1) + "%" : "0.0%",
    p50,
    p95,
    p99,
    rps: total > 0 ? (total / Math.min(60, (now - (reqWindow[0]?.ts ?? now)) / 1000 || 1)).toFixed(1) : "0.0",
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// Auto-start memory tracking
startMemoryTracking();
