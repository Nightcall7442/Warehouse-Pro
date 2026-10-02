/**
 * Прибыль по товару, магазину и агенту и ABC-анализ — правила, общие для
 * сервера и экрана.
 *
 * ── Откуда деньги ───────────────────────────────────────────────────────────
 *
 * Те же, что в P&L директора (services/period-gross.ts), иначе две страницы
 * одного человека спорили бы о прибыли:
 *
 *   • выручка — доставленные неудалённые заказы периода по сумме заказа, то
 *     есть ПОСЛЕ скидки, минус возвраты, проведённые в периоде (по дате
 *     проведения, services/revenue-returns.ts);
 *   • себестоимость — слепок в строке заказа (order_items.cost_price) на
 *     доставленное количество, минус себестоимость вернувшегося.
 *
 * Скидка заказа одна на весь заказ, а строки нужны по товарам. Она делится
 * между строками пропорционально их сумме: строка на 60% суммы заказа несёт
 * 60% скидки. Так сумма строк заказа равна сумме заказа до копейки, и итог
 * отчёта сходится с P&L, а не «почти сходится».
 *
 * Деньги наружу — целыми. Проценты считаются из этих целых, а не из дробных
 * сумм: иначе маржа строки и маржа, пересчитанная человеком по видимым
 * числам, расходились бы в десятых.
 */

export const MARGIN_RULES = {
  /**
   * Маржа ниже стольких процентов — «низкая».
   *
   * 5% у дистрибьютора — это уже работа в ноль: из валовой прибыли ещё
   * платятся зарплата, доставка и аренда склада (они в P&L ниже валовой).
   */
  LOW_MARGIN_PCT: 5,
  /**
   * «Продаёт много» — доля в выручке периода не меньше стольких процентов.
   *
   * Низкая маржа у мелочи — не повод звонить: тревогу поднимает объём.
   * Убыток (валовая прибыль меньше нуля) — тревога при любом объёме: это
   * деньги, которые отдали сверху за право продать.
   */
  NOTABLE_REVENUE_SHARE_PCT: 2,
  /** Причина «большая скидка»: скидка заказов — не меньше стольких % суммы строк. */
  BIG_DISCOUNT_PCT: 10,
  /** Причина «ступень/прайс-лист»: цена списка ниже карточки на столько % и больше. */
  PRICE_LIST_CUT_PCT: 5,
  /** Причина «возвраты»: вернулось не меньше стольких % проданного за период. */
  HIGH_RETURNS_PCT: 10,
} as const;

export type MarginDim = "product" | "shop" | "agent";
export const MARGIN_DIMS: readonly MarginDim[] = ["product", "shop", "agent"];

/** Тревога строки: «в минус» — убыток; «низкая» — много продаёт, маржа ниже порога. */
export type MarginFlag = "loss" | "low";

/**
 * Почему маржа такая — то, что выводится из самих данных.
 *
 * Суммы — целыми. Причин может быть несколько; ни одной — тоже ответ: значит,
 * дело в закупочной цене, а её из продаж не видно.
 */
export type MarginReason =
  /** Строки, проданные дешевле своей себестоимости: сколько на них потеряли. */
  | { code: "below_cost"; amount: number }
  /** Скидка заказов, пришедшаяся на эти строки, и её доля от суммы строк. */
  | { code: "discount"; amount: number; pct: number }
  /** Цена прайс-листа (в том числе ступени «от N штук») ниже карточки. */
  | { code: "price_list"; amount: number; pct: number }
  /** Возвраты, проведённые в периоде, и их доля от проданного. */
  | { code: "returns"; amount: number; pct: number }
  /** Продано без себестоимости в строке — маржа по ним завышена до 100%. */
  | { code: "no_cost"; amount: number };

export interface MarginRow {
  /** id товара, магазина или агента; null — возвраты без строк товаров. */
  key: number | null;
  name: string;
  /** Код товара или город магазина. */
  sub: string | null;
  revenue: number;
  cost: number;
  profit: number;
  /** Маржа, %, одна десятая; null — выручки нет или она ушла в минус возвратами. */
  marginPct: number | null;
  /** Доля в выручке периода, %, одна десятая. */
  revenueShare: number;
  /** Доля в валовой прибыли периода, %, одна десятая; null — прибыли в периоде нет. */
  profitShare: number | null;
  /** Продано единиц (только товары). */
  qty: number | null;
  orders: number;
  flag: MarginFlag | null;
  reasons: MarginReason[];
}

/** Доля в процентах с одной десятой — из целых. Знаменатель не положителен — null. */
export function pct1(part: number, whole: number): number | null {
  if (!(whole > 0)) return null;
  return Math.round((part * 1000) / whole) / 10;
}

/** Маржа строки, %: прибыль к выручке; выручки нет — null. */
export function marginPctOf(revenue: number, profit: number): number | null {
  return pct1(profit, revenue);
}

/**
 * Тревога по строке.
 *
 * Сравнения — умножением целых, а не делением: «ровно 5%» не должно
 * становиться «4,999…» из-за двоичной дроби.
 */
