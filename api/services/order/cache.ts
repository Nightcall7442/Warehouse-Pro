import { cache, CacheKeys } from "../../lib/cache";

/**
 * Every order write invalidates the same dashboard KPI entry, so the knowledge of
 * *which* entry lives in one place rather than in each lifecycle method.
 */
export function invalidateDashboard(tenantId: number): void {
  cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));
}
