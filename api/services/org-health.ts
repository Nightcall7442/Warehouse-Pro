import { and, eq, ne, sql } from "drizzle-orm";
import { orders, subscriptions, tenants, users } from "@db/schema";
import { type PlanKey } from "../../contracts/constants";
import { cache } from "../lib/cache";
import { OWNER_PANEL_CACHE_KEY } from "./owner-panel";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

/* ═══════════════════════════════════════════════════════════════════════════
   «Здоровье» организации: оценка 0–100 и флаг «уходит».

   ── Зачем ──────────────────────────────────────────────────────────────────

   Консоль показывала по отдельности «молчат 5+ дней», «истекают ≤14 дней»,
   заказы за 30 дней — и складывать это в голове приходилось владельцу. Клиент,
   у которого заказы упали втрое, а вход ещё случается, не попадал ни в один
   список, пока не замолкал совсем. Здесь те же данные собраны в одну оценку и,
   главное, в причины словами: «заказы упали на 64% к прошлому месяцу».

   ── Из чего оценка (веса — HEALTH_WEIGHTS, в сумме 100) ─────────────────────

   · активность, 30: дни с последнего заказа или входа;
   · тренд заказов, 25: заказы за 30 дней против прошлых 30;
   · оплата, 20: сколько осталось оплаченного (пробного) срока, истёк ли;
   · широта, 15: сколько из пяти рабочих разделов в ходу — товары, магазины,
     заказы агентов, доставки, GPS (те же следы, что у featureUsage/getDetail);
   · люди, 10: доля сотрудников, работавших за 30 дней (вход или свой заказ).

   Уровень: «Уходит» — по явному правилу ниже, не по числу; иначе 70+ —
   «Здорова», ниже — «Под наблюдением».

   ── Правило «уходит» ────────────────────────────────────────────────────────

   Только для организаций на ПЛАТНОМ тарифе (не пробный): их уход — деньги,
   которые уже были. Пробный, который молчит, — «не начал», для него есть
   воронка пробных. Уходит, если выполнено хоть одно:
     1) 7+ дней без заказов и входов;
     2) заказы за 30 дней упали вдвое и больше к прошлым 30 — при прошлых
        хотя бы CHURN_MIN_PREV заказах: «4 → 2» — шум, а не обвал;
     3) оплаченный срок кончается через 7 дней или раньше, или уже кончился
        (подписка не active — тоже): продлённый срок отодвинулся бы дальше.

   ── Как считается ──────────────────────────────────────────────────────────

   Одним запросом на все организации: строка организации и коррелированные
   подзапросы по индексам (orders: tenant+created_at, users: tenant, products,
   shops, agent_locations: tenant+created_at). Число запросов не растёт с
   числом организаций. Окна «30 дней» — по NOW() базы, «дни с последней
   активности» и сроки — по одному «сейчас» в коде (его задаёт проверка).
   Копия на минуту — как у панели владельца; действия, меняющие срок или
   статус, сбрасывают её (invalidateOrgHealth).
   ═══════════════════════════════════════════════════════════════════════════ */

const DAY = 86_400_000;

export const HEALTH_WEIGHTS = { activity: 30, trend: 25, payment: 20, breadth: 15, people: 10 } as const;
export type HealthPart = keyof typeof HEALTH_WEIGHTS;

/** С какой оценки организация «Здорова». */
export const HEALTHY_FROM = 70;
/** Правило 1: столько дней без заказов и входов — платящая уходит. */
export const CHURN_SILENT_DAYS = 7;
/** Правило 2: заказы упали до этой доли прошлых 30 дней или ниже. */
export const CHURN_DROP_RATIO = 0.5;
/** Правило 2 действует, если прошлых заказов было хотя бы столько. */
export const CHURN_MIN_PREV = 10;
/** Правило 3: столько дней (и меньше) осталось оплаченного срока. */
export const CHURN_RENEWAL_DAYS = 7;

/** Пять рабочих разделов для «широты». */
export const BREADTH_AREAS = [
  { key: "products", label: "товары" },
  { key: "shops", label: "магазины" },
  { key: "agentOrders", label: "заказы агентов" },
  { key: "deliveries", label: "доставки" },
  { key: "gps", label: "GPS" },
] as const;
type Area = (typeof BREADTH_AREAS)[number]["key"];

export type HealthLevel = "healthy" | "watch" | "churn";
export type ReasonTone = "good" | "bad" | "neutral";

