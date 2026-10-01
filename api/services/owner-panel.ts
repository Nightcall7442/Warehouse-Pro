import { and, eq, max, ne, sql } from "drizzle-orm";
import { orders, products, subscriptions, tenants, users } from "@db/schema";
import { PLAN_PRICES_UZS, type PlanKey } from "../../contracts/constants";
import { cache } from "../lib/cache";
import { rowsOf } from "../lib/db-rows";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

/* ═══════════════════════════════════════════════════════════════════════════
   Панель владельца: кто платит и кто уходит.

   ── Зачем ──────────────────────────────────────────────────────────────────

   У суперадмина были счётчики «организаций», «заказов» и «выручки» по всей
   платформе — и ни одного ответа на вопросы, с которыми владелец открывает
   страницу: сколько денег в месяц приносят клиенты, кто из платящих замолчал,
   у кого на неделе кончается оплаченный срок, на каком шаге застревают
   пробные. Всё это есть в базе; не было одного места, где это собрано, и
   списка «кому позвонить сегодня» с телефоном.

   ── Кто здесь считается клиентом ───────────────────────────────────────────

   Не системная организация (slug 'system' — дом суперадмина), не песочница
   интегратора (tenants.is_sandbox — выдуманные данные с Exclusive на год) и
   не приостановленная: с приостановленными уже решили, звонить им по этому
   списку незачем — та же оговорка, что в вечерней сводке (cron/admin-digest).

   ── Правила оплаты — те же, что у калитки ──────────────────────────────────

   «Платит» — подписка active, тариф не пробный и срок не кончился; подписка
   без даты конца пускается калиткой как бессрочная (lib/feature-gating.ts) и
   здесь тоже считается платящей. Другое правило значило бы, что панель и
   доступ по-разному отвечают на вопрос «платит ли клиент».

   ── Активность ─────────────────────────────────────────────────────────────

   Заказ (orders.created_at) или вход (users.lastSignInAt — его ставит вход
   по паролю, api/http/auth.ts). Столбец входа заводится вместе с человеком,
   поэтому у только что зарегистрированной организации «последняя
   активность» — момент регистрации. Для списка «молчат» это и нужно: не
   вошёл ни разу за пять дней — тоже молчит.

   Всё считается агрегатами по tenant_id (MAX created_at, GROUP BY) по
   индексам idx_orders_tenant_date, idx_orders_tenant_status,
   idx_orders_tenant_agent и idx_products_tenant — строки заказов не
   читаются. Даты сравниваются здесь, а не в SQL: так одно «сейчас» на весь
   ответ, и проверка может его задать.
   ═══════════════════════════════════════════════════════════════════════════ */

const DAY = 86_400_000;
/** Сколько дней тишины — повод позвонить. */
export const SILENT_DAYS = 5;
/** «Активны» — за сколько дней был заказ или вход. */
export const ACTIVE_DAYS = 7;
/** Горизонт списка продлений. */
export const RENEWAL_DAYS = 14;

/**
 * Этапы пробного — в том порядке, в каком по ним идёт живой клиент.
 * Каждый признак проверяется отдельно: организация, которая завела агента,
 * но не товары, так и показывается — с пропуском, а не «дошла до агента».
 */
export const TRIAL_STAGES = ["registered", "emailVerified", "products", "agent", "agentOrder", "delivered", "paid"] as const;
export type TrialStage = (typeof TRIAL_STAGES)[number];

type Contact = { phone: string | null; email: string | null };
export type PayingRow = Contact & { tenantId: number; name: string; plan: PlanKey; price: number; periodEnds: Date | null };
export type SilentRow = Contact & { tenantId: number; name: string; kind: "paying" | "trial"; plan: PlanKey; lastActivityAt: Date; silentDays: number };
export type RenewalRow = Contact & { tenantId: number; name: string; plan: PlanKey; price: number; periodEnds: Date; daysLeft: number };
export type TrialRow = Contact & {
  tenantId: number; name: string; createdAt: Date; trialEndsAt: Date | null; trialExpired: boolean;
  stage: TrialStage; done: TrialStage[]; source: string | null; lastActivityAt: Date;
};

export interface OwnerPanel {
  generatedAt: Date;
  paying: { count: number; mrr: number; list: PayingRow[] };
  activeLast7: number;
  clients: number;
  silent: SilentRow[];
  renewals: RenewalRow[];
  funnel: { stages: Array<{ key: TrialStage; reached: number }>; trials: TrialRow[] };
}

/**
 * Положение одного клиента — одно правило на панель и на список организаций.
 *
 * Панель владельца (числа сверху консоли) и фильтры списка организаций
 * отвечают на одни и те же вопросы: платит ли, жив ли пробный, молчит ли,
 * когда продлевать. Посчитанные в двух местах, они однажды разошлись бы:
 * плитка «Молчат 5+ дней: 3», а фильтр показывает четыре строки. Поэтому
 * правило здесь, а список (tenant.list) зовёт его же.
 */
