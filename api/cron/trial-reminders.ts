import { randomUUID } from "crypto";
import { and, eq, gte, lte } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { subscriptions, billingEvents, tenants, users } from "@db/schema";
import { sendTrialEndingEmail } from "../lib/mailer";
import { env } from "../lib/env";
import { logger } from "../lib/logger";

/**
 * Send trial-ending reminder emails to tenants whose trial ends in ≤3 days.
 * Called via GET /api/cron/trial-reminders?secret=CRON_SECRET
 * Schedule with Vercel/Railway cron or an external service (cron-job.org).
 */
export async function runTrialReminders(): Promise<{ sent: number; errors: string[] }> {
  const db      = getDb();
  const now     = new Date();
  const in3Days = new Date(now.getTime() + 3 * 86_400_000);
  const errors: string[] = [];
  let sent = 0;

  // Find trialing subscriptions expiring in the next 3 days
  const expiring = await db.select()
    .from(subscriptions)
    .where(and(
      eq(subscriptions.status, "trialing"),
      lte(subscriptions.trialEndsAt, in3Days),
      gte(subscriptions.trialEndsAt, now),
    ));

  for (const sub of expiring) {
    try {
      // Find CEO of this tenant
      const [ceo] = await db.select()
        .from(users)
        .where(and(eq(users.tenantId, sub.tenantId), eq(users.role, "ceo")))
        .limit(1);

      if (!ceo) continue;

      const [tenant] = await db.select().from(tenants)
        .where(eq(tenants.id, sub.tenantId)).limit(1);
      if (!tenant) continue;

      const daysLeft = Math.ceil(
        (sub.trialEndsAt!.getTime() - now.getTime()) / 86_400_000
      );

      // Check we haven't sent this reminder today (idempotency)
      const eventType = `trial_reminder_${daysLeft}d`;
      const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
      const [alreadySent] = await db.select()
        .from(billingEvents)
        .where(and(
          eq(billingEvents.tenantId, sub.tenantId),
          eq(billingEvents.type, eventType),
          gte(billingEvents.createdAt, todayStart),
        ))
        .limit(1);

      if (alreadySent) continue;

      await sendTrialEndingEmail(
        ceo.email,
        tenant.name,
        daysLeft,
        `${env.appUrl}/settings/billing`,
      );

      // Log the event
      await db.insert(billingEvents).values({
        id:       randomUUID(),
        tenantId: sub.tenantId,
        type:     eventType,
      });

      sent++;
    } catch (err: unknown) {
      errors.push(`Tenant ${sub.tenantId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  logger.info("Trial reminders cron", { sent, errors: errors.length });
  return { sent, errors };
}
