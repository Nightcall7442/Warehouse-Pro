import { settings } from "@db/schema";
import { eq } from "drizzle-orm";
import { sanitizeString, isSafeUrl } from "../lib/sanitize";
import { cache, CacheKeys, CacheTTL } from "../lib/cache";

type DrizzleInstance = ReturnType<typeof import("../queries/connection").getDb>;

export interface SettingsUpdateInput {
  companyName?: string;
  currency?: string;
  currencySymbol?: string;
  symbolPosition?: "before" | "after";
  defaultReorderPoint?: string;
  lowStockThreshold?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyInn?: string;
  companyDirector?: string;
  companyBank?: string;
  companyBankAccount?: string;
  companyMfo?: string;
  logoUrl?: string | null;
}

export const SettingsService = {
  async get(db: DrizzleInstance, tenantId: number) {
    const cacheKey = CacheKeys.tenantSettings(tenantId);
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const [row] = await db.select({
      id: settings.id,
      tenantId: settings.tenantId,
      companyName: settings.companyName,
      currency: settings.currency,
      currencySymbol: settings.currencySymbol,
      symbolPosition: settings.symbolPosition,
      defaultReorderPoint: settings.defaultReorderPoint,
      lowStockThreshold: settings.lowStockThreshold,
      companyAddress: settings.companyAddress,
      companyPhone: settings.companyPhone,
      companyInn: settings.companyInn,
      companyDirector: settings.companyDirector,
      companyBank: settings.companyBank,
      companyBankAccount: settings.companyBankAccount,
      companyMfo: settings.companyMfo,
      logoUrl: settings.logoUrl,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    })
      .from(settings)
      .where(eq(settings.tenantId, tenantId))
      .limit(1);

    const result = row ?? null;
    cache.set(cacheKey, result, CacheTTL.settings);
    return result;
  },

  async update(db: DrizzleInstance, tenantId: number, data: SettingsUpdateInput) {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === "logoUrl" && typeof value === "string") {
        sanitized[key] = isSafeUrl(value) ? value : null;
      } else if (typeof value === "string") {
        sanitized[key] = sanitizeString(value);
      } else {
        sanitized[key] = value;
      }
    }

    const [existing] = await db.select().from(settings)
      .where(eq(settings.tenantId, tenantId)).limit(1);

    if (existing) {
      await db.update(settings)
        .set({ ...sanitized, updatedAt: new Date() })
        .where(eq(settings.tenantId, tenantId));
    } else {
      await db.insert(settings).values({ tenantId, ...sanitized });
    }

    cache.invalidatePrefix(`settings:${tenantId}`);
    return { success: true };
  },
};
