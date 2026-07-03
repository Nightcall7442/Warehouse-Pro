import { z } from "zod";
import { createRouter, adminQuery } from "./middleware";
import { oneCSync } from "./services/onec-sync";
import { getBridge } from "./lib/onec-bridge";
import { logger } from "./lib/logger";
import { getMetricsSummary } from "./lib/metrics";

export const onecRouter = createRouter({
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
