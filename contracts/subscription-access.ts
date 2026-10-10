/* ═══════════════════════════════════════════════════════════════════════════
   Доступ по подписке: когда кончается и что бывает после.

   ── Правило владельца (10.10.2026, для всех организаций) ────────────────────

   Срок подписки — пробной или оплаченной — кончился: организация сразу видит
   предупреждение «срок вашей подписки истёк» и время, когда закроется доступ.
   Если за 24 часа не продлили, сервер закрывает всё, кроме входа и оплаты.

   ── Что было ────────────────────────────────────────────────────────────────

   Правил было два, и они расходились. Калитка сервера давала «не оплачена»
   (past_due) семь дней льготы, а при пустой дате конца пускала бессрочно.
   Консоль считала срок по другим полям: если в подписке не было даты конца
   пробного, брала её из карточки организации и писала «Пробный истёк». Так
   организация работала после конца срока, а владелец видел «истекла».

   ── Как теперь ──────────────────────────────────────────────────────────────

   Конец срока считает одна функция (subscriptionEndsAt) — для калитки,
   полосы на сайте, объявления в мобилке и консоли. 24 часа отсчитываются от
   ПРЕДУПРЕЖДЕНИЯ (expiryNoticeAt), а не от даты конца: организация, которая
   не заходила все выходные, не будет заперта в понедельник, не увидев ни
   одного предупреждения. Предупреждение записывает калитка при первом
   запросе после конца срока.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Сколько длится предупреждение до закрытия доступа. Решение владельца — не менять без него. */
export const EXPIRED_GRACE_HOURS = 24;
const GRACE_MS = EXPIRED_GRACE_HOURS * 3_600_000;

/**
 * Номер «объявления» о конце подписки в ленте объявлений. Настоящих объявлений
 * столько не бывает; по нему мобилка показывает предупреждение, а веб —
 * отсеивает (у веба своя полоса на каждой странице).
 */
export const EXPIRY_ANNOUNCEMENT_ID = 1_900_000_001;

type DateLike = Date | string | null | undefined;

export interface SubscriptionLike {
  status: string;
  trialEndsAt?: DateLike;
  currentPeriodEnds?: DateLike;
  expiryNoticeAt?: DateLike;
}

/** Даты из карточки организации — запасные, если в подписке их нет. */
export interface TenantDatesLike {
  trialEndsAt?: DateLike;
  planExpiresAt?: DateLike;
}

const asDate = (d: DateLike): Date | null => {
  if (d == null) return null;
  const v = d instanceof Date ? d : new Date(d);
  return Number.isNaN(v.getTime()) ? null : v;
};

/** Статусы, при которых подписка не действует независимо от даты. */
const ENDED_STATUSES = new Set(["past_due", "canceled", "incomplete"]);

/**
 * До какого момента действует подписка. null — бессрочно.
 *
 * Пробная — по дате конца пробного; если в подписке её нет, то по карточке
 * организации, затем по концу периода. Оплаченная — по концу оплаченного
 * периода, затем по карточке. Порядок запасных полей — тот же, по которому
 * консоль всегда показывала срок: теперь по нему же решает и сервер.
 */
export function subscriptionEndsAt(sub: SubscriptionLike, tenant?: TenantDatesLike | null): Date | null {
  if (sub.status === "trialing") {
    return asDate(sub.trialEndsAt) ?? asDate(tenant?.trialEndsAt) ?? asDate(sub.currentPeriodEnds);
  }
  return asDate(sub.currentPeriodEnds) ?? asDate(tenant?.planExpiresAt);
}

export type SubscriptionAccess =
  /** Подписка действует. clearNotice — осталось предупреждение от прошлого срока, его пора стереть. */
  | { state: "ok"; endsAt: Date | null; clearNotice: boolean }
  /** Срок кончился, идут 24 часа предупреждения. writeNotice — предупреждение надо записать сейчас. */
  | { state: "grace"; endsAt: Date | null; noticeAt: Date; closesAt: Date; writeNotice: boolean }
  /** Доступ закрыт. */
  | { state: "closed"; endsAt: Date | null; noticeAt: Date | null; closesAt: Date | null; writeNotice: false };

/**
 * Что сейчас с доступом организации.
 *
 * Чистая функция: ничего не пишет, только говорит, что записать
 * (writeNotice / clearNotice). Пишет калитка (api/lib/feature-gating.ts).
 */
export function subscriptionAccess(
  sub: SubscriptionLike | null | undefined,
  tenant: TenantDatesLike | null | undefined,
  now: Date,
): SubscriptionAccess {
  // Нет строки подписки — как и прежде, закрыто: продлевать нечего,
  // заводит её оплата (services/subscription-payments.ts).
  if (!sub) return { state: "closed", endsAt: null, noticeAt: null, closesAt: null, writeNotice: false };

  const endsAt = subscriptionEndsAt(sub, tenant);
  const notice = asDate(sub.expiryNoticeAt);
  const endedByDate = endsAt !== null && endsAt.getTime() <= now.getTime();
  const ended = ENDED_STATUSES.has(sub.status) || endedByDate;

  if (!ended) return { state: "ok", endsAt, clearNotice: notice !== null };

  /*
    Предупреждение относится к ЭТОМУ концу срока, только если записано не
    раньше него. Иначе оно осталось от прошлого раза (продлили — и снова
    кончилось): тогда отсчёт начинается заново, с сегодняшнего запроса.
  */
  const noticeIsCurrent = notice !== null && (!endedByDate || notice.getTime() >= endsAt!.getTime());
  const noticeAt = noticeIsCurrent ? notice! : now;
  const closesAt = new Date(noticeAt.getTime() + GRACE_MS);

  if (now.getTime() < closesAt.getTime()) {
    return { state: "grace", endsAt, noticeAt, closesAt, writeNotice: !noticeIsCurrent };
  }
  return { state: "closed", endsAt, noticeAt, closesAt, writeNotice: false };
}

/** Пускать ли организацию: действующая подписка или идущие 24 часа предупреждения. */
export const accessAllowed = (a: SubscriptionAccess): boolean => a.state !== "closed";

/** «11.10, 14:00» — по Ташкенту: организации в Узбекистане, а сервер живёт в UTC. */
export function formatCloseTime(d: Date): string {
  return d.toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent",
  });
}

/**
 * Текст предупреждения — один для полосы на сайте и для объявления в мобилке.
 *
 * Продлить может только руководитель (заявку подаёт он), поэтому остальным
 * сказано, к кому идти, а не «продлите».
 */
export function expiryWarning(closesAt: Date, canRenew: boolean): { title: string; body: string; titleUz: string; bodyUz: string } {
  const when = formatCloseTime(closesAt);
  return canRenew
    ? {
      title: "Срок вашей подписки истёк",
      body: `Продлите подписку до ${when} — после этого доступ к Warehouse Pro будет закрыт.`,
      titleUz: "Obunangiz muddati tugadi",
      bodyUz: `Obunani ${when} gacha uzaytiring — shundan keyin Warehouse Pro'ga kirish yopiladi.`,
    }
    : {
      title: "Срок подписки организации истёк",
      body: `Сообщите руководителю: если не продлить подписку до ${when}, доступ к Warehouse Pro будет закрыт.`,
      titleUz: "Tashkilot obunasi muddati tugadi",
      bodyUz: `Rahbaringizga xabar bering: obuna ${when} gacha uzaytirilmasa, Warehouse Pro'ga kirish yopiladi.`,
    };
}
