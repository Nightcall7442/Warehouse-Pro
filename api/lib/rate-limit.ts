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
 *
 * `key` identifies whose quota is being spent. A null key means the caller
 * could not identify the subject at all; see rateLimitSubject for why that
 * has to mean "no limit" rather than "everybody shares one".
 */
export async function checkRateLimit(key: string | null, opts: RateLimitOptions): Promise<boolean> {
  if (key === null) return true;
  if (isRedisAvailable()) {
    return checkRateLimitRedis(key, opts);
  }
  return checkRateLimitMemory(key, opts);
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
 * The caller's IP, or null when nothing trustworthy identifies them.
 *
 * x-forwarded-for is client-supplied unless a reverse proxy is known to
 * rewrite it, so it is only read when TRUSTED_PROXY_COUNT says how many hops
 * to skip from the right. Without that, there is no answer — and null is the
 * honest way to say so. Returning a constant like "unknown" instead is what
 * broke every limiter in this codebase: see rateLimitSubject.
 */
export function getClientIp(req: Request): string | null {
  if (TRUSTED_PROXY_COUNT <= 0) return null;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map(p => p.trim()).filter(Boolean);
    const idx = Math.max(0, parts.length - TRUSTED_PROXY_COUNT);
    return parts[idx] ?? null;
  }
  return req.headers.get("x-real-ip");
}

/**
 * Which bucket a request counts against.
 *
 * getClientIp returns null whenever TRUSTED_PROXY_COUNT is unset — which is
 * the default, and was the deployed state. The previous code turned that null
 * into the literal string "unknown" and used it as the bucket key, so every
 * unidentified caller became the *same* caller. One counter then held the
 * entire platform: authedQuery's 120-requests-per-minute covered all users of
 * all tenants at once, and /api/login's twenty attempts per fifteen minutes
 * could be spent by anyone, locking everybody else out. A limit that cannot
 * tell two callers apart does not restrain an attacker — it only hands them a
 * switch that turns the product off for everyone.
 *
 * So: prefer a subject the server actually knows (a user id, an email, a
 * token), fall back to the IP when a proxy is configured, and otherwise return
 * null so checkRateLimit skips instead of pretending. Skipping loses nothing
 * that was ever really there.
 */
export function rateLimitSubject(req: Request, subject?: string | null): string | null {
  return subject || getClientIp(req);
}

/**
 * Check rate limit asynchronously (for use in non-blocking contexts).
 */
export async function checkRateLimitAsync(ip: string, opts: RateLimitOptions): Promise<boolean> {
  return checkRateLimit(ip, opts);
}