export function marginFlagOf(row: { revenue: number; profit: number }, totalRevenue: number): MarginFlag | null {
  if (row.profit < 0) return "loss";
  if (!(row.revenue > 0)) return null;
  const notable = row.revenue * 100 >= totalRevenue * MARGIN_RULES.NOTABLE_REVENUE_SHARE_PCT;
  if (notable && row.profit * 100 < row.revenue * MARGIN_RULES.LOW_MARGIN_PCT) return "low";
  return null;
}

type Money = (n: number) => string;

/** Причина словами: «Скидка заказов 1 200 000 сум — 12% суммы». */
export function marginReasonText(r: MarginReason, lang: string, money: Money): string {
  const uz = lang === "uz";
  switch (r.code) {
    case "below_cost":
      return uz
        ? `Tannarxdan arzon sotilgan: ${money(r.amount)} zarar`
        : `Продано ниже себестоимости: −${money(r.amount)}`;
    case "discount":
      return uz
        ? `Buyurtma chegirmasi ${money(r.amount)} — summaning ${r.pct}%`
        : `Скидка заказов ${money(r.amount)} — ${r.pct}% суммы`;
    case "price_list":
      return uz
        ? `Narxlar ro'yxati / pog'ona kartochkadan ${r.pct}% arzon (${money(r.amount)})`
        : `Прайс-лист или ступень ниже карточки на ${r.pct}% (${money(r.amount)})`;
    case "returns":
      return uz
        ? `Qaytarishlar ${money(r.amount)} — sotilganning ${r.pct}%`
        : `Возвраты ${money(r.amount)} — ${r.pct}% проданного`;
    case "no_cost":
      return uz
        ? `${money(r.amount)} tannarxsiz sotilgan — marja oshirib ko'rsatilgan`
        : `${money(r.amount)} продано без себестоимости — маржа завышена`;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ABC-анализ.

   Позиции — по убыванию денег (выручки или прибыли). Класс решает накопленная
   доля ДО позиции:

     • меньше 80% — A;
     • меньше 95% — B;
     • остальное — C.

   То есть позиция, на которой накопленная доля ДОСТИГАЕТ или ПЕРЕСКАКИВАЕТ
   80%, — ещё A, а следующая за ней — уже B. При 80/15/5 это даёт ровно A, B,
   C; самый крупный товар никогда не попадает в B только потому, что один
   даёт 85% денег.

   Ноль и минус (по прибыли — убыточные позиции) — всегда C, в накопление не
   входят: доля «−3% прибыли» не делает соседей крупнее.

   При равных суммах порядок — по названию, затем по id: один и тот же вход
   даёт один и тот же класс, иначе позиция на границе прыгала бы между A и B
   от обновления к обновлению.
   ═══════════════════════════════════════════════════════════════════════════ */

export const ABC_RULES = {
  /** Накопленная доля до позиции меньше этой — класс A. */
  A_SHARE_PCT: 80,
  /** Меньше этой — B; остальное — C. */
  B_SHARE_PCT: 95,
  /** A-магазин без заказа столько дней и дольше — подсказка «пора ехать». */
  A_SHOP_IDLE_DAYS: 14,
} as const;

export type AbcClass = "A" | "B" | "C";
export type AbcMetric = "revenue" | "profit";
export type AbcSubject = "product" | "shop";

export interface AbcInput {
  key: number | null;
  name: string;
  /** Деньги позиции, целыми. */
  value: number;
}

export interface AbcPlaced {
  abc: AbcClass;
  /** Доля позиции, %, одна десятая (от суммы положительных). */
  share: number;
  /** Накопленная доля С позицией, %, одна десятая. */
  cumShare: number;
}

export function abcClassify<T extends AbcInput>(rows: readonly T[]): Array<T & AbcPlaced> {
  const sorted = [...rows].sort((a, b) =>
    b.value - a.value
    || a.name.localeCompare(b.name, "ru")
    || (a.key ?? -1) - (b.key ?? -1));
  const total = sorted.reduce((s, r) => s + Math.max(0, r.value), 0);
  let cum = 0;
  return sorted.map(r => {
    if (!(r.value > 0) || total <= 0) {
      return { ...r, abc: "C" as const, share: pct1(Math.max(0, r.value), total) ?? 0, cumShare: pct1(cum, total) ?? 0 };
    }
    const before = cum;
    cum += r.value;
    const abc: AbcClass = before * 100 < total * ABC_RULES.A_SHARE_PCT ? "A"
      : before * 100 < total * ABC_RULES.B_SHARE_PCT ? "B" : "C";
    return { ...r, abc, share: pct1(r.value, total) ?? 0, cumShare: pct1(cum, total) ?? 0 };
  });
}

/** Итог по классу: сколько позиций и какую долю денег даёт. */
export function abcTotals(rows: ReadonlyArray<{ abc: AbcClass; value: number }>): Record<AbcClass, { count: number; value: number; share: number }> {
  const total = rows.reduce((s, r) => s + Math.max(0, r.value), 0);
  const out = { A: { count: 0, value: 0, share: 0 }, B: { count: 0, value: 0, share: 0 }, C: { count: 0, value: 0, share: 0 } };
  for (const r of rows) {
    out[r.abc].count += 1;
    out[r.abc].value += Math.max(0, r.value);
  }
  for (const k of ["A", "B", "C"] as const) out[k].share = pct1(out[k].value, total) ?? 0;
  return out;
}