export interface HealthFacts {
  plan: PlanKey;
  subStatus: string | null;
  subPeriodEnds: Date | null;
  trialEnds: Date | null;
  createdAt: Date;
  lastOrderAt: Date | null;
  lastLoginAt: Date | null;
  orders30: number;
  ordersPrev30: number;
  users: number;
  activeUsers: number;
  areas: Record<Area, boolean>;
}

export interface OrgHealth {
  score: number;
  level: HealthLevel;
  churn: boolean;
  /** Какие правила «уходит» сработали — словами. Пусто, если не уходит. */
  churnBecause: string[];
  /** Почему такая оценка — плохое сверху. */
  reasons: Array<{ tone: ReasonTone; text: string }>;
  parts: Record<HealthPart, number>;
}

/** «1 день», «3 дня», «8 дней». */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100, b = a % 10;
  const w = a > 10 && a < 20 ? forms[2] : b === 1 ? forms[0] : b >= 2 && b <= 4 ? forms[1] : forms[2];
  return `${n} ${w}`;
}
const days = (n: number) => plural(n, ["день", "дня", "дней"]);
const ofPeople = (n: number) => plural(n, ["сотрудника", "сотрудников", "сотрудников"]);

/**
 * Оценка одной организации — без базы: проверка задаёт факты и «сейчас».
 */
