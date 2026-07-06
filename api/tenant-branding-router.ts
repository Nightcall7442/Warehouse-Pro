import { z } from "zod";
import { createRouter, authedQuery, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { tenantBranding } from "@db/schema";
import { eq } from "drizzle-orm";
import { cache, CacheKeys, CacheTTL } from "./lib/cache";
import { sanitizeString, isSafeUrl } from "./lib/sanitize";

function escapeCSS(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/[;{}()]/g, "");
}

function generateCSSVariables(branding: {
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  companyName: string | null;
  appName: string | null;
}): string {
  const primary   = branding.primaryColor ?? "#2563eb";
  const secondary = branding.secondaryColor ?? "#1e40af";
  const accent    = branding.accentColor ?? "#3b82f6";
  const logoUrl   = escapeCSS(branding.logoUrl ?? "");
  const company   = escapeCSS(branding.companyName ?? "Warehouse Pro");
  const app       = escapeCSS(branding.appName ?? "Warehouse Pro");
  return `:root {
  --brand-primary: ${primary};
  --brand-secondary: ${secondary};
  --brand-accent: ${accent};
  --brand-logo-url: url('${logoUrl}');
  --brand-company: '${company}';
  --brand-app: '${app}';
 }`;
}

type BrandingRow = {
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  companyName: string | null;
  appName: string | null;
};

export const tenantBrandingRouter = createRouter({
  /** Get branding for current tenant (cached) */
  get: authedQuery.query(async ({ ctx }) => {
    const cacheKey = CacheKeys.tenantBranding(ctx.tenant.id);
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const db = getDb();
    const [row] = await db.select().from(tenantBranding)
      .where(eq(tenantBranding.tenantId, ctx.tenant.id)).limit(1);

    const result = row ?? {
      primaryColor:   "#2563eb",
      secondaryColor: "#1e40af",
      accentColor:    "#3b82f6",
      logoUrl:        null,
      companyName:    null,
      appName:        "Warehouse Pro",
      supportEmail:   null,
      supportPhone:   null,
    };

    cache.set(cacheKey, result, CacheTTL.branding);
    return result;
  }),

  /** Get CSS variables for current tenant branding */
  cssVariables: authedQuery.query(async ({ ctx }) => {
    const branding = await (async () => {
      const cacheKey = CacheKeys.tenantBranding(ctx.tenant.id);
      const cached = cache.get<BrandingRow>(cacheKey);
      if (cached) return cached;

      const db = getDb();
      const [row] = await db.select().from(tenantBranding)
        .where(eq(tenantBranding.tenantId, ctx.tenant.id)).limit(1);
      return row ?? { primaryColor: "#2563eb", secondaryColor: "#1e40af", accentColor: "#3b82f6", logoUrl: null, companyName: null, appName: "Warehouse Pro" };
    })();

    return {
      css: generateCSSVariables(branding),
      variables: {
        primary:   branding.primaryColor ?? "#2563eb",
        secondary: branding.secondaryColor ?? "#1e40af",
        accent:    branding.accentColor ?? "#3b82f6",
      },
    };
  }),

  /** Update branding (CEO/admin only) */
  update: adminQuery
    .input(z.object({
      logoUrl:        z.string().optional().nullable(),
      primaryColor:   z.string().regex(/^#[0-9a-fA-F]{6}$/, "Цвет должен быть в формате #hex").optional(),
      secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Цвет должен быть в формате #hex").optional(),
      accentColor:    z.string().regex(/^#[0-9a-fA-F]{6}$/, "Цвет должен быть в формате #hex").optional(),
      companyName:    z.string().min(1).max(255).optional(),
      appName:        z.string().min(1).max(255).optional(),
      supportEmail:   z.string().email().optional().nullable(),
      supportPhone:   z.string().max(50).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;

      // Sanitize string inputs
      const data: Record<string, unknown> = {};
      if (input.companyName !== undefined) data.companyName = sanitizeString(input.companyName);
      if (input.appName !== undefined) data.appName = sanitizeString(input.appName);
      if (input.supportEmail !== undefined) data.supportEmail = input.supportEmail;
      if (input.supportPhone !== undefined) data.supportPhone = sanitizeString(input.supportPhone);
      if (input.primaryColor !== undefined) data.primaryColor = input.primaryColor;
      if (input.secondaryColor !== undefined) data.secondaryColor = input.secondaryColor;
      if (input.accentColor !== undefined) data.accentColor = input.accentColor;
      if (input.logoUrl !== undefined) {
        data.logoUrl = input.logoUrl && isSafeUrl(input.logoUrl) ? input.logoUrl : null;
      }

      const [existing] = await db.select().from(tenantBranding)
        .where(eq(tenantBranding.tenantId, tenantId)).limit(1);

      if (existing) {
        await db.update(tenantBranding).set({ ...data, updatedAt: new Date() })
          .where(eq(tenantBranding.tenantId, tenantId));
      } else {
        await db.insert(tenantBranding).values({ tenantId, ...data });
      }

      // Invalidate cache
      cache.invalidate(CacheKeys.tenantBranding(tenantId));

      return { success: true };
    }),

  /** Upload logo (stores as data URL or S3 URL) */
  uploadLogo: adminQuery
    .input(z.object({
      dataUrl: z.string().startsWith("data:image/").max(5_000_000, "Файл слишком большой (макс. 4 МБ)"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;

      const [existing] = await db.select().from(tenantBranding)
        .where(eq(tenantBranding.tenantId, tenantId)).limit(1);

      if (existing) {
        await db.update(tenantBranding).set({ logoUrl: input.dataUrl, updatedAt: new Date() })
          .where(eq(tenantBranding.tenantId, tenantId));
      } else {
        await db.insert(tenantBranding).values({ tenantId, logoUrl: input.dataUrl });
      }

      cache.invalidate(CacheKeys.tenantBranding(tenantId));
      return { success: true, logoUrl: input.dataUrl };
    }),
});
