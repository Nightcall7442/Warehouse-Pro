import { z } from "zod";
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
      return {
        ...config,
        password: "********",
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
      .mutation(async ({ input }) => {
        // Store sync schedule in settings (would need settings table update)
        // For now, return confirmation
        logger.info("1C sync schedule configured", input);
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

  status: adminQuery.query(async () => {
    return {
      lastProductSync: null,
      lastOrderSync: null,
      pendingOrders: 0,
      errors: 0,
    };
  }),

  metrics: adminQuery.query(async () => {
    return getMetricsSummary();
  }),
});
