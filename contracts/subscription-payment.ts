/*
  Оплаты подписок: способы, период и деньги месяца — одно правило на сервер
  (services/subscription-payments) и на форму «Записать оплату» в консоли.

  Форма показывает период и сумму ДО нажатия, сервер считает их сам после:
  посчитанные в двух местах разными словами, они однажды разошлись бы —
  на экране «до 15.01», а подписка продлилась до 14.01. Поэтому правило здесь.
*/

export const PAYMENT_METHODS = ["cash", "transfer", "card", "payme", "click", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash:     "Наличные",
  transfer: "Перечисление",
  card:     "Карта",
  payme:    "Payme",
  click:    "Click",
  other:    "Другое",
};

/**
 * Тарифы, за которые платят. Пробный — бесплатный, оплаты за него не бывает.
 * «Стандарт» — цена за полевого сотрудника (contracts/pricing.ts); прежние —
 * только продление своего до GRANDFATHER_UNTIL (pricing.planSellable).
 */
export const PAID_PLANS = ["standard", "basic", "pro", "exclusive"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

const DAY = 86_400_000;
/** Узбекистан живёт в UTC+5 круглый год: день оплаты и месяц — по Ташкенту. */
const TASHKENT_MS = 5 * 3_600_000;

/**
 * С какого момента продлевать — то же правило, что у «Изменить тариф»
 * (tenant.updatePlan): от конца ОПЛАЧЕННОГО, если он ещё впереди, иначе от
 * сейчас. Пробные дни не оплачены и не переносятся.
 */
export function paidUntilBase(sub: { status: string | null | undefined; currentPeriodEnds: Date | string | null | undefined } | null | undefined, now: Date): Date {
  const ends = sub?.currentPeriodEnds ? new Date(sub.currentPeriodEnds) : null;
  return sub?.status === "active" && ends && ends > now ? ends : now;
}

/**
 * Плюс N календарных месяцев; 31 января + 1 месяц — 28 (29) февраля, а не
 * 3 марта, как у голого setUTCMonth. Часы и минуты — те же.
 */
export function addMonths(d: Date, months: number): Date {
  const local = new Date(d.getTime() + TASHKENT_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = Math.min(local.getUTCDate(), lastDay);
  const out = Date.UTC(y, m, day, local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds());
  return new Date(out - TASHKENT_MS);
}

/** «2026-10-15» — день по Ташкенту. */
export function tashkentDay(d: Date): string {
  return new Date(d.getTime() + TASHKENT_MS).toISOString().slice(0, 10);
}

/** Период новой оплаты: с конца оплаченного (или сегодня) на N месяцев. */
export function paymentPeriod(sub: Parameters<typeof paidUntilBase>[0], months: number, now: Date): { from: Date; to: Date; fromDay: string; toDay: string } {
  const from = paidUntilBase(sub, now);
  const to = addMonths(from, months);
  return { from, to, fromDay: tashkentDay(from), toDay: tashkentDay(to) };
}

/** Первый и последний день месяца по Ташкенту: «2026-10-01», «2026-10-31». */
export function tashkentMonth(now: Date): { first: string; last: string; days: number } {
  const local = new Date(now.getTime() + TASHKENT_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const first = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(y, m, days)).toISOString().slice(0, 10);
  return { first, last, days };
}

const dayNo = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) / DAY;

/**
 * Доля оплаты, что приходится на месяц: сумма раскладывается по дням своего
 * периода поровну, и берутся дни, попавшие в месяц.
 *
 * Почему по дням, а не «период задевает месяц — считать месячную цену»:
 * оплата 15.09–15.10 и следующая 15.10–15.11 обе задевают октябрь, и по
 * второму правилу октябрь насчитал бы два месяца денег за один. По дням —
 * половина первой и половина второй, то есть ровно месяц.
 *
 * Период — [from, to): день окончания — первый день следующей оплаты.
 */
export function monthShare(p: { amount: number; periodFrom: string; periodTo: string }, month: { first: string; last: string }): number {
  const a = dayNo(p.periodFrom);
  const b = dayNo(p.periodTo);
  const total = b - a;
  if (total <= 0) return 0;
  const overlap = Math.min(b, dayNo(month.last) + 1) - Math.max(a, dayNo(month.first));
  return overlap > 0 ? (p.amount * overlap) / total : 0;
}
