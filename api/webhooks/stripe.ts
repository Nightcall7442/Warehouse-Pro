import type { Hono } from "hono";
import type Stripe from "stripe";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { subscriptions, billingEvents, tenants } from "@db/schema";
import { verifyWebhook } from "../lib/stripe";
import { sendEmail } from "../lib/mailer";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import type { Context } from "hono";

export function registerStripeWebhook(app: Hono) {
  app.post("/api/webhooks/stripe", async (c: Context) => {
    const signature = c.req.header("stripe-signature");
    if (!signature) return c.json({ error: "No signature" }, 400);

    let rawBody: string;
    try {
      rawBody = await c.req.text();
    } catch {
      return c.json({ error: "Cannot read body" }, 400);
    }

    let event: Awaited<ReturnType<typeof verifyWebhook>>;
    try {
      event = await verifyWebhook(rawBody, signature);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("stripe webhook signature verification failed", { error: msg });
      return c.json({ error: "Invalid signature" }, 400);
    }

    const db = getDb();

    // Idempotency check
    const [existing] = await db.select()
      .from(billingEvents)
      .where(eq(billingEvents.stripeEventId, event.id))
      .limit(1);
    if (existing) return c.json({ received: true });

    try {
      await db.transaction(async (tx) => {
        switch (event.type) {
          case "checkout.session.completed": {
            const session  = event.data.object as Stripe.Checkout.Session;
            const tenantId = Number(session.metadata?.tenantId);
            if (!tenantId) break;
            await tx.update(subscriptions).set({
              stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null,
              stripeCustomerId:     typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
              plan: "basic", status: "active", updatedAt: new Date(),
            }).where(eq(subscriptions.tenantId, tenantId));
            break;
          }
          case "customer.subscription.updated": {
            const sub      = event.data.object as Stripe.Subscription;
            const tenantId = Number(sub.metadata?.tenantId);
            if (!tenantId) break;
            const priceId = sub.items?.data?.[0]?.price?.id;
            const plan = priceId === env.stripeProPriceId ? "pro" : "basic";
            await tx.update(subscriptions).set({
              plan, status: sub.status as "active" | "past_due" | "canceled" | "trialing" | "incomplete",
              currentPeriodEnds: sub.current_period_end
                ? new Date(sub.current_period_end * 1000) : null,
              updatedAt: new Date(),
            }).where(eq(subscriptions.tenantId, tenantId));
            break;
          }
          case "customer.subscription.deleted": {
            const sub      = event.data.object as Stripe.Subscription;
            const tenantId = Number(sub.metadata?.tenantId);
            if (!tenantId) break;
            await tx.update(subscriptions).set({ status: "canceled", updatedAt: new Date() })
              .where(eq(subscriptions.tenantId, tenantId));
            break;
          }
          case "invoice.payment_failed": {
            const invoice  = event.data.object as Stripe.Invoice;
            const tenantId = Number(invoice.subscription_details?.metadata?.tenantId);
            if (!tenantId) break;
            await tx.update(subscriptions).set({ status: "past_due", updatedAt: new Date() })
              .where(eq(subscriptions.tenantId, tenantId));
            const [tenant] = await tx.select().from(tenants)
              .where(eq(tenants.id, tenantId)).limit(1);
            if (tenant?.ownerEmail) {
            sendEmail({
              to: tenant.ownerEmail,
              subject: `Ошибка оплаты — ${tenant.name}`,
              html: `<p>Не удалось списать оплату. <a href="${env.appUrl}/settings/billing">Обновить платёжные данные</a></p>`,
            }).catch((err) => {
              logger.error("stripe webhook failed to send email", { eventId: event.id, eventType: event.type, error: err instanceof Error ? err.message : String(err) });
            });
            }
            break;
          }
        }

        await tx.insert(billingEvents).values({
          id: randomUUID(), type: event.type,
          stripeEventId: event.id,
          payload: JSON.stringify(event.data.object),
        });
      });
    } catch (err) {
      logger.error("stripe webhook handler error", { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: "Handler failed" }, 500);
    }

    return c.json({ received: true });
  });
}
