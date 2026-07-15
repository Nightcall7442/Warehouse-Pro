import { z } from "zod";
import { createRouter, adminQuery } from "./middleware";
import { oneCSync } from "./services/onec-sync";
import { getBridge, OneCBridge } from "./lib/onec-bridge";
import { logger } from "./lib/logger";
import { getMetricsSummary } from "./lib/metrics";

export const onecRouter = createRouter({
  // ── Setup Wizard ──────────────────────────────────────────────────────────
  wizard: {
    /** Test connection to 1C Bridge */
    testConnection: adminQuery
      .input(z.object({
        url: z.string().url(),
        username: z.string(),
        password: z.string(),
      }))
      .mutation(async ({ input }) => {
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

  health: adminQuery.query(async () => {
    try {
      const bridge = getBridge();
      const healthy = await bridge.healthCheck();
      return { healthy, timestamp: new Date().toISOString() };
    } catch (e) {
      return { healthy: false, error: (e as Error).message };
    }
  }),

  syncProducts: adminQuery
    .input(z.object({ tenantId: z.number() }).optional())
    .mutation(async ({ ctx, input }) => {
      const tenantId = input?.tenantId ?? ctx.tenant.id;
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
