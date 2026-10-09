import { inBackground } from "../lib/graceful-shutdown";
import { randomUUID } from "crypto";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { subscriptions, billingEvents, tenants, users } from "@db/schema";
import { sendTrialEndingEmail, sendRenewalReminderEmail } from "../lib/mailer";
import { countFieldUsersOf } from "../lib/field-users";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { notifyAdmin, tgMessages } from "../lib/telegram";

/**
 * За сколько дней до конца ОПЛАЧЕННОГО срока напомнить директору.
 *
 * Платят заявкой, и между «нажал Продлить» и «тариф включён» проходит звонок
 * и перевод денег — поэтому первое письмо за неделю, а не за три дня, как у
 * пробного.
 */
const RENEWAL_REMINDER_DAYS = [7, 3, 1];

/**
 * Письма директору: пробный кончается через ≤3 дня; оплаченный — через 7, 3 и
 * 1 день. Раньше оплаченный срок не напоминался никак: письма шли только
 * пробным, и платящая организация узнавала о конце срока по запертому входу.
 *
 * Called via GET /api/cron/trial-reminders?secret=CRON_SECRET
 * Schedule with Vercel/Railway cron or an external service (cron-job.org).
 */
export async function runTrialReminders(now = new Date()): Promise<{ sent: number; errors: string[] }> {
  const db      = getDb();
  const in3Days = new Date(now.getTime() + 3 * 86_400_000);
  const in7Days = new Date(now.getTime() + 7 * 86_400_000);
  const daysTo  = (d: Date) => Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
  const billingUrl = `${env.appUrl}/billing`;
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

  // Оплаченные — кроме Stripe: там списание продлевает само.
  const renewing = await db.select()
    .from(subscriptions)
    .where(and(
      eq(subscriptions.status, "active"),
      isNull(subscriptions.stripeSubscriptionId),
      lte(subscriptions.currentPeriodEnds, in7Days),
      gte(subscriptions.currentPeriodEnds, now),
    ));

  const due = [
    ...expiring.map(sub => ({ sub, kind: "trial" as const, daysLeft: daysTo(sub.trialEndsAt!) })),
    ...renewing.map(sub => ({ sub, kind: "renewal" as const, daysLeft: daysTo(sub.currentPeriodEnds!) }))
      .filter(r => RENEWAL_REMINDER_DAYS.includes(r.daysLeft)),
  ];

  for (const { sub, kind, daysLeft } of due) {
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

      // Check we haven't sent this reminder today (idempotency)
      const eventType = `${kind}_reminder_${daysLeft}d`;
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

      // Ссылка — на тарифы в сумах с заявкой. /settings/billing вёл к Stripe
      // в долларах, который здесь не настроен.
      // Цена в письме — для этой организации: по её полевым (contracts/pricing.ts).
      const fieldUsers = await countFieldUsersOf(db, sub.tenantId);
      if (kind === "trial") {
        await sendTrialEndingEmail(ceo.email, tenant.name, daysLeft, billingUrl, fieldUsers);
      } else {
        await sendRenewalReminderEmail(ceo.email, tenant.name, sub.plan, daysLeft, sub.currentPeriodEnds!, billingUrl, fieldUsers);
      }

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

  /*
    Суперадмину — одним сообщением: кто заканчивает и кто закончил за сутки.
    Письма выше уходят арендатору и про его продление; это про деньги
    платформы, и оно не зависит от того, есть ли у организации CEO.
  */
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const trials = await db.select({ org: tenants.name, ends: subscriptions.trialEndsAt })
    .from(subscriptions)
    .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
    .where(and(
      eq(subscriptions.status, "trialing"),
      gte(subscriptions.trialEndsAt, dayAgo),
      lte(subscriptions.trialEndsAt, in3Days),
    ));
  if (trials.length) {
    const ending = trials
      .filter(t => t.ends && t.ends >= now)
      .map(t => ({ org: t.org, days: Math.ceil((t.ends!.getTime() - now.getTime()) / 86_400_000) }));
    const expired = trials.filter(t => t.ends && t.ends < now).map(t => t.org);
    inBackground(notifyAdmin(tgMessages.trials(ending, expired)));
  }

  logger.info("Trial reminders cron", { sent, errors: errors.length });
  return { sent, errors };
}
