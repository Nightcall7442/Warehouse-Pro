import { addDays, addMonths, endOfMonth, format, startOfMonth, subMonths } from "date-fns";

/*
  Арифметика календаря периода (components/DateRangePicker).

  День — строка «ГГГГ-ММ-ДД», как её ждут все отчёты на сервере, а не Date:
  строки сравниваются как строки, и «13 сентября» не съезжает на двенадцатое
  от того, в каком поясе открыт браузер. Date появляется только внутри, чтобы
  прибавить день или месяц, и строится как местная полночь (parseDay): date-fns
  считает в местном времени, а new Date("ГГГГ-ММ-ДД") дал бы полночь UTC.

  Отдельным файлом от компонента — по требованию сборщика: файл, который
  экспортирует и компонент, и функции, теряет горячую замену.
*/

/** Местная дата в «ГГГГ-ММ-ДД». */
export function toDay(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** «ГГГГ-ММ-ДД» в местную полночь. */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function shiftDay(day: string, n: number): string {
  return toDay(addDays(parseDay(day), n));
}

export function shiftMonthOf(day: string, n: number): string {
  return toDay(addMonths(parseDay(day), n));
}

/** Первое число месяца, в котором лежит день. */
export function monthOf(day: string): string {
  return toDay(startOfMonth(parseDay(day)));
}

/** Последнее число месяца, в котором лежит день. */
export function monthEndOf(day: string): string {
  return toDay(endOfMonth(parseDay(day)));
}

/** День, прижатый к границам; пустая граница — без ограничения. */
export function clampDay(day: string, min?: string, max?: string): string {
  if (min && day < min) return min;
  if (max && day > max) return max;
  return day;
}

/** Концы по порядку: второй щелчок раньше первого — тоже период. */
export function orderRange(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

/**
 * Клетки месяца для сетки: сначала пустые до первого дня недели, затем дни.
 * Неделя начинается с понедельника — так у обоих словарей (ru, uz).
 */
export function monthCells(month: string, weekStartsOn: number = 1): (string | null)[] {
  const first = parseDay(monthOf(month));
  const lead = (first.getDay() - weekStartsOn + 7) % 7;
  const total = endOfMonth(first).getDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let i = 0; i < total; i++) cells.push(toDay(addDays(first, i)));
  return cells;
}

const human = (day: string) => day.split("-").reverse().join(".");

/** Подпись выбранного периода: «13.09.2026 — 13.10.2026», один день — одной датой. */
export function rangeText(from: string, to: string): string {
  if (from && to) return from === to ? human(from) : `${human(from)} — ${human(to)}`;
  if (from) return `${human(from)} —`;
  if (to) return `— ${human(to)}`;
  return "";
}

/**
 * Короткая подпись для узких панелей: «13.09 — 13.10», если оба конца в
 * текущем году; иначе полная — год в чужом году не угадать.
 */
export function rangeTextShort(from: string, to: string, today: string): string {
  const year = today.slice(0, 4);
  if (!from || !to || from.slice(0, 4) !== year || to.slice(0, 4) !== year) return rangeText(from, to);
  const dm = (day: string) => `${day.slice(8)}.${day.slice(5, 7)}`;
  return from === to ? dm(from) : `${dm(from)} — ${dm(to)}`;
}

export interface QuickRange {
  key: "today" | "month" | "prevMonth";
  from: string;
  to: string;
}

/**
 * Быстрые отрезки внутри календаря — календарные, а не «N дней»: «30 дней»
 * у экранов есть свои, а «этот месяц» и «прошлый месяц» человек иначе
 * набирает четырьмя щелчками с перелистыванием.
 */
export function quickRanges(today: string, max?: string): QuickRange[] {
  const prev = toDay(subMonths(parseDay(monthOf(today)), 1));
  const cap = (d: string) => clampDay(d, undefined, max);
  return [
    { key: "today", from: today, to: today },
    { key: "month", from: monthOf(today), to: cap(monthEndOf(today)) },
    { key: "prevMonth", from: prev, to: cap(monthEndOf(prev)) },
  ];
}

/**
 * Даты отрезка главной («7д», «30д», «Месяц») — те же, что считает
 * dashboard.trends на сервере. Календарь рядом с пилюлями открывается на
 * них: видно, что именно сейчас на графике, и свой период правится от него.
 */
export function homeRangeDates(range: "7d" | "30d" | "month", today: string): { from: string; to: string } {
  if (range === "month") return { from: monthOf(today), to: today };
  return { from: shiftDay(today, range === "7d" ? -7 : -30), to: today };
}
