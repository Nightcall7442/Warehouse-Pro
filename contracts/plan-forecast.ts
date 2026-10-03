/**
 * Прогноз выполнения месячного плана — одно правило для сервера и экрана.
 *
 * ── Формула ─────────────────────────────────────────────────────────────────
 *
 *   темп     = факт ÷ прошедшие рабочие дни
 *   прогноз  = темп × все рабочие дни месяца
 *   % плана  = прогноз ÷ план, вниз до целого
 *   нужно/д  = (план − факт) ÷ оставшиеся рабочие дни, вверх до целого
 *
 * Рабочие дни — понедельник–суббота. Своего календаря (праздники,
 * пятидневка) в проекте нет: дни недели визитов выбираются при расстановке
 * каждый раз заново и нигде не хранятся как «график организации». Воскресенье
 * — выходной у дистрибуции по Узбекистану по умолчанию.
 *
 * Сегодняшний день считается прошедшим: факт уже содержит сегодняшние
 * продажи, и делить их на «вчерашнее» число дней значило бы завышать темп.
 * Вечером прогноз поэтому чуть точнее, чем утром, — это честно.
 *
 * Процент — ВНИЗ: «100%» на экране обязано значить «план будет выполнен», а
 * не «99,6%, округлённые до зелёного». Сумма «нужно в день» — ВВЕРХ по той же
 * причине: недобор в сум на последний день — это невыполненный план.
 *
 * ── Рано судить ────────────────────────────────────────────────────────────
 *
 * В первые EARLY_WORKDAYS рабочих дня месяца темп — это один-два заказа,
 * умноженные на двадцать шесть. Прогноз показывается, но без цвета и с
 * подписью «рано судить»: красный агенту второго числа за то, что крупный
 * магазин заказывает по средам, — неправда.
 */

export const FORECAST_RULES = {
  /** Столько первых рабочих дней прогноз не красится. */
  EARLY_WORKDAYS: 3,
  /** % плана по прогнозу не ниже — зелёный. */
  GREEN_PCT: 100,
  /** Не ниже — жёлтый; ниже — красный. */
  YELLOW_PCT: 90,
} as const;

/** Выходной день недели: 0 — воскресенье, как у Date.getDay(). */
export const WEEKEND_DAYS: readonly number[] = [0];

export type ForecastTone = "green" | "yellow" | "red" | "early" | "none";

export interface WorkDays {
  /** Рабочих дней в месяце. */
  total: number;
  /** Прошло, включая сегодняшний (если он рабочий). */
  passed: number;
  /** Осталось после сегодняшнего. */
  left: number;
}

/** «ГГГГ-ММ-ДД» → [год, месяц 1–12, число]. */
function parts(day: string): [number, number, number] {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return [y, m, d];
}

/** День недели календарной даты — без часового пояса: UTC-полдень этого числа. */
function weekday(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

/** Рабочие дни месяца, в котором лежит `today`, и сколько из них прошло. */
export function workDaysOf(today: string): WorkDays {
  const [y, m, d] = parts(today);
  const last = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
  let total = 0;
  let passed = 0;
  for (let day = 1; day <= last; day++) {
    if (WEEKEND_DAYS.includes(weekday(y, m, day))) continue;
    total++;
    if (day <= d) passed++;
  }
  return { total, passed, left: total - passed };
}

export interface ForecastLine {
  /** Выручка с начала месяца по сегодня, целыми. */
  fact: number;
  /** План на месяц, целыми; null — плана нет. */
  plan: number | null;
  /** Прогноз на конец месяца при нынешнем темпе, целыми. */
  forecast: number;
  /** Прогноз в % плана, вниз до целого; null — плана нет. */
  forecastPct: number | null;
  /** Сколько продавать каждый оставшийся рабочий день, чтобы выполнить; 0 — уже выполнен; null — плана нет. */
  needPerDay: number | null;
  tone: ForecastTone;
}

export function forecastLine(factRaw: number, planRaw: number | null, days: WorkDays): ForecastLine {
  const fact = Math.round(factRaw);
  const plan = planRaw != null && planRaw > 0 ? Math.round(planRaw) : null;
  const forecast = days.passed > 0 ? Math.round((fact * days.total) / days.passed) : fact;
  if (plan == null) return { fact, plan: null, forecast, forecastPct: null, needPerDay: null, tone: "none" };

  const forecastPct = Math.floor((forecast * 100) / plan);
  const rest = plan - fact;
  const needPerDay = rest <= 0 ? 0 : days.left > 0 ? Math.ceil(rest / days.left) : rest;
  const tone: ForecastTone = fact >= plan ? "green"
    : days.passed <= FORECAST_RULES.EARLY_WORKDAYS ? "early"
    : forecastPct >= FORECAST_RULES.GREEN_PCT ? "green"
    : forecastPct >= FORECAST_RULES.YELLOW_PCT ? "yellow" : "red";
  return { fact, plan, forecast, forecastPct, needPerDay, tone };
}

/** Цвет тона — токены темы, одинаковые в светлой и тёмной. */
export const FORECAST_TONE_COLOR: Record<ForecastTone, string> = {
  green: "var(--color-success-text)",
  yellow: "var(--color-warning-text)",
  red: "var(--color-danger-text)",
  early: "var(--color-text-tertiary)",
  none: "var(--color-text-tertiary)",
};

export function forecastToneLabel(tone: ForecastTone, lang: string): string {
  const uz = lang === "uz";
  switch (tone) {
    case "green": return uz ? "Bajariladi" : "Выполнит";
    case "yellow": return uz ? "Biroz yetmaydi" : "Чуть не дотягивает";
    case "red": return uz ? "Yetmaydi" : "Не дотягивает";
    case "early": return uz ? "Hukm qilishga erta" : "Рано судить";
    case "none": return uz ? "Reja yo'q" : "Нет плана";
  }
}

/**
 * «Нужно в день» словами. Пробелы неразрывные: на телефоне «в» оставалось в
 * строке, а «день» уезжал на следующую («7 711 711 сум в / день»).
 */
export function needPerDayText(line: Pick<ForecastLine, "needPerDay">, lang: string, fmt: (n: number) => string): string {
  if (line.needPerDay == null) return "—";
  if (line.needPerDay === 0) return lang === "uz" ? "bajarildi" : "выполнен";
  return lang === "uz" ? `${fmt(line.needPerDay)}\u00A0/\u00A0kun` : `${fmt(line.needPerDay)}\u00A0в\u00A0день`;
}
