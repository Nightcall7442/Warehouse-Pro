import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { subscriptions } from "@db/schema";
import { cache } from "./cache";

/**
 * Насколько долго держим ответ о подписке.
 *
 * Минута — намеренно короткий срок, и выбран он не ради экономии запросов, а
 * чтобы не заводить карту инвалидации. Подписка меняется в пяти местах
 * (регистрация, вебхук Stripe, портал Stripe, правки суперадмина, крон), и
 * список этот будет расти. Кеш, который надо сбрасывать вручную, рано или
 * поздно забудут сбросить — ровно так же, как забыли поставить саму проверку.
 *
 * Что стоит минута задержки: организация, у которой подписка истекла минуту
 * назад, доработает эту минуту; организация, которая только что заплатила,
 * подождёт до минуты. Оба исхода дешевле, чем пропущенная инвалидация.
 */
const ACCESS_TTL_MS = 60_000;

/**
 * Есть ли у организации право работать — с кешем на минуту.
 *
 * Отдельная обёртка, а не кеш внутри самой проверки: сама проверка должна
 * оставаться честным обращением к базе, чтобы её можно было позвать там, где
 * нужен точный ответ (например, сразу после оплаты).
 */
export async function hasSubscriptionAccess(tenantId: number): Promise<boolean> {
  const key = `subaccess:${tenantId}`;
  const cached = cache.get<boolean>(key);
  if (cached !== undefined) return cached;

  const allowed = await checkSubscriptionAccess(tenantId);
  cache.set(key, allowed, ACCESS_TTL_MS);
  return allowed;
}

/** Сбросить кеш доступа — после оплаты, продления или правки плана. */
export function invalidateSubscriptionAccess(tenantId: number): void {
  cache.invalidate(`subaccess:${tenantId}`);
}

/**
 * Returns true if the tenant has an active or trialing subscription.
 * Returns false if canceled, past_due, or no subscription found (grace period: 7 days past_due).
 */
export async function checkSubscriptionAccess(tenantId: number): Promise<boolean> {
  const db = getDb();
  const [sub] = await db.select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);

  if (!sub) return false; // No subscription — should not happen after tenant.register creates one

  // Check trial expiration
  if (sub.status === "trialing" && sub.trialEndsAt && new Date(sub.trialEndsAt) < new Date()) {
    return false;
  }
  // Check period expiration
  if (sub.status === "active" && sub.currentPeriodEnds && new Date(sub.currentPeriodEnds) < new Date()) {
    return false;
  }

  if (sub.status === "active" || sub.status === "trialing") return true;

  // Grace period: 7 days for past_due before blocking
  if (sub.status === "past_due" && sub.currentPeriodEnds) {
    const gracePeriodEnd = new Date(sub.currentPeriodEnds.getTime() + 7 * 86_400_000);
    if (new Date() < gracePeriodEnd) return true;
  }

  return false;
}

/**
 * Get subscription status summary for a tenant.
 */
export async function getSubscriptionStatus(tenantId: number) {
  const db = getDb();
  const [sub] = await db.select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);
  return sub ?? null;
}
