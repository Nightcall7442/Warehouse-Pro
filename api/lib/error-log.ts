/**
 * Persistent error log with file-based storage.
 * Stores recent errors with full context for debugging.
 * Writes to error-log.jsonl (append-only JSON Lines) for persistence across restarts.
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync, renameSync, statSync } from "fs";
import { join } from "path";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import type { TRPCError } from "@trpc/server";

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
          // Static import: this module is ESM, so a `require()` here threw
          // ReferenceError into the catch below and rotation never happened.
          renameSync(LOG_FILE, LOG_FILE + "." + Date.now());
        }
      }
    } catch { /* rotation best-effort */ }
    appendFileSync(LOG_FILE, JSON.stringify(full) + "\n");
  } catch { /* ignore write errors */ }

  return full;
}

// ── tRPC error classification ────────────────────────────────────────────────
// One expired session used to surface as three "500 UNAUTHORIZED" entries in the
// monitoring feed, because the tRPC onError handler hard-coded statusCode 500 and
// method "POST" for every error. The feed exists to make genuine server faults
// visible, so expected client conditions (401/403/404/400/429) must not compete
// with them for attention — but they still need to be observable, otherwise an
// auth outage or a credential-stuffing burst becomes invisible instead of noisy.

/** Recorded when a request carries no usable HTTP method (batched/internal calls). */
export const UNKNOWN_METHOD = "UNKNOWN";

export interface TrpcErrorClassification {
  /** HTTP status derived from the tRPC error code: UNAUTHORIZED → 401, etc. */
  statusCode: number;
  /** The request's real HTTP verb, upper-cased, or {@link UNKNOWN_METHOD}. */
  method: string;
  /** 5xx — a genuine server fault: error log + logger.error + Sentry. */
  isServerFault: boolean;
  /** 4xx — an expected client condition: counted and warned, never in the feed. */
  isClientError: boolean;
}

/**
 * Derive HTTP status and severity for a tRPC error, plus the request's real
 * method. Pure — safe to call from anywhere and to unit-test on its own.
 */
export function classifyTrpcError(opts: {
  /** Anything carrying a tRPC error `code` (a real `TRPCError` in production). */
  error: Pick<TRPCError, "code">;
  /** `req.method` from the onError payload; absent on non-HTTP transports. */
  method?: string | null;
}): TrpcErrorClassification {
  const statusCode = getHTTPStatusCodeFromError(opts.error as TRPCError);
  const method = opts.method?.trim().toUpperCase() || UNKNOWN_METHOD;

  return {
    statusCode,
    method,
    isServerFault: statusCode >= 500,
    isClientError: statusCode >= 400 && statusCode < 500,
  };
}

export interface ClientIssueCount {
  code: string;
  path: string;
  statusCode: number;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

const MAX_CLIENT_ISSUE_KEYS = 200;
const clientIssues = new Map<string, ClientIssueCount>();

/**
 * Count a 4xx client condition without writing it to the error feed.
 *
 * This is the "not silently discarded" half of the classification: a spike of
 * UNAUTHORIZED on `auth.me` (session outage) or of TOO_MANY_REQUESTS on
 * `auth.login` (brute force) is still countable here, while the error list stays
 * reserved for faults an engineer has to fix.
 */
export function recordClientIssue(issue: {
  code: string;
  path: string;
  statusCode: number;
}): ClientIssueCount {
  const key = `${issue.statusCode}:${issue.code}:${issue.path}`;
  const now = Date.now();
  const existing = clientIssues.get(key);

  if (existing) {
    existing.count += 1;
    existing.lastSeen = now;
    return existing;
  }

  const created: ClientIssueCount = { ...issue, count: 1, firstSeen: now, lastSeen: now };
  // Bounded: drop the least recently seen key rather than grow without limit.
  if (clientIssues.size >= MAX_CLIENT_ISSUE_KEYS) {
    let oldestKey: string | undefined;
    let oldestSeen = Infinity;
    for (const [k, v] of clientIssues) {
      if (v.lastSeen < oldestSeen) { oldestSeen = v.lastSeen; oldestKey = k; }
    }
    if (oldestKey) clientIssues.delete(oldestKey);
  }
  clientIssues.set(key, created);
  return created;
}

/** Counted 4xx conditions, most frequent first. Never part of {@link getErrors}. */
export function getClientIssues(opts?: { since?: number; limit?: number }): ClientIssueCount[] {
  const since = opts?.since;
  const limit = opts?.limit ?? 50;
  return Array.from(clientIssues.values())
    .filter((i) => since === undefined || i.lastSeen > since)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((i) => ({ ...i }));
}

/** Test seam — clears the client-issue counters. */
export function resetClientIssues(): void {
  clientIssues.clear();
}

/**
 * Route a tRPC error to the right sink and report what it was.
 *
 * 5xx → the error feed ({@link logError}), so it keeps showing up for triage.
 * 4xx → the client-issue counters ({@link recordClientIssue}) only.
 *
 * The caller stays responsible for `logger`/Sentry, using the returned
 * classification: `logger.error` + Sentry for a server fault, a lower level for
 * a client condition.
 */
export function logTrpcError(opts: {
  error: Pick<TRPCError, "code" | "message"> & { cause?: unknown };
  path?: string | null;
  method?: string | null;
}): TrpcErrorClassification & { entry?: ErrorEntry } {
  const classification = classifyTrpcError({ error: opts.error, method: opts.method });
  const path = opts.path ?? "unknown";

  if (!classification.isServerFault) {
    recordClientIssue({ code: opts.error.code, path, statusCode: classification.statusCode });
    return classification;
  }

  const entry = logError({
    message: opts.error.message,
    code: opts.error.code,
    path,
    method: classification.method,
    statusCode: classification.statusCode,
    stack: opts.error.cause instanceof Error ? opts.error.cause.stack : undefined,
  });

  return { ...classification, entry };
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
