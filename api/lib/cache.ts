import { getRedis, isRedisAvailable } from "./redis";

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type CacheStats = {
  hits: number;
  misses: number;
  size: number;
};

class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private stats: CacheStats = { hits: 0, misses: 0, size: 0 };
  private maxEntries: number;
  private defaultTtlMs: number;
  private pruneInterval: ReturnType<typeof setInterval> | null = null;

  constructor(opts?: { maxEntries?: number; defaultTtlMs?: number }) {
    this.maxEntries = opts?.maxEntries ?? 1000;
    this.defaultTtlMs = opts?.defaultTtlMs ?? 60_000;
    this.pruneInterval = setInterval(() => this.prune(), 2 * 60 * 1000);
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.stats.size--;
      this.stats.misses++;
      return undefined;
    }
    this.stats.hits++;
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
        this.stats.size--;
      }
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
    this.stats.size = this.store.size;
  }

  invalidate(key: string): boolean {
    const existed = this.store.delete(key);
    if (existed) this.stats.size--;
    return existed;
  }

  invalidatePrefix(prefix: string): number {
    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count++;
      }
    }
    this.stats.size = this.store.size;
    return count;
  }

  getStats(): CacheStats & { hitRate: string } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? `${((this.stats.hits / total) * 100).toFixed(1)}%` : "N/A",
    };
  }

  clear(): void {
    this.store.clear();
    this.stats = { hits: 0, misses: 0, size: 0 };
  }

  destroy(): void {
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = null;
    }
    this.clear();
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
    this.stats.size = this.store.size;
  }
}

/**
 * Unified cache: uses in-memory store for synchronous operations
 * and lazily populates Redis in the background when available.
 *
 * All sync methods (get/set/invalidate) work identically to the
 * original MemoryCache — no changes needed in callers.
 * Redis is used as a secondary cache for multi-instance scenarios.
 */
class UnifiedCache {
  private memory: MemoryCache;

  constructor() {
    this.memory = new MemoryCache({
      maxEntries: parseInt(process.env.CACHE_MAX_ENTRIES ?? "500", 10),
      defaultTtlMs: parseInt(process.env.CACHE_DEFAULT_TTL_MS ?? "60000", 10),
    });
    // Warm Redis from memory on startup (best-effort)
  }

  // ── Sync API (backward compatible, always uses in-memory) ──

  get<T>(key: string): T | undefined {
    return this.memory.get<T>(key);
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    this.memory.set(key, value, ttlMs);
    // Fire-and-forget: also set in Redis if available
    if (isRedisAvailable()) {
      this.setRedis(key, value, ttlMs).catch(() => {});
    }
  }

  invalidate(key: string): boolean {
    const result = this.memory.invalidate(key);
    if (isRedisAvailable()) {
      getRedis().del(key).catch(() => {});
    }
    return result;
  }

  invalidatePrefix(prefix: string): number {
    const count = this.memory.invalidatePrefix(prefix);
    if (isRedisAvailable()) {
      getRedis().keys(`${prefix}*`).then(keys => {
        if (keys.length > 0) getRedis().del(...keys).catch(() => {});
      }).catch(() => {});
    }
    return count;
  }

  clear(): void {
    this.memory.clear();
    if (isRedisAvailable()) {
      const prefixes = new Set<string>();
      for (const keyFn of Object.values(CacheKeys)) {
        try {
          const example = (keyFn as (...args: number[]) => string)(0, 0);
          const prefix = example.split(':')[0];
          if (prefix) prefixes.add(prefix);
        } catch { /* skip */ }
      }
      for (const prefix of prefixes) {
        getRedis().keys(`${prefix}:*`).then(keys => {
          if (keys.length > 0) getRedis().del(...keys).catch(() => {});
        }).catch(() => {});
      }
    }
  }

  // ── Redis-specific helpers ──

