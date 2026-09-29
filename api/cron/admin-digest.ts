import { and, count, eq, gte, inArray, lt, lte, ne, sum } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { orders, subscriptions, tenants } from "@db/schema";
import { inbox } from "../services/support-chat";
import { collectOwnerPanel } from "../services/owner-panel";
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

  const [[reg], [ord], [ending], [due], [active], threads, panel] = await Promise.all([
    db.select({ n: count() }).from(tenants).where(and(client, gte(tenants.createdAt, dayAgo))),
    db.select({ n: count(), revenue: sum(orders.total) }).from(orders).where(gte(orders.createdAt, dayAgo)),
    db.select({ n: count() }).from(subscriptions).where(and(
      eq(subscriptions.status, "trialing"),
      gte(subscriptions.trialEndsAt, now),
      lte(subscriptions.trialEndsAt, in3Days),
    )),
    /*
      Просрочка — по сроку оплаченного, а не по состоянию Stripe.

      Считалось `status = past_due`, а его ставит только вебхук Stripe; в
      сумах платят заявкой, и суперадмин включает тариф руками — у таких
      подписок статус остаётся active и после конца срока. Число всегда было
      ноль. Приостановленные не считаются: с ними уже решили.
    */
    db.select({ n: count() }).from(subscriptions)
      .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
      .where(and(
        client, eq(tenants.status, "active"),
        inArray(subscriptions.status, ["active", "past_due"]),
        lt(subscriptions.currentPeriodEnds, now),
      )),
    db.select({ n: count() }).from(tenants).where(and(client, eq(tenants.status, "active"))),
    inbox(),
    /*
      Кому звонить завтра — из той же панели, что у суперадмина на экране:
      «продление» и «молчит» там и здесь одни и те же, а не две похожие
      выборки, которые однажды разойдутся. Без минутной копии: сводка раз в
      сутки и должна видеть базу.
    */
    collectOwnerPanel(db, now),
  ]);
  const weekAhead = now.getTime() + 7 * 86_400_000;

  const digest = {
    registrations: Number(reg?.n ?? 0),
    orders:        Number(ord?.n ?? 0),
    revenue:       Number(ord?.revenue ?? 0),
    unanswered:    threads.filter(t => t.unread > 0).length,
    trialsEnding:  Number(ending?.n ?? 0),
    pastDue:       Number(due?.n ?? 0),
    activeTenants: Number(active?.n ?? 0),
    renewalsThisWeek: panel.renewals.filter(r => r.periodEnds.getTime() <= weekAhead).map(r => r.name),
    silent:        panel.silent.length,
  };
  const sent = await notifyAdmin(tgMessages.adminDigest(digest));
  logger.info("admin digest", { ...digest, sent });
  return { sent };
}
