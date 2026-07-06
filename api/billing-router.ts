import { z } from "zod";
import { createRouter, authedQuery, adminQuery } from "./middleware";
import { notifyAdmin, tgMessages } from "./telegram-router";
import { getDb } from "./queries/connection";
import { tenants, users, orders, products } from "@db/schema";
import { eq, and, sql, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { PLANS, PLAN_PRICES_UZS, type PlanKey } from "../contracts/constants";
import { logger } from "./lib/logger";

export const billingRouter = createRouter({
  /** Current tenant subscription status */
  status: authedQuery.query(async ({ ctx }) => {
    const db       = getDb();
    const tenantId = ctx.tenant.id;

    const [tenant] = await db.select().from(tenants)
      .where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw new TRPCError({ code: "NOT_FOUND" });

    // Handle legacy "trial" plan — map to "basic"
    const planKey = (tenant.plan === "trial" ? "basic" : tenant.plan) as PlanKey;
    const plan      = PLANS[planKey] ?? PLANS.basic;
    const now       = new Date();
    const trialEnds = tenant.trialEndsAt;
    const planEnds  = tenant.planExpiresAt;

    const trialActive  = trialEnds && trialEnds > now;
    const planActive   = planEnds  && planEnds  > now;
    const isExpired    = !trialActive && !planActive && tenant.plan !== "basic";

    // Current usage
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const [userCount, productCount, orderCount] = await Promise.all([
      db.select({ c: sql<number>`count(*)` }).from(users).where(eq(users.tenantId, tenantId)),
      db.select({ c: sql<number>`count(*)` }).from(products).where(eq(products.tenantId, tenantId)),
      db.select({ c: sql<number>`count(*)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), gte(orders.createdAt, startOfMonth))),
    ]);

    return {
      plan:          tenant.plan,
      planName:      plan.name,
      planNameUz:    plan.nameUz,
      price:         PLAN_PRICES_UZS[tenant.plan as PlanKey],
      trialEndsAt:   trialEnds,
      planExpiresAt: planEnds,
      trialActive,
      planActive,
      isExpired,
      daysLeft:      trialActive
        ? Math.ceil((trialEnds!.getTime() - now.getTime()) / 86_400_000)
        : planActive
          ? Math.ceil((planEnds!.getTime() - now.getTime()) / 86_400_000)
          : 0,
      limits: {
        maxUsers:       plan.maxUsers,
        maxProducts:    plan.maxProducts,
        maxOrdersMonth: plan.maxOrdersMonth,
      },
      usage: {
        users:   Number(userCount[0]?.c ?? 0),
        products:Number(productCount[0]?.c ?? 0),
        orders:  Number(orderCount[0]?.c ?? 0),
      },
      plans: (Object.entries(PLANS) as [PlanKey, (typeof PLANS)[PlanKey]][]).map(([key, p]) => ({
        key,
        name:      p.name,
        nameUz:    p.nameUz,
        price:     PLAN_PRICES_UZS[key as PlanKey],
        maxUsers:  p.maxUsers,
        maxProducts: p.maxProducts,
        maxOrdersMonth: p.maxOrdersMonth,
      })),
    };
  }),

  /** Request upgrade — creates a pending request for super-admin to process */
  requestUpgrade: adminQuery
    .input(z.object({ plan: z.enum(["basic", "pro", "exclusive"]) }))
    .mutation(async ({ input, ctx }) => {
      // In production: integrate with payment gateway (Payme, Click, Uzum Pay)
      // For now: mark tenant as pending upgrade and notify admin via Telegram
      const db = getDb();
      await db.update(tenants)
        .set({ updatedAt: new Date() })
        .where(eq(tenants.id, ctx.tenant.id));

      // Notify admin via Telegram
      const plan    = PLANS[input.plan];
      const tenant  = ctx.tenant;
      await notifyAdmin(tgMessages.upgradeRequest(
        tenant.name,
        plan.name,
        PLAN_PRICES_UZS[input.plan].toLocaleString("ru-RU"),
        tenant.ownerPhone ?? tenant.ownerEmail ?? "не указан"
      )).catch((err) => {
        logger.error("Failed to notify admin about plan upgrade request", {
          tenantId: tenant.id,
          plan: input.plan,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      return {
        success: true,
        message: `Запрос на тариф "${PLANS[input.plan].name}" отправлен. Оператор свяжется с вами в течение 30 минут.`,
        price:   PLAN_PRICES_UZS[input.plan],
        plan:    input.plan,
      };
    }),
});
