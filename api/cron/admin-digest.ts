import { and, count, eq, gte, lte, ne, sum } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { orders, subscriptions, tenants } from "@db/schema";
import { inbox } from "../services/support-chat";
import { notifyAdmin, tgMessages } from "../lib/telegram";
import { logger } from "../lib/logger";

/**
 * Вечерняя сводка суперадмину: что случилось на платформе за сутки.
 *
 * События (регистрация, оплата, провал крона) приходят сразу, по одному.
 * Здесь — то, что не событие, а состояние: сколько заказов прошло по всем
 * организациям, кто ждёт ответа поддержки, у кого кончается пробный период,
 * кто просрочил оплату. Одно сообщение в день, из расписания (21:00).
 */
export async function runAdminDigest(now = new Date()): Promise<{ sent: boolean }> {
  const db = getDb();
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const in3Days = new Date(now.getTime() + 3 * 86_400_000);
  // Системная организация — не клиент; та же оговорка, что в platformStats.
  const client = ne(tenants.slug, "system");

  const [[reg], [ord], [ending], [due], [active], threads] = await Promise.all([
    db.select({ n: count() }).from(tenants).where(and(client, gte(tenants.createdAt, dayAgo))),
    db.select({ n: count(), revenue: sum(orders.total) }).from(orders).where(gte(orders.createdAt, dayAgo)),
    db.select({ n: count() }).from(subscriptions).where(and(
      eq(subscriptions.status, "trialing"),
      gte(subscriptions.trialEndsAt, now),
      lte(subscriptions.trialEndsAt, in3Days),
    )),
    db.select({ n: count() }).from(subscriptions).where(eq(subscriptions.status, "past_due")),
    db.select({ n: count() }).from(tenants).where(and(client, eq(tenants.status, "active"))),
    inbox(),
  ]);

  const digest = {
    registrations: Number(reg?.n ?? 0),
    orders:        Number(ord?.n ?? 0),
    revenue:       Number(ord?.revenue ?? 0),
    unanswered:    threads.filter(t => t.unread > 0).length,
    trialsEnding:  Number(ending?.n ?? 0),
    pastDue:       Number(due?.n ?? 0),
    activeTenants: Number(active?.n ?? 0),
  };
  const sent = await notifyAdmin(tgMessages.adminDigest(digest));
  logger.info("admin digest", { ...digest, sent });
  return { sent };
}
