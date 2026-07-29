import { getRedis, isRedisAvailable } from "./redis";

type Entry = { timestamps: number[] };

const store = new Map<string, Entry>();

const TRUSTED_PROXY_COUNT = parseInt(process.env.TRUSTED_PROXY_COUNT ?? "0", 10);

setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}, 10 * 60 * 1000);

export type RateLimitOptions = {
  windowMs: number;
  limit: number;
  namespace: string;
};

/**
 * Returns true if the request is allowed, false if blocked.
 * Uses Redis sorted sets when available, in-memory fallback otherwise.
 */
export async function checkRateLimit(ip: string, opts: RateLimitOptions): Promise<boolean> {
  if (isRedisAvailable()) {
    return checkRateLimitRedis(ip, opts);
  }
  return checkRateLimitMemory(ip, opts);
}

function checkRateLimitMemory(ip: string, opts: RateLimitOptions): boolean {
  const key     = `${opts.namespace}:${ip}`;
  const now     = Date.now();
  const cutoff  = now - opts.windowMs;
  const entry   = store.get(key) ?? { timestamps: [] };

  entry.timestamps = entry.timestamps.filter(t => t > cutoff);

  if (entry.timestamps.length >= opts.limit) {
    store.set(key, entry);
    return false;
  }

  entry.timestamps.push(now);
  store.set(key, entry);
  return true;
}

async function checkRateLimitRedis(ip: string, opts: RateLimitOptions): Promise<boolean> {
  try {
    const key = `ratelimit:${opts.namespace}:${ip}`;
    const now = Date.now();
    const windowSeconds = Math.ceil(opts.windowMs / 1000);
    const cutoff = now - opts.windowMs;

    const redis = getRedis();
    const multi = redis.multi();

    // Remove old entries outside the window
    multi.zremrangebyscore(key, 0, cutoff);
    // Count entries in window
    multi.zcard(key);
    // Add current entry
    multi.zadd(key, now, `${now}:${Math.random()}`);
    // Set TTL on the key
    multi.expire(key, windowSeconds * 2);

    // P0-5 FIX: ioredis multi.exec() returns a Promise, not an array
    const results = await multi.exec();
    if (!results) return checkRateLimitMemory(ip, opts);

    const count = Number(results[1]?.[1] ?? 0);
    return count < opts.limit;
  } catch {
    return checkRateLimitMemory(ip, opts);
  }
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded && TRUSTED_PROXY_COUNT > 0) {
    const parts = forwarded.split(",").map(p => p.trim()).filter(Boolean);
    const idx = Math.max(0, parts.length - TRUSTED_PROXY_COUNT);
    return parts[idx] ?? "unknown";
  }
  // P0-4 FIX: Only trust x-real-ip when TRUSTED_PROXY_COUNT > 0 (reverse proxy configured).
  // Otherwise fall back to "unknown" to prevent client-side header spoofing.
  if (TRUSTED_PROXY_COUNT > 0) {
    return req.headers.get("x-real-ip") ?? "unknown";
  }
  return "unknown";
}

/**
 * Check rate limit asynchronously (for use in non-blocking contexts).
 */
export async function checkRateLimitAsync(ip: string, opts: RateLimitOptions): Promise<boolean> {
  return checkRateLimit(ip, opts);
}