  private async setRedis<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    try {
      const ttl = (ttlMs ?? 60000) / 1000;
      await getRedis().setex(key, Math.ceil(ttl), JSON.stringify(value));
    } catch { /* Redis unavailable, ignore */ }
  }

  async getRedisValue<T>(key: string): Promise<T | undefined> {
    if (!isRedisAvailable()) return undefined;
    try {
      const raw = await getRedis().get(key);
      if (raw === null) return undefined;
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  getStats(): CacheStats & { hitRate: string } {
    return this.memory.getStats();
  }

  destroy(): void {
    this.memory.destroy();
  }
}

export const cache = new UnifiedCache();

/**
 * Отдать из кэша или посчитать и запомнить.
 *
 * ── Зачем понадобилось ──────────────────────────────────────────────────────
 *
 * Одиннадцать процедур писали одно и то же:
 *
 *     const cached = cache.get(cacheKey);
 *     if (cached) return cached;
 *     ...
 *     cache.set(cacheKey, result, ttl);
 *     return result;
 *
 * `cache.get<T>()` вызван без аргумента типа, выводить его не из чего, и T
 * становится unknown. Процедура начинает возвращать unknown — а вместе с ней
 * ломается вывод типов на клиенте: `trpc.branding.get.useQuery().data`
 * схлопывается в `{}`, и КАЖДОЕ обращение к полю становится ошибкой
 * компиляции. Отсюда 83 ошибки вида «Property … does not exist on type '{}'»
 * и ещё 29 «неявный any» следом за ними: 112 из 136 накопленных ошибок растут
 * из этих одиннадцати строк.
 *
 * Здесь T выводится из самой функции-производителя, поэтому называть его руками
 * не нужно и забыть нельзя.
 *
 * ── Побочно исправлено ──────────────────────────────────────────────────────
 *
 * Проверка `if (cached)` считала промахом любое ложное значение: закэшированные
 * ноль, пустая строка или false пересчитывались бы каждый раз. Сравнение с
 * undefined отличает «нет в кэше» от «в кэше лежит ноль».
 */
export async function withCache<T>(
  key: string,
  ttlMs: number,
  produce: () => Promise<T>,
): Promise<T> {
  const hit = cache.get<T>(key);
  if (hit !== undefined) return hit;
  const value = await produce();
  cache.set(key, value, ttlMs);
  return value;
}

export const CacheKeys = {
  tenantSettings: (tenantId: number) => `settings:${tenantId}`,
  tenantBranding: (tenantId: number) => `branding:${tenantId}`,
  dashboardKpis: (tenantId: number) => `kpis:${tenantId}`,
  tenantSubscription: (tenantId: number) => `sub:${tenantId}`,
  userList: (tenantId: number, page: number, search?: string, role?: string) =>
    `users:${tenantId}:${page}:${search ?? ""}:${role ?? ""}`,
  userDetail: (tenantId: number, userId: number) => `user:${tenantId}:${userId}`,
  // pageSize belongs in the key. Callers ask for wildly different sizes — a
  // dropdown wants 500, a report wants 10000, the page itself wants 25 — and
  // without it they all collide: whoever loads first decides what everyone
  // else gets for the next three minutes, so a picker that asked for 500
  // silently shows 25 and an item that exists simply cannot be selected.
  productList: (tenantId: number, page: number, pageSize: number, search?: string, category?: string) =>
    `products:${tenantId}:${page}:${pageSize}:${search ?? ""}:${category ?? ""}`,
  productCategories: (tenantId: number) => `product_cats:${tenantId}`,
  /** Оценка магазинов: выручка за всю историю и платёжное поведение. */
  shopScores: (tenantId: number, limit: number) => `shopscores:${tenantId}:${limit}`,

  shopList: (tenantId: number, page: number, pageSize: number, search?: string, city?: string, district?: string, agentId?: number, territoryId?: number, onlyDebtors?: boolean, sortBy?: string) =>
    `shops:${tenantId}:${page}:${pageSize}:${search ?? ""}:${city ?? ""}:${district ?? ""}:${agentId ?? ""}:${territoryId ?? ""}:${onlyDebtors ?? ""}:${sortBy ?? ""}`,
  shopCities: (tenantId: number) => `shop_cities:${tenantId}`,
  shopDistricts: (tenantId: number, city?: string) => `shop_districts:${tenantId}:${city ?? ""}`,
  smartAlerts: (tenantId: number, userId: number) => `alerts:${tenantId}:${userId}`,
  salesTargets: (tenantId: number) => `sales_targets:${tenantId}`,
  commissions: (tenantId: number) => `commissions:${tenantId}`,
  priceLists: (tenantId: number) => `price_lists:${tenantId}`,
  returns: (tenantId: number) => `returns:${tenantId}`,
  reorderAlerts: (tenantId: number) => `reorder:${tenantId}`,
} as const;

export const CacheTTL = {
  settings: 5 * 60 * 1000,
  branding: 10 * 60 * 1000,
  kpis: 2 * 60 * 1000,
  subscription: 5 * 60 * 1000,
  users: 3 * 60 * 1000,
  products: 3 * 60 * 1000,
  shops: 3 * 60 * 1000,
  categories: 10 * 60 * 1000,
  alerts: 1 * 60 * 1000,
} as const;
