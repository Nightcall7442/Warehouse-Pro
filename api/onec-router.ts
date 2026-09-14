import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createHash, randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { createRouter, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { onecConfig } from "@db/schema";
import { OneCBridge, getBridgeForTenant, clearBridgeCache, normalizeOdataUrl } from "./lib/onec-bridge";
import { PRESET_LABELS, requiredFields, resolveNames, type OnecPreset } from "./lib/onec-presets";
import { seal, open } from "./lib/secret-box";
import { logger } from "./lib/logger";
import { getMetricsSummary } from "./lib/metrics";
import { getSyncStatus } from "./services/onec-status";
import { OnecJournal } from "./services/onec-journal";
import { oneCSync } from "./services/onec-sync";
import { syncCounterparties, matchCandidates, mapShop, createCounterpartyFor, unmappedShops } from "./services/onec-counterparties";
import { recordAudit, auditActor } from "./services/audit-log";

/*
  Обмен с 1С — настраивается из продукта, а не из переменных окружения.

  ── Что было ────────────────────────────────────────────────────────────────

  Мастер подключения был написан, но нигде не смонтирован и не сохранял
  настройки; клиент говорил с «1С Bridge», которого не существует; магазины
  никогда не сопоставлялись с контрагентами 1С. То есть «двусторонний обмен с
  1С» из тарифа не работал ни у одной организации.

  ── Что теперь ──────────────────────────────────────────────────────────────

  Стандартный OData 1С (lib/onec-bridge.ts). Порядок для директора:
  1. Подключение: адрес публикации, логин, пароль, пресет конфигурации →
     testConnection проверяет связь И сверяет пресет с $metadata базы.
  2. Выбор из самой 1С: организация, склад, тип цен (lists).
  3. Сопоставление магазинов с контрагентами (counterparties.*).
  4. Обмен: руками (syncProducts, syncOrder) и по расписанию (крон
     onec-sync читает enabled + intervalMinutes); журнал с повторами.
*/

const PresetSchema = z.enum(["bp_uz", "ut", "custom"]);

async function loadConfig(tenantId: number) {
  const db = getDb();
  const [config] = await db.select().from(onecConfig).where(eq(onecConfig.tenantId, tenantId)).limit(1);
  return config ?? null;
}

/** Сверка имён пресета с тем, что есть в базе клиента. */
async function structureReport(bridge: OneCBridge) {
  const meta = await bridge.metadata();
  const names = bridge.names;
  const report = requiredFields(names).map(({ set, field, about }) => {
    const fields = meta[set];
    return { set, field, about, setExists: Boolean(fields), fieldExists: Boolean(fields?.has(field)) };
  });
  const problems = report.filter(r => !r.setExists || !r.fieldExists);
  return { sets: Object.keys(meta).length, checked: report.length, problems };
}

export const onecRouter = createRouter({
  presets: adminQuery.query(() => PRESET_LABELS),

  wizard: {
    getConfig: adminQuery.query(async ({ ctx }) => {
      const config = await loadConfig(ctx.tenant.id);
      if (!config) return null;
      const { password: _p, webhookSecretHash, ...rest } = config;
      void _p;
      return { ...rest, password: "********", webhookSecretIssued: Boolean(webhookSecretHash), names: resolveNames((config.preset ?? "bp_uz") as OnecPreset, config.nameOverrides ?? undefined) };
    }),

    /** Проверить подключение до сохранения: связь, логин, структура базы. */
    testConnection: adminQuery
      .input(z.object({
        url: z.string().url(),
        username: z.string().min(1),
        /** Пусто — взять сохранённый пароль (при повторной проверке с экрана). */
        password: z.string().optional(),
        preset: PresetSchema.default("bp_uz"),
        nameOverrides: z.record(z.string(), z.unknown()).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        let password = input.password ?? "";
        if (!password) {
          const saved = await loadConfig(ctx.tenant.id);
          if (!saved) throw new TRPCError({ code: "BAD_REQUEST", message: "Введите пароль" });
          password = open(saved.password);
        }
        const bridge = new OneCBridge({ url: input.url, username: input.username, password, preset: input.preset, overrides: input.nameOverrides });
        const health = await bridge.healthCheck();
        const db = getDb();
        await db.update(onecConfig).set({ lastTestedAt: new Date(), lastTestOk: health.ok }).where(eq(onecConfig.tenantId, ctx.tenant.id));
        if (!health.ok) return { ok: false as const, error: health.error, url: bridge.base };
        const structure = await structureReport(bridge);
        return { ok: true as const, url: bridge.base, structure };
      }),

    saveConfig: adminQuery
      .input(z.object({
        url: z.string().url(),
        username: z.string().min(1),
        password: z.string().optional(),
        preset: PresetSchema.default("bp_uz"),
        nameOverrides: z.record(z.string(), z.unknown()).nullable().optional(),
        organizationKey: z.string().uuid().nullable().optional(),
        warehouseKey: z.string().uuid().nullable().optional(),
        priceTypeKey: z.string().uuid().nullable().optional(),
        enabled: z.boolean().default(false),
        syncProducts: z.boolean().default(true),
        syncOrders: z.boolean().default(true),
        syncCounterparties: z.boolean().default(true),
        syncPayments: z.boolean().default(false),
        intervalMinutes: z.number().int().min(5).max(1440).default(60),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        const existing = await loadConfig(ctx.tenant.id);
        if (!input.password && !existing) throw new TRPCError({ code: "BAD_REQUEST", message: "Введите пароль пользователя 1С" });
        const values = {
          url: normalizeOdataUrl(input.url),
          username: input.username,
          preset: input.preset,
          nameOverrides: input.nameOverrides ?? null,
          organizationKey: input.organizationKey ?? null,
          warehouseKey: input.warehouseKey ?? null,
          priceTypeKey: input.priceTypeKey ?? null,
          enabled: input.enabled,
          syncProducts: input.syncProducts,
          syncOrders: input.syncOrders,
          syncCounterparties: input.syncCounterparties,
          syncPayments: input.syncPayments,
          intervalMinutes: input.intervalMinutes,
          ...(input.password ? { password: seal(input.password) } : {}),
        };
        if (existing) await db.update(onecConfig).set(values).where(eq(onecConfig.id, existing.id));
        else await db.insert(onecConfig).values({ tenantId: ctx.tenant.id, password: seal(input.password!), ...values });
        clearBridgeCache();
        // Адрес и логин — да; пароль в журнал не попадает никогда.
        await recordAudit(db, {
          ...auditActor(ctx), action: "onec.config_saved", targetType: "onec_config",
          meta: { url: values.url, username: input.username, preset: input.preset, enabled: input.enabled, intervalMinutes: input.intervalMinutes },
        });
        return { success: true };
      }),

    /** Организации, склады и типы цен — из самой 1С, чтобы директор выбирал, а не вписывал GUID. */
    lists: adminQuery.query(async ({ ctx }) => {
      const bridge = await getBridgeForTenant(ctx.tenant.id);
      const n = bridge.names;
      const pick = async (set: string, name: string) => {
        const rows = await bridge.query<Record<string, unknown>>(set, { $select: `Ref_Key,${name}`, $top: "200" });
        return rows.map(r => ({ key: String(r.Ref_Key), name: String(r[name] ?? "") })).filter(r => r.name);
      };
      const [organizations, warehouses, priceTypes] = await Promise.all([
        pick(n.organizations.set, n.organizations.name),
        pick(n.warehouses.set, n.warehouses.name),
        pick(n.priceTypes.set, n.priceTypes.name),
      ]);
      return { organizations, warehouses, priceTypes };
    }),

    /** Структура сохранённого подключения: что из пресета в этой базе называется иначе. */
    checkStructure: adminQuery.mutation(async ({ ctx }) => {
      const bridge = await getBridgeForTenant(ctx.tenant.id);
      return structureReport(bridge);
    }),

    issueWebhookSecret: adminQuery.mutation(async ({ ctx }) => {
      const db = getDb();
      const config = await loadConfig(ctx.tenant.id);
      if (!config) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Сначала сохраните настройки подключения к 1С." });
      // 32 случайных байта из криптографического источника. Math.random здесь
      // недопустим: секрет — единственное, что отделяет чужую организацию от
      // записи платежей в вашу.
      const secret = `wh_1c_${randomBytes(32).toString("hex")}`;
      const secretHash = createHash("sha256").update(secret).digest("hex");
      await db.update(onecConfig).set({ webhookSecretHash: secretHash }).where(eq(onecConfig.id, config.id));
      logger.info("1C webhook secret issued", { tenantId: ctx.tenant.id });
      return { secret, header: "X-1C-Secret", note: "Сохраните секрет — показывается один раз. Повторный выпуск отключает предыдущий." };
    }),
  },

  counterparties: {
    /** Загрузить контрагентов из 1С и сопоставить с магазинами по названию и телефону. */
    sync: adminQuery.mutation(async ({ ctx }) => syncCounterparties(ctx.tenant.id)),
    /** Магазины без контрагента и кандидаты для каждого. */
    unmapped: adminQuery.query(async ({ ctx }) => unmappedShops(ctx.tenant.id)),
    /** Найти контрагентов в 1С по строке — для ручного сопоставления. */
    search: adminQuery.input(z.object({ q: z.string().min(1).max(100) })).query(async ({ input, ctx }) => matchCandidates(ctx.tenant.id, input.q)),
    map: adminQuery.input(z.object({ shopId: z.number().int().positive(), externalId: z.string().min(1) })).mutation(async ({ input, ctx }) => mapShop(ctx.tenant.id, input.shopId, input.externalId)),
    /** Завести контрагента в 1С по карточке магазина и связать. */
    create: adminQuery.input(z.object({ shopId: z.number().int().positive() })).mutation(async ({ input, ctx }) => createCounterpartyFor(ctx.tenant.id, input.shopId)),
  },

  journal: {
    list: adminQuery
      .input(z.object({ status: z.enum(["pending", "done", "failed", "skipped"]).optional(), entityType: z.enum(["order", "payment", "product", "counterparty"]).optional(), limit: z.number().int().min(1).max(500).default(100) }).optional())
      .query(async ({ input, ctx }) => {
        const db = getDb();
        const [rows, counts] = await Promise.all([OnecJournal.list(db, ctx.tenant.id, input ?? {}), OnecJournal.counts(db, ctx.tenant.id)]);
        return { rows, counts };
      }),
    retry: adminQuery.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
      const ok = await OnecJournal.retry(getDb(), ctx.tenant.id, input.id);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "Записи журнала нет" });
      return { success: true };
    }),
  },

  syncProducts: adminQuery.mutation(async ({ ctx }) => oneCSync.syncProducts(ctx.tenant.id)),

  syncOrder: adminQuery
    .input(z.object({ orderId: z.number().int().positive(), asNewDocument: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      await oneCSync.syncOrderTo1C(ctx.tenant.id, input.orderId, { asNewDocument: input.asNewDocument });
      return { success: true };
    }),

  /** Прогнать очередь журнала сейчас, не дожидаясь крона. */
  runQueue: adminQuery.mutation(async ({ ctx }) => oneCSync.processQueue(ctx.tenant.id)),

  status: adminQuery.query(async ({ ctx }) => {
    const config = await loadConfig(ctx.tenant.id);
    if (!config) {
      return { configured: false as const, lastProductSync: null, lastOrderSync: null, errors: 0, lastError: null, lastTestedAt: null, lastTestOk: null, enabled: false, queue: {} as Record<string, number> };
    }
    const rows = await getSyncStatus(ctx.tenant.id);
    const lastOf = (entityType: string) => {
      const stamps = rows.filter(r => r.entityType === entityType && r.lastSuccessfulSync)
        .map(r => new Date(r.lastSuccessfulSync as unknown as string).getTime());
      return stamps.length ? new Date(Math.max(...stamps)).toISOString() : null;
    };
    const errors = rows.reduce((sum, r) => sum + Number(r.errorCount ?? 0), 0);
    const failed = rows.filter(r => r.status === "failed" && r.lastError);
    const lastError = failed.length
      ? failed.sort((a, b) => new Date(b.updatedAt as unknown as string).getTime() - new Date(a.updatedAt as unknown as string).getTime())[0].lastError
      : null;
    return {
      configured: true as const,
      lastProductSync: lastOf("product"),
      lastOrderSync: lastOf("order"),
      errors, lastError,
      lastTestedAt: config.lastTestedAt?.toISOString() ?? null,
      lastTestOk: config.lastTestOk ?? null,
      enabled: config.enabled,
      lastSyncAt: config.lastSyncAt?.toISOString() ?? null,
      schedule: { intervalMinutes: config.intervalMinutes, syncProducts: config.syncProducts, syncOrders: config.syncOrders, syncCounterparties: config.syncCounterparties, syncPayments: config.syncPayments },
      ready: Boolean(config.organizationKey && config.warehouseKey && config.priceTypeKey),
      queue: await OnecJournal.counts(getDb(), ctx.tenant.id),
    };
  }),

  metrics: adminQuery.query(async () => getMetricsSummary()),
});
