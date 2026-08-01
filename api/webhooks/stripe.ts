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

    // Captured from whichever case below matches, so the billingEvents audit
    // row (inserted once after the switch) can always be attributed to a
    // tenant — that insert is NOT NULL on tenant_id, and without this it threw
    // on every event, rolling back the subscription/cancellation/past-due
    // update the case block just made in the same transaction.
    let tenantId: number | undefined;

    try {
      await db.transaction(async (tx) => {
        switch (event.type) {
          case "checkout.session.completed": {
            const session  = event.data.object as Stripe.Checkout.Session;
            tenantId = Number(session.metadata?.tenantId);
            if (!tenantId) break;
            const plan = (session.metadata?.plan as string) || 'basic';
            // P0-8 FIX: Use upsert to handle missing subscription rows
            const stripeSubId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
            const stripeCustId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
            const [existingSub] = await tx.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1);
            if (existingSub) {
              await tx.update(subscriptions).set({
                stripeSubscriptionId: stripeSubId,
                stripeCustomerId: stripeCustId,
                plan, status: "active", updatedAt: new Date(),
              }).where(eq(subscriptions.tenantId, tenantId));
            } else {
              await tx.insert(subscriptions).values({
                id: randomUUID(), tenantId,
                stripeSubscriptionId: stripeSubId,
                stripeCustomerId: stripeCustId,
                plan, status: "active",
              });
            }
            // P0-8 FIX: Sync plan to tenants table (single source of truth)
            await tx.update(tenants).set({ plan: plan as "basic" | "pro" | "exclusive", updatedAt: new Date() }).where(eq(tenants.id, tenantId));
            break;
          }
          case "customer.subscription.updated": {
            const sub      = event.data.object as Stripe.Subscription;
            tenantId = Number(sub.metadata?.tenantId);
            if (!tenantId) break;
            const priceId = sub.items?.data?.[0]?.price?.id;
            let plan: "basic" | "pro" | "exclusive" = "basic";
            if (priceId === env.stripeProPriceId) plan = "pro";
            else if (priceId === env.stripeExclusivePriceId) plan = "exclusive";
            const [existingSub] = await tx.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1);
            const subData = {
              plan, status: sub.status as "active" | "past_due" | "canceled" | "trialing" | "incomplete",
              currentPeriodEnds: sub.current_period_end
                ? new Date(sub.current_period_end * 1000) : null,
              updatedAt: new Date(),
            };
            if (existingSub) {
              await tx.update(subscriptions).set(subData).where(eq(subscriptions.tenantId, tenantId));
            } else {
              await tx.insert(subscriptions).values({ id: randomUUID(), tenantId, ...subData });
            }
            // P0-8 FIX: Sync plan to tenants table
            if (sub.status === "active") {
              await tx.update(tenants).set({ plan, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
            }
            break;
          }
          case "customer.subscription.deleted": {
            const sub      = event.data.object as Stripe.Subscription;
            tenantId = Number(sub.metadata?.tenantId);
            if (!tenantId) break;
            await tx.update(subscriptions).set({ status: "canceled", updatedAt: new Date() })
              .where(eq(subscriptions.tenantId, tenantId));
            break;
          }
          case "invoice.payment_failed": {
            const invoice  = event.data.object as Stripe.Invoice;
            tenantId = Number(invoice.subscription_details?.metadata?.tenantId);
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

        // tenant_id is NOT NULL — events we can't attribute to a tenant (unhandled
        // type, or missing metadata) are logged but not persisted, rather than
        // throwing and rolling back the subscription update made above.
        if (tenantId) {
          await tx.insert(billingEvents).values({
            id: randomUUID(), tenantId, type: event.type,
            stripeEventId: event.id,
            payload: JSON.stringify(event.data.object),
          });
        } else {
          logger.warn("stripe webhook event has no resolvable tenantId, skipping billingEvents record", { eventId: event.id, eventType: event.type });
        }
      });
    } catch (err) {
      logger.error("stripe webhook handler error", { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: "Handler failed" }, 500);
    }

    return c.json({ received: true });
  });
}
