/**
 * In-memory LRU cache for frequently accessed data.
 * Designed for tenant settings, dashboard KPIs, and other hot paths.
 *
 * For multi-instance deployments, replace with Redis.
 */

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
    this.defaultTtlMs = opts?.defaultTtlMs ?? 60_000; // 1 minute default

    // Periodic cleanup every 2 minutes
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
    // Evict oldest if at capacity
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

  /** Invalidate all keys matching a prefix (e.g., all tenant cache) */
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

/** Singleton cache instance */
export const cache = new MemoryCache({ maxEntries: 500, defaultTtlMs: 60_000 });

/** Cache key builders */
export const CacheKeys = {
  tenantSettings: (tenantId: number) => `settings:${tenantId}`,
  tenantBranding: (tenantId: number) => `branding:${tenantId}`,
  dashboardKpis: (tenantId: number) => `kpis:${tenantId}`,
  tenantSubscription: (tenantId: number) => `sub:${tenantId}`,
  userList: (tenantId: number, page: number, search?: string, role?: string) =>
    `users:${tenantId}:${page}:${search ?? ""}:${role ?? ""}`,
  userDetail: (tenantId: number, userId: number) => `user:${tenantId}:${userId}`,
  productList: (tenantId: number, page: number, search?: string, category?: string) =>
    `products:${tenantId}:${page}:${search ?? ""}:${category ?? ""}`,
  productCategories: (tenantId: number) => `product_cats:${tenantId}`,
  shopList: (tenantId: number, page: number, search?: string, city?: string, district?: string, agentId?: number) =>
    `shops:${tenantId}:${page}:${search ?? ""}:${city ?? ""}:${district ?? ""}:${agentId ?? ""}`,
  shopCities: (tenantId: number) => `shop_cities:${tenantId}`,
  shopDistricts: (tenantId: number, city?: string) => `shop_districts:${tenantId}:${city ?? ""}`,
  smartAlerts: (tenantId: number, userId: number) => `alerts:${tenantId}:${userId}`,
} as const;

/** Cache TTLs in milliseconds */
export const CacheTTL = {
  settings: 5 * 60 * 1000,       // 5 minutes
  branding: 10 * 60 * 1000,      // 10 minutes
  kpis: 2 * 60 * 1000,           // 2 minutes
  subscription: 5 * 60 * 1000,   // 5 minutes
  users: 3 * 60 * 1000,          // 3 minutes
  products: 3 * 60 * 1000,       // 3 minutes
  shops: 3 * 60 * 1000,          // 3 minutes
  categories: 10 * 60 * 1000,    // 10 minutes
  alerts: 1 * 60 * 1000,         // 1 minute
} as const;