export function scoreOrgHealth(f: HealthFacts, now: Date): OrgHealth {
  const reasons: OrgHealth["reasons"] = [];
  const parts = { activity: 0, trend: 0, payment: 0, breadth: 0, people: 0 } as Record<HealthPart, number>;

  // ── Активность ──────────────────────────────────────────────────────────
  const last = [f.lastOrderAt, f.lastLoginAt].reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null) ?? f.createdAt;
  const silent = Math.max(0, Math.floor((now.getTime() - last.getTime()) / DAY));
  parts.activity = silent <= 2 ? 30 : silent <= 6 ? 20 : silent <= 13 ? 8 : 0;
  if (silent >= 3) reasons.push({ tone: "bad", text: `${days(silent)} без заказов и входов` });
  else reasons.push({ tone: "good", text: silent === 0 ? "работали сегодня" : silent === 1 ? "работали вчера" : `работали ${days(silent)} назад` });

  // ── Тренд заказов ───────────────────────────────────────────────────────
  const cur = f.orders30, prev = f.ordersPrev30;
  if (cur === 0 && prev === 0) {
    parts.trend = 0;
    reasons.push({ tone: "bad", text: "за 60 дней ни одного заказа" });
  } else if (prev === 0) {
    parts.trend = 25;
    reasons.push({ tone: "good", text: `заказы пошли: ${cur} за 30 дней` });
  } else {
    const ratio = cur / prev;
    parts.trend = ratio >= 1 ? 25 : ratio >= 0.8 ? 18 : ratio >= 0.5 ? 8 : 0;
    const pct = Math.round(Math.abs(ratio - 1) * 100);
    if (ratio < 0.8) reasons.push({ tone: "bad", text: `заказы упали на ${pct}% к прошлому месяцу (${cur} против ${prev})` });
    else if (ratio >= 1.1) reasons.push({ tone: "good", text: `заказы выросли на ${pct}% к прошлому месяцу (${cur} против ${prev})` });
    else reasons.push({ tone: "neutral", text: `заказы на уровне прошлого месяца (${cur} против ${prev})` });
  }

  // ── Оплата ──────────────────────────────────────────────────────────────
  const onPaidPlan = f.plan !== "trial" && f.subStatus !== "trialing";
  let daysLeft: number | null = null;
  if (onPaidPlan) {
    const active = f.subStatus === "active";
    daysLeft = !active ? -1 : f.subPeriodEnds ? Math.ceil((f.subPeriodEnds.getTime() - now.getTime()) / DAY) : null;
    if (daysLeft === null) { parts.payment = 20; reasons.push({ tone: "good", text: "оплачено бессрочно" }); }
    else if (daysLeft <= 0) {
      parts.payment = 0;
      reasons.push({ tone: "bad", text: !active ? "подписка не оплачена" : daysLeft === 0 ? "оплаченный срок истекает сегодня" : `оплата истекла ${days(-daysLeft)} назад` });
    } else if (daysLeft <= 7) { parts.payment = 6; reasons.push({ tone: "bad", text: `срок истекает через ${days(daysLeft)}` }); }
    else if (daysLeft <= 14) { parts.payment = 14; reasons.push({ tone: "neutral", text: `срок истекает через ${days(daysLeft)}` }); }
    else { parts.payment = 20; reasons.push({ tone: "good", text: `оплачено ещё на ${days(daysLeft)}` }); }
  } else {
    const t = f.trialEnds;
    const left = t ? Math.ceil((t.getTime() - now.getTime()) / DAY) : null;
    if (left === null) { parts.payment = 12; reasons.push({ tone: "neutral", text: "пробный без срока" }); }
    else if (left <= 0) { parts.payment = 0; reasons.push({ tone: "bad", text: "пробный истёк, оплаты нет" }); }
    else if (left <= 3) { parts.payment = 6; reasons.push({ tone: "bad", text: `пробный кончается через ${days(left)}` }); }
    else { parts.payment = 12; reasons.push({ tone: "neutral", text: `пробный, осталось ${days(left)}` }); }
  }

  // ── Широта ──────────────────────────────────────────────────────────────
  const inUse = BREADTH_AREAS.filter(a => f.areas[a.key]);
  parts.breadth = inUse.length * 3;
  const missing = BREADTH_AREAS.filter(a => !f.areas[a.key]).map(a => a.label);
  if (inUse.length <= 2) reasons.push({ tone: "bad", text: `в ходу ${inUse.length} из 5 разделов${missing.length ? `; нет: ${missing.join(", ")}` : ""}` });
  else if (inUse.length === 5) reasons.push({ tone: "good", text: "в ходу все 5 разделов: товары, магазины, заказы агентов, доставки, GPS" });
  else reasons.push({ tone: "neutral", text: `в ходу ${inUse.length} из 5 разделов; нет: ${missing.join(", ")}` });

  // ── Люди ────────────────────────────────────────────────────────────────
  const share = f.users > 0 ? f.activeUsers / f.users : 0;
  parts.people = Math.round(share * 10);
  if (f.users > 0) {
    const text = `за 30 дней работали ${f.activeUsers} из ${ofPeople(f.users)}`;
    reasons.push({ tone: share >= 0.7 ? "good" : share < 0.5 ? "bad" : "neutral", text });
  }

  const score = Math.max(0, Math.min(100, Object.values(parts).reduce((a, b) => a + b, 0)));

  // ── Уходит ──────────────────────────────────────────────────────────────
  const churnBecause: string[] = [];
  if (onPaidPlan) {
    if (silent >= CHURN_SILENT_DAYS) churnBecause.push(`${days(silent)} без заказов и входов`);
    if (prev >= CHURN_MIN_PREV && cur <= prev * CHURN_DROP_RATIO) churnBecause.push(`заказы упали на ${Math.round((1 - cur / prev) * 100)}% к прошлому месяцу`);
    if (daysLeft !== null && daysLeft <= CHURN_RENEWAL_DAYS) {
      churnBecause.push(daysLeft > 0 ? `срок истекает через ${days(daysLeft)}, продления нет` : "оплаченный срок кончился, продления нет");
    }
  }
  const churn = churnBecause.length > 0;
  const level: HealthLevel = churn ? "churn" : score >= HEALTHY_FROM ? "healthy" : "watch";

  const order: Record<ReasonTone, number> = { bad: 0, neutral: 1, good: 2 };
  reasons.sort((a, b) => order[a.tone] - order[b.tone]);
  return { score, level, churn, churnBecause, reasons, parts };
}


/**
 * Собрать оценки всех клиентов — одним запросом, без кеша.
 * Клиент — как у панели владельца: не системная, не песочница, не приостановленная.
 */
