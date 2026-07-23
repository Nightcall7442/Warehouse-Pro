import { z } from "zod";
import { createRouter, adminQuery, authedQuery, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { settings } from "@db/schema";
import { eq } from "drizzle-orm";
import { cache, CacheKeys, CacheTTL } from "./lib/cache";
import { sanitizeString, isSafeUrl } from "./lib/sanitize";

export const settingsRouter = createRouter({
  get: authedQuery.query(async ({ ctx }) => {
    const cacheKey = CacheKeys.tenantSettings(ctx.tenant.id);
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const [row] = await getDb().select({
      id: settings.id, tenantId: settings.tenantId, companyName: settings.companyName,
      currency: settings.currency, currencySymbol: settings.currencySymbol,
      symbolPosition: settings.symbolPosition, defaultReorderPoint: settings.defaultReorderPoint,
      lowStockThreshold: settings.lowStockThreshold, companyAddress: settings.companyAddress,
      companyPhone: settings.companyPhone, companyInn: settings.companyInn,
      companyDirector: settings.companyDirector, companyBank: settings.companyBank,
      companyBankAccount: settings.companyBankAccount, companyMfo: settings.companyMfo,
      logoUrl: settings.logoUrl, createdAt: settings.createdAt, updatedAt: settings.updatedAt,
    }).from(settings).where(eq(settings.tenantId, ctx.tenant.id)).limit(1);
    const result = row ?? null;
    cache.set(cacheKey, result, CacheTTL.settings);
    return result;
  }),

  // Branding endpoint — lightweight, cached, public (needed before login)
  branding: publicQuery.query(async ({ ctx }) => {
    // For public access, return default branding (tenant-specific branding requires auth)
    return { companyName: "Warehouse Pro", logoUrl: null, currency: "UZS", currencySymbol: "сум" };
  }),

  // Authenticated branding — returns tenant-specific branding
  brandingAuth: authedQuery.query(async ({ ctx }) => {
    const cacheKey = CacheKeys.tenantSettings(ctx.tenant.id) + ":branding";
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const [row] = await getDb().select({
      companyName: settings.companyName,
      logoUrl: settings.logoUrl,
      currency: settings.currency,
      currencySymbol: settings.currencySymbol,
    }).from(settings).where(eq(settings.tenantId, ctx.tenant.id)).limit(1);
    const result = row ?? { companyName: "Warehouse Pro", logoUrl: null, currency: "UZS", currencySymbol: "сум" };
    cache.set(cacheKey, result, CacheTTL.branding);
    return result;
  }),

  update: adminQuery
    .input(z.object({
      companyName:         z.string().min(1).max(255).optional(),
      currency:            z.string().max(10).optional(),
      currencySymbol:      z.string().max(10).optional(),
      symbolPosition:      z.enum(["before", "after"]).optional(),
      defaultReorderPoint: z.string().optional(),
      lowStockThreshold:   z.string().optional(),
      companyAddress:      z.string().nullable().optional(),
      companyPhone:        z.string().max(50).nullable().optional(),
      companyInn:          z.string().nullable().optional(),
      companyDirector:     z.string().nullable().optional(),
      companyBank:         z.string().nullable().optional(),
      companyBankAccount:  z.string().nullable().optional(),
      companyMfo:          z.string().nullable().optional(),
      logoUrl:             z.string().optional().nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db       = getDb();
      const tenantId = ctx.tenant.id;

      // Sanitize string inputs
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input)) {
        if (key === "logoUrl" && typeof value === "string") {
          sanitized[key] = isSafeUrl(value) ? value : null;
        } else if (typeof value === "string") {
          sanitized[key] = sanitizeString(value);
        } else {
          sanitized[key] = value;
        }
      }

      await db.transaction(async (tx) => {
        const [existing] = await tx.select().from(settings).where(eq(settings.tenantId, tenantId)).limit(1);
        if (existing) {
          await tx.update(settings).set({ ...sanitized, updatedAt: new Date() }).where(eq(settings.tenantId, tenantId));
        } else {
          await tx.insert(settings).values({ tenantId, ...sanitized });
        }
      });

      // Invalidate all settings caches for this tenant
      cache.invalidatePrefix(`settings:${tenantId}`);

      return { success: true };
    }),
});
