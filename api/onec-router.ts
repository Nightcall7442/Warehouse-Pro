import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createHash, randomBytes } from "crypto";
import { createRouter, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { oneCSync } from "./services/onec-sync";
import { getBridgeForTenant, OneCBridge, clearBridgeCache } from "./lib/onec-bridge";
import { onecConfig } from "@db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./lib/logger";
import { getMetricsSummary } from "./lib/metrics";

export const onecRouter = createRouter({
  // ── Setup Wizard ──────────────────────────────────────────────────────────
  wizard: {
    /** Save per-tenant 1C Bridge configuration */
    saveConfig: adminQuery
      .input(z.object({
        url: z.string().url(),
        username: z.string(),
        password: z.string(),
        syncProducts: z.boolean().optional().default(true),
        syncOrders: z.boolean().optional().default(true),
        intervalMinutes: z.number().min(5).max(1440).optional().default(60),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        const existing = await db.select({ id: onecConfig.id })
          .from(onecConfig)
          .where(eq(onecConfig.tenantId, ctx.tenant.id))
          .limit(1);

        if (existing[0]) {
          await db.update(onecConfig)
            .set({
              url: input.url,
              username: input.username,
              password: input.password,
              syncProducts: input.syncProducts,
              syncOrders: input.syncOrders,
              intervalMinutes: input.intervalMinutes,
            })
            .where(eq(onecConfig.id, existing[0].id));
        } else {
          await db.insert(onecConfig).values({
            tenantId: ctx.tenant.id,
            url: input.url,
            username: input.username,
            password: input.password,
            syncProducts: input.syncProducts,
            syncOrders: input.syncOrders,
            intervalMinutes: input.intervalMinutes,
          });
        }

        clearBridgeCache();
        logger.info("1C config saved", { tenantId: ctx.tenant.id });
        return { success: true };
      }),

    /** Get current per-tenant 1C config (password masked) */
    getConfig: adminQuery.query(async ({ ctx }) => {
      const db = getDb();
      const [config] = await db.select()
        .from(onecConfig)
        .where(eq(onecConfig.tenantId, ctx.tenant.id))
        .limit(1);

      if (!config) return null;
      // Хеш секрета наружу не отдаётся. Сам по себе он бесполезен — восстановить
      // из него секрет нельзя, — но и знать его клиенту незачем; отдаётся только
      // факт, выпущен секрет или нет, чтобы интерфейс мог это показать.
      const { webhookSecretHash, ...rest } = config;
      return {
        ...rest,
        password: "********",
        webhookSecretIssued: Boolean(webhookSecretHash),
      };
    }),

    /** Test connection to 1C Bridge */
    testConnection: adminQuery
      .input(z.object({
        url: z.string().url(),
        username: z.string(),
        password: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        try {
          const bridge = new OneCBridge({
            url: input.url,
            username: input.username,
            password: input.password,
            timeout: 10000,
          });

          // Test health endpoint
          const healthy = await bridge.healthCheck();

          // Test OData query if health passes
          let productsCount = 0;
          let companiesCount = 0;
          if (healthy) {
            try {
              const products = await bridge.odataQuery("Catalog_Товары?$select=Ref_Key&$top=1");
              productsCount = products.length;
            } catch { /* OData might not be available */ }
            try {
              const companies = await bridge.odataQuery("Catalog_Контрагенты?$select=Ref_Key&$top=1");
              companiesCount = companies.length;
            } catch { /* OData might not be available */ }
          }

          // Record test result in per-tenant config if it exists
          const db = getDb();
          const [existing] = await db.select({ id: onecConfig.id })
            .from(onecConfig)
            .where(eq(onecConfig.tenantId, ctx.tenant.id))
            .limit(1);
          if (existing) {
            await db.update(onecConfig)
              .set({ lastTestedAt: new Date(), lastTestOk: healthy })
              .where(eq(onecConfig.id, existing.id));
          }

          return {
            success: healthy,
            details: {
              health: healthy,
              productsAccessible: productsCount > 0,
              companiesAccessible: companiesCount > 0,
              timestamp: new Date().toISOString(),
            },
          };
        } catch (e) {
          return {
            success: false,
            error: (e as Error).message,
            details: null,
          };
        }
      }),

    /** Get sample 1C Bridge configuration */
    sampleConfig: adminQuery.query(async () => {
      return {
        envVars: {
          ONE_C_BRIDGE_URL: "http://your-server:8080",
          ONE_C_USERNAME: "admin",
          ONE_C_PASSWORD: "your-password",
        },
        bridgeRequirements: [
          "1C:Enterprise 8.3 with HTTP services enabled",
          "1C Bridge running and accessible from this server",
          "OData interface configured in 1C",
          "User with read/write permissions to Catalog_Товары, Catalog_Контрагенты, Document_РеализацияТоваровУслуг",
        ],
        odataEndpoints: [
          { entity: "Catalog_Товары", description: "Products catalog" },
          { entity: "Catalog_Контрагенты", description: "Companies/counterparts" },
          { entity: "Document_РеализацияТоваровУслуг", description: "Sales documents" },
        ],
        troubleshooting: [
          "Check if Bridge is running: curl http://your-server:8080/health",
          "Verify credentials: use same username/password as 1C web interface",
          "Check firewall: Bridge port (default 8080) must be accessible",
          "Check 1C logs: /opt/1cv8/srvinfo/ or C:\\ProgramFiles\\1cv8\\",
        ],
      };
    }),

    /** Auto-configure sync schedule */
    syncSchedule: adminQuery
      .input(z.object({
        intervalMinutes: z.number().min(5).max(1440).default(60),
        syncProducts: z.boolean().default(true),
        syncOrders: z.boolean().default(true),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = getDb();

        // Persist schedule to onecConfig
        const [existing] = await db.select({ id: onecConfig.id })
          .from(onecConfig)
          .where(eq(onecConfig.tenantId, ctx.tenant.id))
          .limit(1);

        if (existing) {
          await db.update(onecConfig)
            .set({
              intervalMinutes: input.intervalMinutes,
              syncProducts: input.syncProducts,
              syncOrders: input.syncOrders,
            })
            .where(eq(onecConfig.id, existing.id));
        } else {
          await db.insert(onecConfig).values({
            tenantId: ctx.tenant.id,
            url: "", // Must be configured separately via testConnection
            username: "",
            password: "",
            intervalMinutes: input.intervalMinutes,
            syncProducts: input.syncProducts,
            syncOrders: input.syncOrders,
          });
        }

        logger.info("1C sync schedule configured", { tenantId: ctx.tenant.id, ...input });
        return {
          success: true,
          schedule: {
            interval: `${input.intervalMinutes} minutes`,
            products: input.syncProducts,
            orders: input.syncOrders,
            nextSync: new Date(Date.now() + input.intervalMinutes * 60 * 1000).toISOString(),
          },
        };
      }),
  },

  /**
   * Выпустить секрет вебхука для своей организации.
   *
   * Секрет показывается ОДИН раз — в базе лежит только его SHA-256, как у
   * ключей публичного API. Потерявший его выпускает новый: старый при этом
   * перестаёт работать сразу, потому что колонка одна.
   *
   * Повторный вызов — это и есть ротация. Отдельной кнопки «отозвать» нет
   * намеренно: пока интеграция настроена, секрет нужен, а выключается вебхук
   * удалением конфигурации целиком.
   */
  issueWebhookSecret: adminQuery.mutation(async ({ ctx }) => {
    const db = getDb();
    const [config] = await db.select({ id: onecConfig.id })
      .from(onecConfig)
      .where(eq(onecConfig.tenantId, ctx.tenant.id))
      .limit(1);

    if (!config) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Сначала сохраните настройки подключения к 1С.",
      });
    }

    // 32 случайных байта из криптографического источника. Math.random здесь
    // недопустим: секрет — единственное, что отделяет чужую организацию от
    // записи платежей в вашу.
    const secret = `wh_1c_${randomBytes(32).toString("hex")}`;
    const secretHash = createHash("sha256").update(secret).digest("hex");

    await db.update(onecConfig)
      .set({ webhookSecretHash: secretHash })
      .where(eq(onecConfig.id, config.id));

    logger.info("1C webhook secret issued", { tenantId: ctx.tenant.id });

    // Заголовок, а не тело: 1С шлёт его в X-1C-Secret.
    return {
      secret,
      header: "X-1C-Secret",
      note: "Сохраните секрет — показывается один раз. Повторный выпуск отключает предыдущий.",
    };
  }),

  /** Test connection using saved per-tenant config */
  testSavedConnection: adminQuery.mutation(async ({ ctx }) => {
    try {
      const db = getDb();
      const [config] = await db.select()
        .from(onecConfig)
        .where(eq(onecConfig.tenantId, ctx.tenant.id))
        .limit(1);

      if (!config) {
        return { success: false, error: "1C config not found", details: null };
      }

      const bridge = new OneCBridge({
        url: config.url,
        username: config.username,
        password: config.password,
        timeout: 10000,
      });

      const healthy = await bridge.healthCheck();

      let productsCount = 0;
      let companiesCount = 0;
      if (healthy) {
        try {
          const products = await bridge.odataQuery("Catalog_Товары?$select=Ref_Key&$top=1");
          productsCount = products.length;
        } catch { /* OData might not be available */ }
        try {
          const companies = await bridge.odataQuery("Catalog_Контрагенты?$select=Ref_Key&$top=1");
          companiesCount = companies.length;
        } catch { /* OData might not be available */ }
      }

      await db.update(onecConfig)
        .set({ lastTestedAt: new Date(), lastTestOk: healthy })
        .where(eq(onecConfig.id, config.id));

      return {
        success: healthy,
        details: {
          health: healthy,
          productsAccessible: productsCount > 0,
          companiesAccessible: companiesCount > 0,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (e) {
      return {
        success: false,
        error: (e as Error).message,
        details: null,
      };
    }
  }),

  health: adminQuery.query(async ({ ctx }) => {
    try {
      const bridge = await getBridgeForTenant(ctx.tenant.id);
      const healthy = await bridge.healthCheck();
      return { healthy, timestamp: new Date().toISOString() };
    } catch (e) {
      return { healthy: false, error: (e as Error).message };
    }
  }),

  syncProducts: adminQuery
    .mutation(async ({ ctx }) => {
      const tenantId = ctx.tenant.id;
      const result = await oneCSync.syncProducts(tenantId);
      logger.info("Manual product sync triggered", { tenantId, ...result });
      return result;
    }),

  syncOrder: adminQuery
    .input(z.object({ orderId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await oneCSync.syncOrderTo1C(ctx.tenant.id, input.orderId);
      return { success: true };
    }),

  status: adminQuery.query(async ({ ctx }) => {
    const db = getDb();

    const [config] = await db.select({
      lastTestedAt: onecConfig.lastTestedAt,
      lastTestOk: onecConfig.lastTestOk,
      syncProducts: onecConfig.syncProducts,
      syncOrders: onecConfig.syncOrders,
      intervalMinutes: onecConfig.intervalMinutes,
    }).from(onecConfig)
      .where(eq(onecConfig.tenantId, ctx.tenant.id))
      .limit(1);

    if (!config) {
      return {
        configured: false,
        lastProductSync: null,
        lastOrderSync: null,
        pendingOrders: 0,
        errors: 0,
      };
    }

    return {
      configured: true,
      lastProductSync: config.lastTestedAt?.toISOString() ?? null,
      lastOrderSync: null, // TODO: track per-type sync timestamps
      pendingOrders: 0, // TODO: count unsynced orders
      errors: config.lastTestOk === false ? 1 : 0,
      schedule: {
        intervalMinutes: config.intervalMinutes,
        syncProducts: config.syncProducts,
        syncOrders: config.syncOrders,
      },
    };
  }),

  metrics: adminQuery.query(async () => {
    return getMetricsSummary();
  }),
});
