/*
  Ряд «Доходы и расходы» под длину периода.

  График стоял только помесячный, а период по умолчанию — 30 дней. С 13
  сентября по 13 октября он рисовал ДВА столбца: полмесяца сентября и
  полмесяца октября, причём октябрьский — за неполные две недели. Директор
  видел «обвал» там, где просто кончился месяц, а пара столбцов на всю
  ширину карточки выглядела палками, а не динамикой.

  Теперь шаг выбирается по длине периода: до месяца — по дням, до квартала —
  по неделям, дальше — по месяцам. Дни без продаж стоят нулями: пропущенный
  день на оси выглядел бы так, будто его в периоде нет.

  Помесячный `trend` в ответе остаётся как был — его выгружает отчёт «P&L по
  месяцам», и менять смысл его строк вслед за экраном нельзя.
*/
import { MS_PER_DAY } from "../lib/constants";

export type SeriesGranularity = "day" | "week" | "month";

/** Суммы одного дня — уже за вычетом проведённых в этот день возвратов. */
export interface SeriesInputRow {
  /** «ГГГГ-ММ-ДД» для дня. */
  key: string;
  revenue: number;
  cogs: number;
  operatingExpenses: number;
  orderCount: number;
}

export interface SeriesPoint {
  /** Первый день отрезка, «ГГГГ-ММ-ДД». */
  start: string;
  /** Последний день отрезка — для недели, прижатой к краю периода. */
  end: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  netProfit: number;
  orderCount: number;
}

/** Длина периода в днях, оба конца включительно. */
function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY) + 1;
}

/**
 * «30 дней» от сегодняшнего числа — это 31 день с обоими концами, поэтому
 * граница дней — 31, а не 30. «90 дней» — 91 день, тринадцать недель.
 */
export function seriesGranularity(from: string, to: string): SeriesGranularity {
  const days = spanDays(from, to);
  if (days <= 31) return "day";
  if (days <= 92) return "week";
  return "month";
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** Понедельник недели, в которой лежит день. Счёт в UTC — день здесь строка, а не момент. */
function mondayOf(day: string): string {
  const ms = dayMs(day);
  const weekday = (new Date(ms).getUTCDay() + 6) % 7; // 0 — понедельник
  return iso(ms - weekday * MS_PER_DAY);
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Границы месяца «ГГГГ-ММ» внутри периода: месяц, в котором период начался с
 * середины, подписан с того числа, с которого он в периоде.
 */
export function monthBounds(month: string, from: string, to: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const last = iso(Date.UTC(y, m, 0));
  return { start: first < from ? from : first, end: last > to ? to : last };
}

/**
 * Разложить дневные суммы по дням или неделям периода, с нулями там, где
 * продаж не было. Неделя на краю периода обрезается его границей: «14–20
 * сентября», а не «8–14», если период начался в четверг.
 */
export function bucketSeries(
  rows: SeriesInputRow[], from: string, to: string, granularity: "day" | "week",
): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  const index = new Map<string, SeriesPoint>();
  const keyOf = (day: string) => (granularity === "day" ? day : mondayOf(day));

  for (let ms = dayMs(from); ms <= dayMs(to); ms += MS_PER_DAY) {
    const day = iso(ms);
    const key = keyOf(day);
    const point = index.get(key);
    if (point) { point.end = day; continue; }
    const fresh: SeriesPoint = {
      start: day, end: day,
      revenue: 0, cogs: 0, grossProfit: 0, operatingExpenses: 0, netProfit: 0, orderCount: 0,
    };
    index.set(key, fresh);
    points.push(fresh);
  }

  for (const r of rows) {
    if (r.key < from || r.key > to) continue;
    const p = index.get(keyOf(r.key));
    if (!p) continue;
    p.revenue += r.revenue;
    p.cogs += r.cogs;
    p.operatingExpenses += r.operatingExpenses;
    p.orderCount += r.orderCount;
  }

  for (const p of points) {
    // Суммы десятичные: без округления 0.1 + 0.2 доезжало бы до экрана хвостом.
    p.revenue = round2(p.revenue);
    p.cogs = round2(p.cogs);
    p.operatingExpenses = round2(p.operatingExpenses);
    p.grossProfit = round2(p.revenue - p.cogs);
    p.netProfit = round2(p.grossProfit - p.operatingExpenses);
  }
  return points;
}
