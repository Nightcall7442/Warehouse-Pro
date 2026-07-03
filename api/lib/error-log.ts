/**
 * In-memory error log with detail capture.
 * Stores recent errors with full context for debugging.
 */

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

const MAX_ERRORS = 200;
const errors: ErrorEntry[] = [];

let errorCounter = 0;

export function logError(entry: Omit<ErrorEntry, "id" | "timestamp">): ErrorEntry {
  const full: ErrorEntry = {
    id: `err_${Date.now()}_${++errorCounter}`,
    timestamp: Date.now(),
    ...entry,
  };
  errors.unshift(full);
  if (errors.length > MAX_ERRORS) errors.pop();
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