export async function collectOrgHealth(db: Db, now = new Date()): Promise<Map<number, OrgHealth>> {
  // Подзапросы — текстом: имена таблиц буквально (внешняя строка — `tenants`),
  // окна — по NOW() базы, без подстановок.
  const rows = await db.select({
    id: tenants.id, plan: tenants.plan, createdAt: tenants.createdAt, trialEndsAt: tenants.trialEndsAt,
    subPlan: subscriptions.plan, subStatus: subscriptions.status,
    subTrialEndsAt: subscriptions.trialEndsAt, subPeriodEnds: subscriptions.currentPeriodEnds,
    // Время — через декодер столбца: drizzle читает его строкой как UTC.
    lastOrderAt: sql`(SELECT MAX(o.created_at) FROM orders o WHERE o.tenant_id = tenants.id)`.mapWith(orders.createdAt),
    lastLoginAt: sql`(SELECT MAX(u.lastSignInAt) FROM users u WHERE u.tenant_id = tenants.id)`.mapWith(users.lastSignInAt),
    orders30: sql`(SELECT COUNT(*) FROM orders o WHERE o.tenant_id = tenants.id AND o.created_at >= NOW() - INTERVAL 30 DAY AND o.deleted_at IS NULL AND o.status <> 'cancelled')`.mapWith(Number),
    ordersPrev30: sql`(SELECT COUNT(*) FROM orders o WHERE o.tenant_id = tenants.id AND o.created_at >= NOW() - INTERVAL 60 DAY AND o.created_at < NOW() - INTERVAL 30 DAY AND o.deleted_at IS NULL AND o.status <> 'cancelled')`.mapWith(Number),
    users: sql`(SELECT COUNT(*) FROM users u WHERE u.tenant_id = tenants.id AND u.status = 'active')`.mapWith(Number),
    /*
      «Работал» — входил за 30 дней или сам оформил заказ: агент с телефона
      входит раз в месяцы (сессия долгая), и по одному входу он выглядел бы
      пропавшим, хотя каждый день пишет заказы.
    */
    activeUsers: sql`(SELECT COUNT(*) FROM users u WHERE u.tenant_id = tenants.id AND u.status = 'active'
      AND (u.lastSignInAt >= NOW() - INTERVAL 30 DAY
        OR EXISTS (SELECT 1 FROM orders o WHERE o.tenant_id = tenants.id AND o.agent_id = u.id AND o.created_at >= NOW() - INTERVAL 30 DAY)))`.mapWith(Number),
    products: sql`EXISTS (SELECT 1 FROM products p WHERE p.tenant_id = tenants.id)`.mapWith(Number),
    shops: sql`EXISTS (SELECT 1 FROM shops s WHERE s.tenant_id = tenants.id)`.mapWith(Number),
    agentOrders: sql`EXISTS (SELECT 1 FROM orders o JOIN users u ON u.id = o.agent_id AND u.role = 'agent'
      WHERE o.tenant_id = tenants.id AND o.created_at >= NOW() - INTERVAL 30 DAY)`.mapWith(Number),
    deliveries: sql`EXISTS (SELECT 1 FROM orders o WHERE o.tenant_id = tenants.id AND o.status = 'delivered' AND o.created_at >= NOW() - INTERVAL 30 DAY)`.mapWith(Number),
    gps: sql`EXISTS (SELECT 1 FROM agent_locations a WHERE a.tenant_id = tenants.id AND a.created_at >= NOW() - INTERVAL 30 DAY)`.mapWith(Number),
  })
    .from(tenants)
    .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .where(and(ne(tenants.slug, "system"), eq(tenants.isSandbox, false), eq(tenants.status, "active")));

  const out = new Map<number, OrgHealth>();
  for (const r of rows) {
    out.set(Number(r.id), scoreOrgHealth({
      plan: (r.subPlan ?? r.plan) as PlanKey,
      subStatus: r.subStatus ?? null,
      subPeriodEnds: r.subPeriodEnds ?? null,
      trialEnds: r.subTrialEndsAt ?? r.trialEndsAt ?? null,
      createdAt: r.createdAt,
      lastOrderAt: r.lastOrderAt ?? null,
      lastLoginAt: r.lastLoginAt ?? null,
      orders30: r.orders30 ?? 0,
      ordersPrev30: r.ordersPrev30 ?? 0,
      users: r.users ?? 0,
      activeUsers: r.activeUsers ?? 0,
      areas: {
        products: Boolean(r.products), shops: Boolean(r.shops), agentOrders: Boolean(r.agentOrders),
        deliveries: Boolean(r.deliveries), gps: Boolean(r.gps),
      },
    }, now));
  }
  return out;
}

export const ORG_HEALTH_CACHE_KEY = "org-health";

/** Оценки с копией на минуту — как панель владельца. */
export async function orgHealth(db: Db): Promise<Map<number, OrgHealth>> {
  const hit = cache.get<Map<number, OrgHealth>>(ORG_HEALTH_CACHE_KEY);
  if (hit) return hit;
  const map = await collectOrgHealth(db);
  cache.set(ORG_HEALTH_CACHE_KEY, map, 60_000);
  return map;
}

/**
 * Сбросить минутные копии консоли после действия, меняющего срок, тариф или
 * статус: записанная оплата не должна минуту висеть «истекает через 3 дня».
 */
export function invalidateOrgHealth(): void {
  cache.invalidate(ORG_HEALTH_CACHE_KEY);
  cache.invalidate(OWNER_PANEL_CACHE_KEY);
}
