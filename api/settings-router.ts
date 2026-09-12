import { z } from "zod";
import { createRouter, adminQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { settings } from "@db/schema";
import { eq } from "drizzle-orm";
import { cache, withCache, CacheKeys, CacheTTL } from "./lib/cache";
import { sanitizeString, isSafeUrl } from "./lib/sanitize";
import { decimalOrDefault } from "./lib/zod-decimal";
import { LOGO_MAX_CHARS } from "@contracts/image-limits";
import { recordAudit, auditActor, changedFields } from "./services/audit-log";

export const settingsRouter = createRouter({
  get: authedQuery.query(async ({ ctx }) => {
    return withCache(CacheKeys.tenantSettings(ctx.tenant.id), CacheTTL.settings, async () => {
      const [row] = await getDb().select({
        id: settings.id, tenantId: settings.tenantId, companyName: settings.companyName,
      currency: settings.currency, currencySymbol: settings.currencySymbol,
      symbolPosition: settings.symbolPosition, defaultReorderPoint: settings.defaultReorderPoint,
      lowStockThreshold: settings.lowStockThreshold, maxFieldDiscountPct: settings.maxFieldDiscountPct, companyAddress: settings.companyAddress,
      companyPhone: settings.companyPhone, companyInn: settings.companyInn,
      companyDirector: settings.companyDirector, companyBank: settings.companyBank,
      companyBankAccount: settings.companyBankAccount, companyMfo: settings.companyMfo,
      logoUrl: settings.logoUrl, createdAt: settings.createdAt, updatedAt: settings.updatedAt,
      }).from(settings).where(eq(settings.tenantId, ctx.tenant.id)).limit(1);
      return row ?? null;
    });
  }),

  /*
    Здесь была публичная процедура branding, отвечавшая ВСЕМ арендаторам
    жёстко вписанным { companyName: "Warehouse Pro", currency: "UZS",
    currencySymbol: "сум" }. Её звало мобильное приложение — и потому у всех
    арендаторов в приложении стояло имя поставщика системы и сумовая валюта,
    какую бы они ни выбрали.

    Публичной она была не по недосмотру: до входа арендатор неизвестен, и
    отдать его бренд невозможно в принципе. Значит и процедуры быть не
    должно: приложение спрашивает бренд после входа, у brandingAuth ниже.
  */

  // Authenticated branding — returns tenant-specific branding
  brandingAuth: authedQuery.query(async ({ ctx }) => {
    return withCache(CacheKeys.tenantSettings(ctx.tenant.id) + ":branding", CacheTTL.branding, async () => {
      const [row] = await getDb().select({
        companyName: settings.companyName,
        logoUrl: settings.logoUrl,
        currency: settings.currency,
        currencySymbol: settings.currencySymbol,
        // Знак стоит до суммы или после — «$ 1 200» против «1 200 сум».
        // Мобильное приложение теперь берёт валюту отсюда, и без этого поля
        // ему пришлось бы гадать, куда ставить знак.
        symbolPosition: settings.symbolPosition,
      }).from(settings).where(eq(settings.tenantId, ctx.tenant.id)).limit(1);
      return row ?? { companyName: "", logoUrl: null, currency: "UZS", currencySymbol: "сум", symbolPosition: "after" as const };
    });
  }),

  update: adminQuery
    .input(z.object({
      companyName:         z.string().min(1).max(255).optional(),
      currency:            z.string().max(10).optional(),
      currencySymbol:      z.string().max(10).optional(),
      symbolPosition:      z.enum(["before", "after"]).optional(),
      defaultReorderPoint: decimalOrDefault("0.00").optional(),
      lowStockThreshold:   decimalOrDefault("50.00").optional(),
      // Пусто — порога нет. Строкой, как все числа настроек.
      maxFieldDiscountPct: z.preprocess(v => (v === "" ? null : v), z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, "Порог — процент от 0 до 100").refine(v => Number(v) <= 100, "Порог — процент от 0 до 100").nullable().optional()),
      companyAddress:      z.string().nullable().optional(),
      companyPhone:        z.string().max(50).nullable().optional(),
      companyInn:          z.string().nullable().optional(),
      companyDirector:     z.string().nullable().optional(),
      companyBank:         z.string().nullable().optional(),
      companyBankAccount:  z.string().nullable().optional(),
      companyMfo:          z.string().nullable().optional(),
      /*
        Предел — не пожелание, а ёмкость столбца: logo_url объявлен как TEXT,
        это 65 535 байт. Строка длиннее не записывалась, и MySQL отклонял ВЕСЬ
        запрос — арендатор терял и название, и адрес, и банковские реквизиты,
        получая безымянное «Внутренняя ошибка сервера». Теперь отказ приходит
        словами и до похода в базу.
      */
      logoUrl:             z.string().max(LOGO_MAX_CHARS, "Логотип: изображение слишком большое, выберите файл поменьше").optional().nullable(),
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
        // Порог скидки, валюта, точка заказа — правила дела; след в той же
        // транзакции. Логотип — без содержимого, только факт смены.
        const changed = changedFields((existing ?? {}) as Record<string, unknown>, sanitized, Object.keys(sanitized).filter(k => k !== "logoUrl"));
        if ("logoUrl" in sanitized && (existing?.logoUrl ?? null) !== (sanitized.logoUrl ?? null)) changed.logoUrl = { from: "…", to: "…" };
        if (Object.keys(changed).length > 0) {
          await recordAudit(tx as unknown as typeof db, {
            ...auditActor(ctx), action: "settings.updated", targetType: "settings", meta: { changed },
          }, { strict: true });
        }
      });

      // Invalidate all settings caches for this tenant
      cache.invalidatePrefix(`settings:${tenantId}`);

      return { success: true };
    }),
});
