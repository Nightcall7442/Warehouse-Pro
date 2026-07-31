import { logger } from "./logger";
import { getRedis, isRedisAvailable } from "./redis";

type Entry = { timestamps: number[] };

const store = new Map<string, Entry>();

/**
 * How many reverse proxies sit in front of the app. Read per call rather than at
 * import time so it survives dotenv loading order and can be exercised in tests.
 */
function trustedProxyCount(): number {
  const parsed = parseInt(process.env.TRUSTED_PROXY_COUNT ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

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

/**
 * FIX: P0.2 — socket peer address per in-flight request.
 *
 * `Request` carries no connection info, so the HTTP layer records the TCP peer
 * address here (see `rememberSocketIp` in boot.ts). Keyed weakly: entries go away
 * with the request object, nothing to clean up.
 */
const socketIpByRequest = new WeakMap<Request, string>();

/** Strip the IPv4-mapped IPv6 prefix so ::ffff:1.2.3.4 and 1.2.3.4 share a bucket. */
function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  return trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
}

/** Called once per request by the HTTP layer with the TCP peer address. */
export function rememberSocketIp(req: Request, ip: string | undefined | null): void {
  if (ip) socketIpByRequest.set(req, normalizeIp(ip));
}

/**
 * Warn when rate limiting has no usable client identity in production.
 * Called at startup so a misconfigured deployment is visible in the logs.
 */
export function warnIfClientIpUnavailable(): void {
  if (trustedProxyCount() === 0 && process.env.NODE_ENV === "production") {
    logger.warn(
      "TRUSTED_PROXY_COUNT=0: proxy headers are ignored and rate limiting falls back to the socket address. " +
      "Set TRUSTED_PROXY_COUNT to the number of reverse proxies in front of the app, otherwise every client " +
      "behind that proxy shares one rate-limit bucket.",
    );
  }
}

export function getClientIp(req: Request): string {
  const trusted = trustedProxyCount();

  // P0-4 FIX: Only trust proxy headers when TRUSTED_PROXY_COUNT > 0 (reverse proxy
  // configured). Otherwise they are attacker-controlled and must be ignored.
  if (trusted > 0) {
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) {
      const parts = forwarded.split(",").map(p => p.trim()).filter(Boolean);
      const idx = Math.max(0, parts.length - trusted);
      const hop = parts[idx];
      if (hop) return normalizeIp(hop);
    }
    const realIp = req.headers.get("x-real-ip");
    if (realIp) return normalizeIp(realIp);
  }

  // FIX: P0.2 — without a trusted proxy, fall back to the TCP peer address instead
  // of lumping every request into a single "unknown" bucket, which disabled rate
  // limiting entirely on the default configuration.
  return socketIpByRequest.get(req) ?? "unknown";
}

/**
 * Check rate limit asynchronously (for use in non-blocking contexts).
 */
export async function checkRateLimitAsync(ip: string, opts: RateLimitOptions): Promise<boolean> {
  return checkRateLimit(ip, opts);
}
