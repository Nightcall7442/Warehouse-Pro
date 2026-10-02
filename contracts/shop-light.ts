/**
 * Светофор магазина — можно ли грузить и как дела, одним цветом и словами.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Чтобы понять, стоит ли везти магазину товар, директор открывал три места:
 * долг в карточке, «Дебиторку» за возрастом и заказы — за ритмом. Агент у
 * прилавка не видел ни одного из них, кроме суммы долга, и узнавал о
 * просрочке, когда заказ уже вставал на проверку офиса.
 *
 * ── Правила (все пороги — здесь, одним местом) ──────────────────────────────
 *
 *  🔴 красный — есть просроченный долг (то же правило, что у «стоп отгрузки»:
 *     services/overdue-hold.ts → shop-debt.ts overdueDebt) или долг больше
 *     кредитного лимита;
 *  🟡 жёлтый — долг больше NEAR_LIMIT_SHARE лимита, или пауза в заказах
 *     длиннее PAUSE_FACTOR обычных интервалов магазина;
 *  🟢 зелёный — иначе.
 *
 * Причины цвета отдаются кодами с числами, а не готовой фразой: деньги на
 * экране печатаются валютой организации (useCurrency), а мобилке нужны те же
 * коды на своём языке. Фраза собирается здесь же — lightReasonText.
 */

export const SHOP_LIGHT_RULES = {
  /** Жёлтый, когда долг больше этой доли лимита (и не больше самого лимита — тогда красный). */
  NEAR_LIMIT_SHARE: 0.7,
  /** Жёлтый, когда со дня последнего заказа прошло больше стольких обычных интервалов. */
  PAUSE_FACTOR: 2,
  /**
   * Окно, по которому судят о ритме, дней. Отсчитывается от ПОСЛЕДНЕГО заказа,
   * а не от сегодня: магазин, который заказывал каждую неделю и пропал четыре
   * месяца назад, в окне «от сегодня» не имел бы ни одного заказа — ритм не
   * судился бы, и он горел бы зелёным ровно тогда, когда пора ехать.
   */
  RHYTHM_WINDOW_DAYS: 90,
  /** Меньше стольких дней с заказом в окне — о ритме не судим: два заказа ещё не привычка. */
  RHYTHM_MIN_ORDER_DAYS: 3,
  /** Средний чек — за столько последних дней, выручкой по правилам отчётов (за вычетом возвратов периода). */
  AVG_CHECK_DAYS: 90,
} as const;

export type ShopLightColor = "red" | "yellow" | "green";

export type ShopLightReason =
  | { code: "overdue"; amount: number; oldestDays: number }
  | { code: "over_limit"; debt: number; limit: number }
  | { code: "near_limit"; debt: number; limit: number; pct: number }
  | { code: "long_pause"; daysSince: number; usualDays: number };

export interface ShopLightFacts {
  /** Долг магазина по правилу «по заказу» (shops.debt, выведенный recalcShopDebt). */
  debt: number;
  /** Просроченная часть долга и возраст самого старого, дней. */
  overdue: { amount: number; oldestDays: number };
  /** Кредитный лимит; null — без лимита. Ноль — «в долг нельзя», как у заказа. */
  creditLimit: number | null;
  /** Дней с последнего заказа; null — заказов не было. */
  daysSinceOrder: number | null;
  /** Средний интервал между днями с заказом в окне; null — судить не по чему. */
  usualIntervalDays: number | null;
}

/** Цвет и причины по фактам. Чистая функция: сервер считает факты, решение одно. */
export function lightOf(f: ShopLightFacts): { color: ShopLightColor; reasons: ShopLightReason[] } {
  const red: ShopLightReason[] = [];
  const yellow: ShopLightReason[] = [];
  const debt = Math.round(f.debt);

  if (f.overdue.amount >= 1) red.push({ code: "overdue", amount: Math.round(f.overdue.amount), oldestDays: f.overdue.oldestDays });

  if (f.creditLimit != null) {
    const limit = Math.round(f.creditLimit);
    if (debt > limit) red.push({ code: "over_limit", debt, limit });
    else if (limit > 0 && debt > limit * SHOP_LIGHT_RULES.NEAR_LIMIT_SHARE) {
      yellow.push({ code: "near_limit", debt, limit, pct: Math.floor((debt / limit) * 100) });
    }
  }

  if (f.usualIntervalDays != null && f.daysSinceOrder != null
      && f.daysSinceOrder > f.usualIntervalDays * SHOP_LIGHT_RULES.PAUSE_FACTOR) {
    yellow.push({ code: "long_pause", daysSince: f.daysSinceOrder, usualDays: Math.max(1, Math.round(f.usualIntervalDays)) });
  }

  if (red.length) return { color: "red", reasons: [...red, ...yellow] };
  if (yellow.length) return { color: "yellow", reasons: yellow };
  return { color: "green", reasons: [] };
}

/** Всё, что ручка отдаёт про один магазин. Мобилке — тот же вид. */
export interface ShopLight {
  shopId: number;
  color: ShopLightColor;
  reasons: ShopLightReason[];
  debt: number;
  overdue: number;
  oldestOverdueDays: number;
  /** Отсрочка, по которой считали просрочку: своя у магазина или организации. */
  graceDays: number;
  /** Включена ли у организации «стоп отгрузки»: тогда новый заказ встанет на проверку офиса. */
  holdsOrders: boolean;
  creditLimit: number | null;
  /** Средний чек за AVG_CHECK_DAYS, целыми; null — доставленных заказов не было. */
  avgCheck: number | null;
  /** Сколько доставленных заказов вошло в средний чек. */
  avgCheckOrders: number;
  daysSinceOrder: number | null;
  /** Обычный интервал, дней (округлён); null — заказов в окне меньше RHYTHM_MIN_ORDER_DAYS. */
  usualIntervalDays: number | null;
  /** Последний визит без заказа с причиной; null — таких не было. */
  lastNoOrder: { reason: string; note: string | null; date: string } | null;
}

type Money = (n: number) => string;

/** Причина цвета словами: «Просрочено 800 000 сум, самый старый — 40 дн.» */
export function lightReasonText(r: ShopLightReason, lang: string, money: Money): string {
  const uz = lang === "uz";
  switch (r.code) {
    case "overdue":
      return uz
        ? `Muddati o'tgan: ${money(r.amount)}, eng eskisi — ${r.oldestDays} kun`
        : `Просрочено ${money(r.amount)}, самый старый — ${r.oldestDays} дн.`;
    case "over_limit":
      return uz
        ? `Qarz ${money(r.debt)} limitdan (${money(r.limit)}) oshgan`
        : `Долг ${money(r.debt)} больше лимита ${money(r.limit)}`;
    case "near_limit":
      return uz
        ? `Qarz ${money(r.debt)} — limitning ${r.pct}% (${money(r.limit)})`
        : `Долг ${money(r.debt)} — ${r.pct}% лимита ${money(r.limit)}`;
    case "long_pause":
      return uz
        ? `${r.daysSince} kundan beri buyurtma yo'q, odatda — har ${r.usualDays} kunda`
        : `Не заказывает ${r.daysSince} дн., обычно — раз в ${r.usualDays} дн.`;
  }
}

/** Короткая подпись цвета — для значка и чтения с экрана. */
export function lightColorLabel(color: ShopLightColor, lang: string): string {
  const uz = lang === "uz";
  if (color === "red") return uz ? "Yuklash xavfli" : "Грузить рискованно";
  if (color === "yellow") return uz ? "E'tibor bering" : "Обратите внимание";
  return uz ? "Hammasi joyida" : "Всё в порядке";
}