export function clientFlags(t: {
  plan: PlanKey; subStatus: string | null; subPeriodEnds: Date | null; trialEnds: Date | null; lastActivityAt: Date;
}, now: Date): { isPaying: boolean; trialLive: boolean; renewalDays: number | null; silentDays: number | null; active7: boolean } {
  const isPaying = t.subStatus === "active" && t.plan !== "trial"
    && (!t.subPeriodEnds || t.subPeriodEnds > now);
  const trialLive = t.subStatus === "trialing" && (!t.trialEnds || t.trialEnds > now);
  const renewalDays = isPaying && t.subPeriodEnds && t.subPeriodEnds.getTime() <= now.getTime() + RENEWAL_DAYS * DAY
    ? Math.ceil((t.subPeriodEnds.getTime() - now.getTime()) / DAY) : null;
  const silentDays = (isPaying || trialLive) && t.lastActivityAt.getTime() < now.getTime() - SILENT_DAYS * DAY
    ? Math.floor((now.getTime() - t.lastActivityAt.getTime()) / DAY) : null;
  const active7 = t.lastActivityAt.getTime() >= now.getTime() - ACTIVE_DAYS * DAY;
  return { isPaying, trialLive, renewalDays, silentDays, active7 };
}

const latest = (...ds: Array<Date | null | undefined>): Date | null =>
  ds.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);

/**
 * Собрать панель — честным обращением к базе, без кеша.
 *
 * Отдельно от кеширующей обёртки: вечерняя сводка (cron/admin-digest) зовёт
 * её раз в сутки и должна видеть базу, а не минутную копию.
 */
