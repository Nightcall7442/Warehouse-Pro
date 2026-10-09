import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { createRouter, authedQuery, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { subscriptions } from "@db/schema";
import { getStripe, stripeConfigured, PLANS } from "./lib/stripe";
import { getOrCreateSubscription } from "./lib/subscription";
import { billedFieldUsers, planSellable } from "../contracts/pricing";
import { countFieldUsersOf } from "./lib/field-users";
import { env } from "./lib/env";

export const stripeRouter = createRouter({
  /** Get current subscription (creates trial if none) */
  getSubscription: authedQuery.query(async ({ ctx }) => {
    const sub = await getOrCreateSubscription(ctx.tenant.id);
    const now = new Date();
    /*
      Дни — до конца того срока, который сейчас действует: пробного у
      пробного, оплаченного у оплаченного. Раньше считалось только от конца
      пробного, и у платящего полоса молчала до самой блокировки.
    */
    const ends = sub.status === "trialing" ? sub.trialEndsAt : sub.currentPeriodEnds;

    return {
      ...sub,
      daysLeft:     ends
        ? Math.max(0, Math.ceil((ends.getTime() - now.getTime()) / 86_400_000))
        : null,
      // Карточный путь (доллары) есть, только если его настроили.
      stripeReady:  stripeConfigured(),
      isActive:     sub.status === "active" || sub.status === "trialing",
      isTrialing:   sub.status === "trialing",
      isPastDue:    sub.status === "past_due",
      isCanceled:   sub.status === "canceled",
    };
  }),

  /** List available plans */
  getPlans: authedQuery.query(() => {
    return Object.entries(PLANS).map(([key, plan]) => ({
      key,
      name:    plan.name,
      price:   plan.price,
      priceId: "priceId" in plan ? plan.priceId : null,
    }));
  }),

  /** Create Stripe Checkout session for upgrade */
  createCheckoutSession: adminQuery
    .input(z.object({ plan: z.enum(["standard", "basic", "pro", "exclusive"]) }))
    .mutation(async ({ input, ctx }) => {
      // Прежний тариф — только продлить свой и до даты (contracts/pricing.ts).
      if (!planSellable(ctx.tenant.plan, input.plan, new Date())) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Этот тариф больше не подключается. Выберите «Стандарт»." });
      }
      const stripe   = getStripe();
      const sub      = await getOrCreateSubscription(ctx.tenant.id);
      const plan     = PLANS[input.plan];
      const priceId  = plan.priceId;

      if (!priceId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Plan not configured." });
      }

      // Get or create Stripe customer
      let customerId = sub.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email:    ctx.user.email,
          name:     ctx.tenant.name,
          metadata: { tenantId: String(ctx.tenant.id) },
        });
        customerId = customer.id;
        await getDb().update(subscriptions)
          .set({ stripeCustomerId: customerId })
          .where(eq(subscriptions.tenantId, ctx.tenant.id));
      }

      const session = await stripe.checkout.sessions.create({
        mode:               "subscription",
        customer:           customerId,
        // «Стандарт» — за место: количество = полевые, не меньше минимума.
        line_items:         [{ price: priceId, quantity: plan.perSeat ? billedFieldUsers(await countFieldUsersOf(getDb(), ctx.tenant.id)) : 1 }],
        success_url:        `${env.appUrl}/settings/billing?success=1`,
        cancel_url:         `${env.appUrl}/settings/billing?canceled=1`,
        subscription_data: {
          trial_end: sub.status === "trialing" && sub.trialEndsAt
            ? Math.floor(sub.trialEndsAt.getTime() / 1000)
            : undefined,
          metadata: { tenantId: String(ctx.tenant.id), plan: input.plan },
        },
        metadata: { tenantId: String(ctx.tenant.id), plan: input.plan },
      });

      return { url: session.url! };
    }),

  /** Create Stripe Billing Portal session (manage subscription) */
  createBillingPortalSession: adminQuery.mutation(async ({ ctx }) => {
    const stripe = getStripe();
    const sub    = await getOrCreateSubscription(ctx.tenant.id);

    if (!sub.stripeCustomerId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No billing account found. Please subscribe first." });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer:   sub.stripeCustomerId,
      return_url: `${env.appUrl}/settings/billing`,
    });

    return { url: session.url };
  }),
});
