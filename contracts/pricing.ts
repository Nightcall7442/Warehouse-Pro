/* ═══════════════════════════════════════════════════════════════════════════
   ЦЕНА — ЗА ПОЛЕВОГО СОТРУДНИКА.

   Решение владельца 05.10.2026 (вариант «A»): платят только за тех, кто
   работает в поле, — агентов, курьеров, мерчендайзеров. Директор, оператор,
   склад, бухгалтер и супервайзер бесплатны: они сидят в офисе и сами по себе
   выручки не приносят, а брать за них деньги значило бы наказывать за то,
   что в компании есть учёт.

     • 119 000 сум в месяц за каждого полевого сотрудника;
     • минимум три — 357 000 сум в месяц за платную организацию;
     • предоплата за год — минус 15 %;
     • никаких пределов: ни по заказам, ни по товарам, ни по людям;
     • все функции продукта — у всех; отдельно, по запросу, только услуги
       (SERVICE_FEATURES в constants.ts: перенос данных, выделенный сервер,
       приоритетная поддержка) — их делают люди и железо, а не код.

   ── Прежние тарифы ──────────────────────────────────────────────────────────

   Кто уже платит по Basic / Pro / Exclusive, ещё год живёт по прежней цене
   и с прежними пределами — до GRANDFATHER_UNTIL. До этой даты для него не
   меняется ничего. С неё — та же цена за полевого сотрудника, что у всех:
   effectivePlan() превращает прежний тариф в «Стандарт» сам, без крона и без
   правки базы. Дата одна — здесь.

   ── Один источник ───────────────────────────────────────────────────────────

   Этот модуль читают сервер (заявка, подписка, MRR, письма), экран оплаты,
   консоль суперадмина и лендинг. Ни одно число отсюда не переписано
   где-то ещё: страж `pricing-one-source.test.ts` ищет 119 000 в компонентах.
   Модуль чистый — ни базы, ни часов: «сегодня» передаёт вызывающий.
   ═══════════════════════════════════════════════════════════════════════════ */

import type { PlanKey } from "./constants";
import { addMonths, tashkentDay } from "./subscription-payment";

/** Сколько стоит один полевой сотрудник в месяц, сум. */
export const FIELD_PRICE_UZS = 119_000;

/** Меньше скольких полевых не считаем: платная организация платит хотя бы за троих. */
export const MIN_FIELD_USERS = 3;

/** Скидка за предоплату года. 12 × месяц × 0,85. */
export const ANNUAL_DISCOUNT = 0.15;

/**
 * Первый день новой цены для прежних тарифов (по Ташкенту).
 *
 * До 04.10.2027 включительно Basic / Pro / Exclusive платят по-старому и
 * живут со своими пределами; 05.10.2027 — уже цена за полевого сотрудника.
 */
export const GRANDFATHER_UNTIL = "2027-10-05";

/**
 * Полевые роли — за них платят.
 *
 * Супервайзер НЕ здесь, хотя в Контроле (services/control.ts) он стоит рядом
 * с агентами: там речь о том, чьи действия проверять, а здесь — за кого
 * платить. Супервайзер руководит полем из офиса и бесплатен, как директор.
 */
export const FIELD_ROLES = ["agent", "courier", "merchandiser"] as const;
export type FieldRole = (typeof FIELD_ROLES)[number];

/** Прежние тарифы — живут до GRANDFATHER_UNTIL. Новым организациям не продаются. */
export const LEGACY_PLANS = ["basic", "pro", "exclusive"] as const;
export type LegacyPlan = (typeof LEGACY_PLANS)[number];

/** Цены прежних тарифов, сум/мес — только для тех, кто на них уже сидит. */
export const LEGACY_PRICES_UZS: Record<LegacyPlan, number> = {
  basic:     299_000,
  pro:       599_000,
  exclusive: 1_299_000,
};

/**
 * Надбавки прежних тарифов: место и позиция сверх предела, сум/мес.
 *
 * В новой модели пределов нет, и докупать нечего. Остаются для прежних
 * тарифов до GRANDFATHER_UNTIL: у кого надбавка уже куплена, у того она и
 * работает, и стоит столько же.
 */
export const LEGACY_EXTRA_PRICES_UZS = {
  user:    35_000,
  product: 5_000,
} as const;

export function isFieldRole(role: string): role is FieldRole {
  return (FIELD_ROLES as readonly string[]).includes(role);
}

/**
 * Сколько полевых сотрудников в организации.
 *
 * Считаются только активные. Отключённого (status = inactive) нет: он не
 * может войти и ничего не продаст, а платить за уволенного — это ровно то,
 * за что ненавидят «оплату за место». Сервер считает тем же правилом в SQL
 * (api/lib/field-users.ts).
 */
export function countFieldUsers(people: ReadonlyArray<{ role: string; status: string }>): number {
  return people.filter(p => p.status === "active" && isFieldRole(p.role)).length;
}

/** За скольких берутся деньги: не меньше минимума. */
export function billedFieldUsers(fieldUsers: number): number {
  const n = Math.max(0, Math.floor(Number(fieldUsers) || 0));
  return Math.max(MIN_FIELD_USERS, n);
}

/** Месяц по новой цене, сум. */
export function monthlyPrice(fieldUsers: number): number {
  return billedFieldUsers(fieldUsers) * FIELD_PRICE_UZS;
}

/** Год предоплатой: 12 месяцев минус ANNUAL_DISCOUNT, целыми сумами. */
export function annualPrice(fieldUsers: number): number {
  return Math.round(monthlyPrice(fieldUsers) * 12 * (1 - ANNUAL_DISCOUNT));
}

