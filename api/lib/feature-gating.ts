import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { subscriptions, tenants } from "@db/schema";
import { cache } from "./cache";
import { subscriptionAccess, accessAllowed, type SubscriptionAccess } from "../../contracts/subscription-access";

/**
 * Насколько долго держим ответ о подписке.
 *
 * Минута — намеренно короткий срок, и выбран он не ради экономии запросов, а
 * чтобы не заводить карту инвалидации. Подписка меняется в пяти местах
 * (регистрация, вебхук Stripe, портал Stripe, правки суперадмина, крон), и
 * список этот будет расти. Кеш, который надо сбрасывать вручную, рано или
 * поздно забудут сбросить — ровно так же, как забыли поставить саму проверку.
 *
 * Что стоит минута задержки: организация, у которой 24 часа предупреждения
 * кончились минуту назад, доработает эту минуту; организация, которая только
 * что заплатила, подождёт до минуты. Оба исхода дешевле, чем пропущенная
 * инвалидация.
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
 * Состояние доступа организации — и запись предупреждения, если пора.
 *
 * Правило — contracts/subscription-access.ts (решение владельца 10.10.2026):
 * срок кончился → предупреждение → 24 часа → доступ закрыт. Здесь только
 * чтение строк и запись того, что правило велит записать: время первого
 * предупреждения (с него идут 24 часа) или его стирание после продления.
 *
 * Зовут калитка (через checkSubscriptionAccess), полоса на сайте
 * (stripe.getSubscription) и лента объявлений мобилки — кто бы ни спросил
 * первым после конца срока, отсчёт начнётся с этого момента.
 */
export async function resolveSubscriptionAccess(tenantId: number, now = new Date()): Promise<SubscriptionAccess> {
  const db = getDb();
  const [row] = await db.select({
    status:            subscriptions.status,
    trialEndsAt:       subscriptions.trialEndsAt,
    currentPeriodEnds: subscriptions.currentPeriodEnds,
    expiryNoticeAt:    subscriptions.expiryNoticeAt,
    tenantTrialEndsAt: tenants.trialEndsAt,
    planExpiresAt:     tenants.planExpiresAt,
  })
    .from(subscriptions)
    .leftJoin(tenants, eq(tenants.id, subscriptions.tenantId))
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);

  const access = subscriptionAccess(
    row ?? null,
    row ? { trialEndsAt: row.tenantTrialEndsAt, planExpiresAt: row.planExpiresAt } : null,
    now,
  );

  if (access.state === "grace" && access.writeNotice) {
    await db.update(subscriptions).set({ expiryNoticeAt: access.noticeAt }).where(eq(subscriptions.tenantId, tenantId));
  } else if (access.state === "ok" && access.clearNotice) {
    await db.update(subscriptions).set({ expiryNoticeAt: null }).where(eq(subscriptions.tenantId, tenantId));
  }
  return access;
}

/**
 * Пускать ли организацию: подписка действует или идут 24 часа предупреждения
 * после её конца. Без кеша — для мест, где нужен точный ответ.
 */
export async function checkSubscriptionAccess(tenantId: number): Promise<boolean> {
  return accessAllowed(await resolveSubscriptionAccess(tenantId));
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
