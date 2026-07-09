import { authRouter }         from "./auth-router";
import { tenantRouter }       from "./tenant-router";
import { dashboardRouter }    from "./dashboard-router";
import { shopRouter }         from "./shop-router";
import { productRouter }      from "./product-router";
import { orderRouter }        from "./order-router";
import { warehouseRouter }    from "./warehouse-router";
import { arrivalRouter }      from "./arrival-router";
import { analyticsRouter }    from "./analytics-router";
import { agentRouter }        from "./agent-router";
import { userRouter }         from "./user-router";
import { notificationRouter } from "./notification-router";
import { settingsRouter }     from "./settings-router";
import { billingRouter }      from "./billing-router";
import { telegramRouter }     from "./telegram-router";
import { stripeRouter }       from "./stripe-router";
import { inviteRouter }       from "./invite-router";
import { importRouter }       from "./import-router";
import { onecRouter }         from "./onec-router";
import { reportsRouter }      from "./reports-router";
import { tenantBrandingRouter } from "./tenant-branding-router";
import { sseRouter }          from "./sse-router";
import { merchandiserRouter } from "./merchandiser-router";
import { courierRouter }      from "./courier-router";
import { systemRouter }       from "./system-router";
import { auditRouter }        from "./audit-router";
import { warehouseReportsRouter } from "./warehouse-reports-router";
import { warehouseMultiRouter } from "./warehouse-multi-router";
import { apiKeyRouter } from "./api-key-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping:         publicQuery.query(() => ({ ok: true, ts: Date.now(), version: "1.0.0" })),
  system:       systemRouter,
  auth:         authRouter,
  tenant:       tenantRouter,
  dashboard:    dashboardRouter,
  shop:         shopRouter,
  product:      productRouter,
  order:        orderRouter,
  warehouse:    warehouseRouter,
  arrival:      arrivalRouter,
  analytics:    analyticsRouter,
  agent:        agentRouter,
  user:         userRouter,
  notification: notificationRouter,
  settings:     settingsRouter,
  billing:      billingRouter,
  stripe:       stripeRouter,
  telegram:     telegramRouter,
  invite:       inviteRouter,
  import:       importRouter,
  reports:      reportsRouter,
  branding:     tenantBrandingRouter,
  sse:          sseRouter,
  onec:         onecRouter,
  merchandiser: merchandiserRouter,
  courier:      courierRouter,
  audit:        auditRouter,
  warehouseReports: warehouseReportsRouter,
  warehouseMulti: warehouseMultiRouter,
  apiKey:       apiKeyRouter,
});

export type AppRouter = typeof appRouter;