/** Сколько экономит год предоплатой против двенадцати месяцев. */
export function annualSaving(fieldUsers: number): number {
  return monthlyPrice(fieldUsers) * 12 - annualPrice(fieldUsers);
}

export function isLegacyPlan(plan: string): plan is LegacyPlan {
  return (LEGACY_PLANS as readonly string[]).includes(plan);
}

/** Прежний тариф и прежняя цена ещё действуют — по ташкентскому дню `today`. */
export function isGrandfathered(plan: string, today: Date): boolean {
  return isLegacyPlan(plan) && tashkentDay(today) < GRANDFATHER_UNTIL;
}

/**
 * Тариф, по которому организация живёт на самом деле.
 *
 * В базе может стоять «pro» и после 05.10.2027 — переписывать её никто не
 * обязан. Всё, что решает цену, пределы и доступ, спрашивает здесь.
 */
export function effectivePlan(plan: string, today: Date): PlanKey {
  if (isLegacyPlan(plan) && !isGrandfathered(plan, today)) return "standard";
  return plan as PlanKey;
}

/**
 * Можно ли включить организации с тарифом `currentPlan` тариф `plan`.
 *
 * Новый («Стандарт», пробный) — всегда. Прежний — только продлить СВОЙ и только
 * пока он действует: подключить Basic заново или перейти с Pro на Exclusive
 * нельзя, иначе прежняя лестница продавалась бы и дальше.
 */
export function planSellable(currentPlan: string, plan: string, today: Date): boolean {
  return !isLegacyPlan(plan) || (currentPlan === plan && isGrandfathered(plan, today));
}

export type PriceModel = "trial" | "perField" | "legacy";

export interface TenantPrice {
  /** Тариф с учётом даты: прежний после GRANDFATHER_UNTIL — уже «standard». */
  plan: PlanKey;
  model: PriceModel;
  /** Сколько организация платит в месяц сейчас. Пробный — ноль. */
  monthly: number;
  /** Год предоплатой по нынешней модели (у прежних тарифов скидки за год нет). */
  annual: number;
  fieldUsers: number;
  billedFieldUsers: number;
  /** До какого дня действует прежняя цена; null — не прежний тариф. */
  grandfatheredUntil: string | null;
  /** Цена за полевых — после пробного или после GRANDFATHER_UNTIL. */
  nextMonthly: number;
  nextAnnual: number;
}

/**
 * Сколько платит организация с тарифом `plan` и `fieldUsers` полевыми на день `today`.
 *
 * Пробный — бесплатен, но `nextMonthly` говорит, во что он обойдётся.
 * Прежний тариф до даты — по прежней цене (надбавки считаются отдельно, как
 * и раньше: LEGACY_EXTRA_PRICES_UZS), после — как все.
 */
export function priceForTenant(plan: string, fieldUsers: number, today: Date): TenantPrice {
  const eff = effectivePlan(plan, today);
  const n = Math.max(0, Math.floor(Number(fieldUsers) || 0));
  const base = {
    plan: eff,
    fieldUsers: n,
    billedFieldUsers: billedFieldUsers(n),
    nextMonthly: monthlyPrice(n),
    nextAnnual: annualPrice(n),
  };
  if (eff === "trial") {
    return { ...base, model: "trial", monthly: 0, annual: 0, grandfatheredUntil: null };
  }
  if (isLegacyPlan(eff)) {
    const monthly = LEGACY_PRICES_UZS[eff];
    return { ...base, model: "legacy", monthly, annual: monthly * 12, grandfatheredUntil: GRANDFATHER_UNTIL };
  }
  return { ...base, model: "perField", monthly: base.nextMonthly, annual: base.nextAnnual, grandfatheredUntil: null };
}

export interface PeriodBreakdown {
  /** Месяцев по прежней цене (до GRANDFATHER_UNTIL). */
  legacyMonths: number;
  /** Месяцев по цене за полевых. */
  perFieldMonths: number;
  /** Сколько из них ушло полными годами со скидкой. */
  years: number;
  amount: number;
}

/**
 * Сколько взять за оплату на `months` месяцев с начала периода `from` — и из чего.
 *
 * Помесячно, потому что прежний тариф может пересечь GRANDFATHER_UNTIL
 * посреди периода: месяцы, начавшиеся до даты, — по прежней цене, после — за
 * полевых. Каждые полные 12 месяцев по новой цене идут годом со скидкой.
 * Пробный не оплачивается — ноль.
 */
export function periodBreakdown(plan: string, fieldUsers: number, months: number, from: Date): PeriodBreakdown {
  const m = Math.max(0, Math.floor(months));
  if (plan === "trial" || m === 0) return { legacyMonths: 0, perFieldMonths: 0, years: 0, amount: 0 };
  let legacyMonths = 0;
  for (let i = 0; i < m; i++) if (isGrandfathered(plan, addMonths(from, i))) legacyMonths++;
  const perFieldMonths = m - legacyMonths;
  const years = Math.floor(perFieldMonths / 12);
  const legacy = legacyMonths ? legacyMonths * LEGACY_PRICES_UZS[plan as LegacyPlan] : 0;
  const amount = legacy + years * annualPrice(fieldUsers) + (perFieldMonths % 12) * monthlyPrice(fieldUsers);
  return { legacyMonths, perFieldMonths, years, amount };
}

/** Только сумма — см. periodBreakdown. */
export function amountForPeriod(plan: string, fieldUsers: number, months: number, from: Date): number {
  return periodBreakdown(plan, fieldUsers, months, from).amount;
}

/** «1 234 000» — деньги с пробелами, как везде в продукте. */
export function formatSum(n: number): string {
  return Math.round(n).toLocaleString("ru-RU");
}

/** «05.10.2027» из «2027-10-05». */
export function formatDay(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}
