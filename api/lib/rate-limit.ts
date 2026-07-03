/**
 * In-process sliding window rate limiter.
 * No external dependency — uses a Map<ip, timestamps[]>.
 *
 * TODO: For multi-instance deployments, replace with Redis (ioredis + sliding window script).
 * The in-memory store is not shared across instances, making rate limits ineffective
 * behind a load balancer with multiple backend pods.
 *
 * Rate limiting is applied at two levels:
 * 1. Global: 120 requests/minute per IP (applied to all authenticated endpoints)
 * 2. Namespace-specific: per-endpoint limits (login: 20/15min, mutations: varies)
 */

type Entry = { timestamps: number[] };

const store = new Map<string, Entry>();

// Trusted proxy count: number of trusted reverse proxies in front of this server.
// Only the last N hops in X-Forwarded-For are trusted. Set to 0 to disable trust.
const TRUSTED_PROXY_COUNT = parseInt(process.env.TRUSTED_PROXY_COUNT ?? "1", 10);

// Prune old entries every 10 minutes to avoid memory growth
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}, 10 * 60 * 1000);

export type RateLimitOptions = {
  /** Window size in milliseconds */
  windowMs: number;
  /** Max requests allowed per window */
  limit: number;
  /** Key to namespace this limiter (e.g. "login", "register") */
  namespace: string;
};

/**
 * Returns true if the request is allowed, false if it should be blocked.
 * Call this at the start of sensitive mutations.
 */
export function checkRateLimit(ip: string, opts: RateLimitOptions): boolean {
  const key     = `${opts.namespace}:${ip}`;
  const now     = Date.now();
  const cutoff  = now - opts.windowMs;
  const entry   = store.get(key) ?? { timestamps: [] };

  // Slide the window — drop timestamps older than windowMs
  entry.timestamps = entry.timestamps.filter(t => t > cutoff);

  if (entry.timestamps.length >= opts.limit) {
    store.set(key, entry);
    return false; // blocked
  }

  entry.timestamps.push(now);
  store.set(key, entry);
  return true; // allowed
}

/** Extract the real client IP from Hono/Node request headers.
 *  Respects TRUSTED_PROXY_COUNT: only the last N entries in X-Forwarded-For
 *  are trusted to prevent client spoofing. */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded && TRUSTED_PROXY_COUNT > 0) {
    const parts = forwarded.split(",").map(p => p.trim()).filter(Boolean);
    const idx = Math.max(0, parts.length - TRUSTED_PROXY_COUNT);
    return parts[idx] ?? "unknown";
  }
  return (
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}
