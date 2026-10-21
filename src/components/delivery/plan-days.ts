import { parseDay, shiftDay } from "@/lib/date-range";
import { format } from "@/lib/business-time";

/**
 * Дни переноса доставки — по календарю Ташкента.
 *
 * Сервер принимает день строкой «ГГГГ-ММ-ДД» и сам сверяет окно
 * (services/delivery-events.ts: assertPlanDay): курьер — с завтра, офис — и
 * на сегодня, оба — не дальше RESCHEDULE_MAX_DAYS. Здесь те же дни для
 * кнопок, чтобы экран не предлагал того, на что сервер ответит отказом.
 */

/** День через n дней от данного — общим счётом дней (lib/date-range). */
export function addDays(day: string, n: number): string {
  return shiftDay(day, n);
}

/** Дни окна [from, to] от сегодняшнего — по порядку. */
export function planDayChoices(today: string, from: number, to: number): string[] {
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(addDays(today, i));
  return out;
}

const WEEKDAY = {
  ru: ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"],
  uz: ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"],
};

/** «Сегодня», «Завтра», «Пт 23.10». */
export function planDayLabel(day: string, today: string, lang: string): string {
  const uz = lang === "uz";
  if (day === today) return uz ? "Bugun" : "Сегодня";
  if (day === addDays(today, 1)) return uz ? "Ertaga" : "Завтра";
  if (day === addDays(today, 2)) return uz ? "Indinga" : "Послезавтра";
  // День недели — по Ташкенту («i»: 1 — понедельник … 7 — воскресенье).
  const wd = Number(format(parseDay(day), "i")) % 7;
  return `${(uz ? WEEKDAY.uz : WEEKDAY.ru)[wd]} ${day.slice(8, 10)}.${day.slice(5, 7)}`;
}

/** «23.10» — для подписей и уведомлений. */
export function ddmm(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}`;
}
