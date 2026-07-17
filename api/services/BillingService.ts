import { tenants, users, orders, products, subscriptions } from "@db/schema";
import { eq, and, sql, gte } from "drizzle-orm";
import { getStripe, PLANS } from "../lib/stripe";
import { getOrCreateSubscription } from "../lib/subscription";
import { env } from "../lib/env";
import { cache, CacheKeys, CacheTTL } from "../lib/cache";

type DrizzleInstance = ReturnType<typeof import("../queries/connection").getDb>;

export const BillingService = {
  async getStatus(db: DrizzleInstance, tenantId: number) {
    const cacheKey = CacheKeys.tenantSubscription(tenantId);
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const [tenant] = await db.select().from(tenants)
      .where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw new Error("Tenant not found");

    const plan = PLANS[tenant.plan];
    const now = new Date();
    const trialEnds = tenant.trialEndsAt;
    const planEnds = tenant.planExpiresAt;

    const trialActive = trialEnds && trialEnds > now;
    const planActive = planEnds && planEnds > now;
    const isExpired = !trialActive && !planActive;

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const [userCount, productCount, orderCount] = await Promise.all([
      db.select({ c: sql<number>`count(*)` }).from(users).where(eq(users.tenantId, tenantId)),
      db.select({ c: sql<number>`count(*)` }).from(products).where(eq(products.tenantId, tenantId)),
      db.select({ c: sql<number>`count(*)` }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), gte(orders.createdAt, startOfMonth))),
    ]);

    const result = {
      plan: tenant.plan,
      planName: plan.name,
      planNameUz: plan.nameUz,
      trialEndsAt: trialEnds,
      planExpiresAt: planEnds,
      trialActive,
      planActive,
      isExpired,
      daysLeft: trialActive
        ? Math.ceil((trialEnds!.getTime() - now.getTime()) / 86_400_000)
        : planActive
          ? Math.ceil((planEnds!.getTime() - now.getTime()) / 86_400_000)
          : 0,
      limits: {
        maxUsers: plan.maxUsers,
        maxProducts: plan.maxProducts,
        maxOrdersMonth: plan.maxOrdersMonth,
      },
      usage: {
        users: Number(userCount[0]?.c ?? 0),
        products: Number(productCount[0]?.c ?? 0),
        orders: Number(orderCount[0]?.c ?? 0),
      },
      plans: (Object.entries(PLANS) as [PlanKey, (typeof PLANS)[PlanKey]][]).map(([key, p]) => ({
        key,
        name: p.name,
        nameUz: p.nameUz,
        maxUsers: p.maxUsers,
        maxProducts: p.maxProducts,
        maxOrdersMonth: p.maxOrdersMonth,
      })),
    };

    cache.set(cacheKey, result, CacheTTL.subscription);
    return result;
  },

  async upgrade(db: DrizzleInstance, tenantId: number, plan: "basic" | "pro") {
    const planData = PLANS[plan];
    if (!planData) throw new Error("Invalid plan");

    await db.update(tenants)
      .set({ updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));

    cache.invalidatePrefix(`sub:${tenantId}`);
    return {
      success: true,
      message: `Запрос на тариф "${planData.name}" отправлен.`,
      plan,
    };
  },

  async createCheckoutSession(db: DrizzleInstance, tenantId: number, plan: "basic" | "pro") {
    const stripe = getStripe();
    const sub = await getOrCreateSubscription(tenantId);
    const planData = PLANS[plan];
    const priceId = planData.priceId;

    if (!priceId) {
      throw new Error("Plan not configured");
    }

    let customerId = sub.stripeCustomerId;
    if (!customerId) {
      const [tenant] = await db.select().from(tenants)
        .where(eq(tenants.id, tenantId)).limit(1);

      const customer = await stripe.customers.create({
        email: tenant?.ownerEmail ?? undefined,
        name: tenant?.name,
        metadata: { tenantId: String(tenantId) },
      });
      customerId = customer.id;
      await db.update(subscriptions)
        .set({ stripeCustomerId: customerId })
        .where(eq(subscriptions.tenantId, tenantId));
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${env.appUrl}/settings/billing?success=1`,
      cancel_url: `${env.appUrl}/settings/billing?canceled=1`,
      subscription_data: {
        trial_end: sub.status === "trialing" && sub.trialEndsAt
          ? Math.floor(sub.trialEndsAt.getTime() / 1000)
          : undefined,
        metadata: { tenantId: String(tenantId) },
      },
      metadata: { tenantId: String(tenantId) },
    });

    return { url: session.url! };
  },

  async createPortalSession(_db: DrizzleInstance, tenantId: number) {
    const stripe = getStripe();
    const sub = await getOrCreateSubscription(tenantId);

    if (!sub.stripeCustomerId) {
      throw new Error("No billing account found. Please subscribe first.");
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${env.appUrl}/settings/billing`,
    });

    return { url: session.url };
  },
};

type PlanKey = keyof typeof PLANS;
