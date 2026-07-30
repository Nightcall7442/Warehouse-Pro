/**
 * Persistent error log with file-based storage.
 * Stores recent errors with full context for debugging.
 * Writes to error-log.jsonl (append-only JSON Lines) for persistence across restarts.
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync, statSync } from "fs";
import { join } from "path";

export interface ErrorEntry {
  id: string;
  timestamp: number;
  message: string;
  code: string;
  path: string;
  method: string;
  statusCode: number;
  correlationId?: string;
  userId?: number;
  tenantId?: number;
  ip?: string;
  stack?: string;
  duration?: number;
  meta?: Record<string, unknown>;
}

const MAX_ERRORS = 500;
const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB rotation threshold
const LOG_DIR = join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "error-log.jsonl");

// In-memory cache for fast reads
let errors: ErrorEntry[] = [];
let errorCounter = 0;

// Load existing errors from file on startup
function loadErrors(): void {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    if (existsSync(LOG_FILE)) {
      const data = readFileSync(LOG_FILE, "utf-8").trim();
      if (data) {
        const lines = data.split("\n").filter(Boolean);
        errors = lines.slice(-MAX_ERRORS).map((line) => JSON.parse(line));
      }
    }
  } catch { /* ignore load errors */ }
}

loadErrors();

export function logError(entry: Omit<ErrorEntry, "id" | "timestamp">): ErrorEntry {
  const full: ErrorEntry = {
    id: `err_${Date.now()}_${++errorCounter}`,
    timestamp: Date.now(),
    ...entry,
  };

  // In-memory cache
  errors.unshift(full);
  if (errors.length > MAX_ERRORS) errors.pop();

  // P1-12 FIX: Add log rotation to prevent unbounded growth
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    // Rotate if file exceeds threshold
    try {
      if (existsSync(LOG_FILE)) {
        const stats = statSync(LOG_FILE);
        if (stats.size > MAX_LOG_SIZE_BYTES) {
          const rotated = LOG_FILE + "." + Date.now();
          const { renameSync } = require("fs");
          renameSync(LOG_FILE, rotated);
        }
      }
    } catch { /* rotation best-effort */ }
    appendFileSync(LOG_FILE, JSON.stringify(full) + "\n");
  } catch { /* ignore write errors */ }

  return full;
}

export function getErrors(opts?: {
  limit?: number;
  offset?: number;
  code?: string;
  path?: string;
  since?: number;
}): { errors: ErrorEntry[]; total: number } {
  let filtered = errors;

  if (opts?.code) {
    filtered = filtered.filter((e) => e.code === opts.code);
  }
  if (opts?.path) {
    filtered = filtered.filter((e) => e.path.includes(opts.path!));
  }
  if (opts?.since) {
    filtered = filtered.filter((e) => e.timestamp > opts.since!);
  }

  const total = filtered.length;
  const offset = opts?.offset ?? 0;
  const limit = opts?.limit ?? 50;

  return {
    errors: filtered.slice(offset, offset + limit),
    total,
  };
}

export function getErrorById(id: string): ErrorEntry | undefined {
  return errors.find((e) => e.id === id);
}

/** Grouped errors — deduplicated by message+path, with count and severity */
export function getGroupedErrors(opts?: { since?: number; limit?: number }): Array<{
  key: string; message: string; path: string; code: string; statusCode: number;
  count: number; severity: "critical" | "warning" | "info";
  firstSeen: number; lastSeen: number; sampleId: string;
}> {
  const since = opts?.since ?? Date.now() - 60 * 60_000; // default 1 hour
  const limit = opts?.limit ?? 50;
  const recent = errors.filter(e => e.timestamp > since);

  const groups = new Map<string, { message: string; path: string; code: string; statusCode: number; count: number; firstSeen: number; lastSeen: number; sampleId: string }>();
  for (const e of recent) {
    const key = `${e.statusCode}:${e.path}:${e.message}`.slice(0, 200);
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      if (e.timestamp < existing.firstSeen) existing.firstSeen = e.timestamp;
      if (e.timestamp > existing.lastSeen) { existing.lastSeen = e.timestamp; existing.sampleId = e.id; }
    } else {
      groups.set(key, { message: e.message, path: e.path, code: e.code, statusCode: e.statusCode, count: 1, firstSeen: e.timestamp, lastSeen: e.timestamp, sampleId: e.id });
    }
  }

  return Array.from(groups.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(g => ({
      ...g,
      key: `${g.statusCode}:${g.path}:${g.message}`.slice(0, 200),
      severity: g.statusCode >= 500 ? "critical" as const : g.statusCode >= 400 ? "warning" as const : "info" as const,
    }));
}

/** Error trend — error counts per minute for the last N minutes */
export function getErrorTrend(minutes: number = 60): Array<{ minute: string; count: number }> {
  const now = Date.now();
  const buckets = new Map<string, number>();

  // Initialize all minutes to 0
  for (let i = minutes - 1; i >= 0; i--) {
    const t = new Date(now - i * 60_000);
    const key = `${t.getHours().toString().padStart(2, "0")}:${t.getMinutes().toString().padStart(2, "0")}`;
    buckets.set(key, 0);
  }

  // Fill in actual counts
  const since = now - minutes * 60_000;
  for (const e of errors) {
    if (e.timestamp < since) continue;
    const t = new Date(e.timestamp);
    const key = `${t.getHours().toString().padStart(2, "0")}:${t.getMinutes().toString().padStart(2, "0")}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return Array.from(buckets.entries()).map(([minute, count]) => ({ minute, count }));
}

/** Purge old errors from memory (keeps file intact) */
export function purgeOldErrors(keepLastN: number = 100): { purged: number; remaining: number } {
  const before = errors.length;
  errors = errors.slice(0, keepLastN);
  return { purged: before - errors.length, remaining: errors.length };
}

export function getErrorStats() {
  const now = Date.now();
  const last5m = errors.filter((e) => e.timestamp > now - 5 * 60_000);
  const last1h = errors.filter((e) => e.timestamp > now - 60 * 60_000);

  // Group by code
  const byCode: Record<string, number> = {};
  for (const e of last1h) {
    byCode[e.code] = (byCode[e.code] ?? 0) + 1;
  }

  // Group by path
  const byPath: Record<string, number> = {};
  for (const e of last1h) {
    const path = e.path.split("?")[0];
    byPath[path] = (byPath[path] ?? 0) + 1;
  }

  // Group by status
  const byStatus: Record<string, number> = {};
  for (const e of last1h) {
    const bucket = `${Math.floor(e.statusCode / 100)}xx`;
    byStatus[bucket] = (byStatus[bucket] ?? 0) + 1;
  }

  return {
    total: errors.length,
    last5m: last5m.length,
    last1h: last1h.length,
    byCode,
    byPath: Object.entries(byPath)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([path, count]) => ({ path, count })),
    byStatus,
  };
}