export async function collectOwnerPanel(db: Db, now = new Date()): Promise<OwnerPanel> {
  const [clients, lastOrders, people, ceos, withProducts, agentOrders, delivered] = await Promise.all([
    db.select({
      id: tenants.id, name: tenants.name, plan: tenants.plan, createdAt: tenants.createdAt,
      trialEndsAt: tenants.trialEndsAt, ownerPhone: tenants.ownerPhone, ownerEmail: tenants.ownerEmail,
      signupSource: tenants.signupSource,
      subPlan: subscriptions.plan, subStatus: subscriptions.status,
      subTrialEndsAt: subscriptions.trialEndsAt, subPeriodEnds: subscriptions.currentPeriodEnds,
    })
      .from(tenants)
      .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
      .where(and(ne(tenants.slug, "system"), eq(tenants.isSandbox, false), eq(tenants.status, "active"))),

    // Последний заказ — MAX по (tenant_id, created_at): ответ из самого индекса.
    db.select({ tenantId: orders.tenantId, last: max(orders.createdAt) }).from(orders).groupBy(orders.tenantId),

    /*
      Люди одним проходом: последний вход, есть ли агент, подтвердил ли почту
      директор. Вход — через max() построителя, а не сырым SQL: drizzle читает
      время из базы строкой и сам помечает её как UTC, а строка из сырого
      db.execute разобралась бы по часовому поясу машины — и «молчит пять
      дней» съехало бы на пять часов.
    */
    db.select({
      tenantId:    users.tenantId,
      lastLogin:   max(users.lastSignInAt),
      agents:      sql<string>`SUM(${users.role} = 'agent')`,
      ceoVerified: sql<string>`MAX(${users.role} = 'ceo' AND ${users.emailVerifiedAt} IS NOT NULL)`,
    }).from(users).groupBy(users.tenantId),

    // Контакт на случай, если у организации своего нет (заведена до этой правки).
    db.select({ tenantId: users.tenantId, phone: users.phone, email: users.email })
      .from(users).where(eq(users.role, "ceo")).orderBy(users.id),

    db.select({ tenantId: products.tenantId }).from(products).groupBy(products.tenantId),

    /*
      «Первый заказ агентом» — заказ, у которого автор с ролью агента.
      orders.agent_id стоит у каждого заказа (оформил оператор — там оператор),
      поэтому роль проверяется по людям. Внутренняя выборка — пары
      (организация, автор) прямо из индекса idx_orders_tenant_agent.
    */
    db.execute(sql`
      SELECT DISTINCT o.tenant_id AS tenantId
      FROM (SELECT DISTINCT tenant_id, agent_id FROM orders) o
      JOIN users u ON u.id = o.agent_id AND u.role = 'agent'
    `),

    // Доставлен — по статусу заказа (idx_orders_tenant_status).
    db.select({ tenantId: orders.tenantId }).from(orders)
      .where(eq(orders.status, "delivered")).groupBy(orders.tenantId),
  ]);

  const lastOrderOf = new Map(lastOrders.map(r => [Number(r.tenantId), r.last ? new Date(r.last) : null]));
  const peopleOf = new Map(people.map(r => [Number(r.tenantId), {
    lastLogin: r.lastLogin ? new Date(r.lastLogin) : null,
    agents: Number(r.agents ?? 0),
    ceoVerified: Number(r.ceoVerified ?? 0) > 0,
  }]));
  const ceoOf = new Map<number, { phone: string | null; email: string }>();
  for (const c of ceos) if (!ceoOf.has(c.tenantId)) ceoOf.set(c.tenantId, { phone: c.phone, email: c.email });
  const hasProducts = new Set(withProducts.map(r => Number(r.tenantId)));
  const hasAgentOrder = new Set(rowsOf<{ tenantId: number | string }>(agentOrders).map(r => Number(r.tenantId)));
  const hasDelivery = new Set(delivered.map(r => Number(r.tenantId)));

  const paying: PayingRow[] = [];
  const silent: SilentRow[] = [];
  const renewals: RenewalRow[] = [];
  const trials: TrialRow[] = [];
  const reached = new Map<TrialStage, number>(TRIAL_STAGES.map(k => [k, 0]));
  let activeLast7 = 0;

  for (const t of clients) {
    const plan = (t.subPlan ?? t.plan) as PlanKey;
    const who = peopleOf.get(t.id);
    const ceo = ceoOf.get(t.id);
    // `||`, а не `??`: пустая строка в карточке — тоже «нет телефона».
    const contact: Contact = { phone: t.ownerPhone || ceo?.phone || null, email: t.ownerEmail || ceo?.email || null };
    const lastActivityAt = latest(lastOrderOf.get(t.id), who?.lastLogin) ?? t.createdAt;

    const trialEnds = t.subTrialEndsAt ?? t.trialEndsAt;
    const { isPaying, renewalDays, silentDays, active7 } = clientFlags({
      plan, subStatus: t.subStatus, subPeriodEnds: t.subPeriodEnds, trialEnds, lastActivityAt,
    }, now);

    if (active7) activeLast7++;

    if (isPaying) {
      paying.push({ tenantId: t.id, name: t.name, plan, price: PLAN_PRICES_UZS[plan] ?? 0, periodEnds: t.subPeriodEnds, ...contact });
      if (t.subPeriodEnds && renewalDays !== null) {
        renewals.push({
          tenantId: t.id, name: t.name, plan, price: PLAN_PRICES_UZS[plan] ?? 0, periodEnds: t.subPeriodEnds,
          daysLeft: renewalDays, ...contact,
        });
      }
    }

    if (silentDays !== null) {
      silent.push({
        tenantId: t.id, name: t.name, kind: isPaying ? "paying" : "trial", plan, lastActivityAt,
        silentDays, ...contact,
      });
    }

    /*
      Пробные по этапам — все, кто начинал с пробного (у подписки или у
      организации стоит срок пробного), в том числе уже перешедшие на платный:
      иначе последнему этапу нечего было бы считать. Организация, которую
      суперадмин завёл сразу платной, пробного не проходила и сюда не входит.
    */
    const startedAsTrial = Boolean(trialEnds) || plan === "trial";
    if (!startedAsTrial) continue;
    const converted = plan !== "trial";
    const flags: Record<TrialStage, boolean> = {
      registered:    true,
      emailVerified: who?.ceoVerified ?? false,
      products:      hasProducts.has(t.id),
      agent:         (who?.agents ?? 0) > 0,
      agentOrder:    hasAgentOrder.has(t.id),
      delivered:     hasDelivery.has(t.id),
      paid:          converted,
    };
    const done = TRIAL_STAGES.filter(k => flags[k]);
    for (const k of done) reached.set(k, (reached.get(k) ?? 0) + 1);
    if (converted) continue;
    trials.push({
      tenantId: t.id, name: t.name, createdAt: t.createdAt, trialEndsAt: trialEnds ?? null,
      trialExpired: Boolean(trialEnds && trialEnds <= now),
      stage: done[done.length - 1], done, source: t.signupSource ?? null, lastActivityAt, ...contact,
    });
  }

  paying.sort((a, b) => b.price - a.price || a.name.localeCompare(b.name));
  renewals.sort((a, b) => a.periodEnds.getTime() - b.periodEnds.getTime());
  // Сначала платящие: их уход — деньги, которые уже были. Внутри — кто молчит дольше.
  silent.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "paying" ? -1 : 1) || a.lastActivityAt.getTime() - b.lastActivityAt.getTime());
  trials.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return {
    generatedAt: now,
    paying: { count: paying.length, mrr: paying.reduce((s, p) => s + p.price, 0), list: paying },
    activeLast7,
    clients: clients.length,
    silent,
    renewals,
    funnel: { stages: TRIAL_STAGES.map(key => ({ key, reached: reached.get(key) ?? 0 })), trials },
  };
}

/** Ключ минутной копии панели. */
export const OWNER_PANEL_CACHE_KEY = "owner-panel";

/**
 * Панель для экрана — с копией на минуту.
 *
 * Страницу суперадмина открывают и обновляют кнопкой; семь агрегатов по всей
 * базе на каждое обновление незачем, а минута запаздывания для «кто молчит
 * пятый день» ничего не меняет.
 */
export async function ownerPanel(db: Db): Promise<OwnerPanel> {
  const hit = cache.get<OwnerPanel>(OWNER_PANEL_CACHE_KEY);
  if (hit) return hit;
  const panel = await collectOwnerPanel(db);
  cache.set(OWNER_PANEL_CACHE_KEY, panel, 60_000);
  return panel;
}
