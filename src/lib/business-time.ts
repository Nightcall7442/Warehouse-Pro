import { TZDate } from "@date-fns/tz";
import { format as dfFormat, type FormatOptions } from "date-fns";
import { BUSINESS_TZ, businessDay } from "@contracts/business-time";

/*
  Время на экране — по Ташкенту, а не по часам устройства.

  Арендатор 14.10.2026: «если зайдёт Мак, другое время покажет, и заказы
  сдвинутся назад или вперёд». Экран считал время в поясе компьютера: на Маке
  с поясом не Ташкента заказ в 10:00 показывался в 08:00 (Москва) или в
  00:00 (Нью-Йорк), а «сегодня», «этот месяц» и «30 дней» начинались не в ту
  полночь, и фильтр отдавал заказы чужого дня. Почему пояс один на всех —
  в contracts/business-time.

  Здесь одна дверь. Через неё:
    · format — тот же, что в date-fns, но любой момент печатает по Ташкенту;
      импортировать format прямо из date-fns экранам нельзя (стережёт
      src/__tests__/times-are-tashkent.test.ts);
    · bizTime / bizNow — момент и «сейчас» как TZDate: их getDate(), getHours()
      и любая функция date-fns над ними (startOfMonth, subDays) считают по
      Ташкенту;
    · bizToday / bizDay — день «ГГГГ-ММ-ДД», какой ждёт сервер;
      isBizToday / isBizYesterday — вместо isToday / isYesterday;
    · bizDateText / bizTimeText / bizDateTimeText — то же для toLocale*String;
    · fromBizInput / toBizInput — поле datetime-local: «18:00» в нём — 18:00
      по Ташкенту, а не по часам устройства.
*/

export { BUSINESS_TZ };

type Moment = Date | string | number;

/** Момент времени — в часах Ташкента. */
export function bizTime(at: Moment): TZDate {
  return new TZDate(at instanceof Date ? at.getTime() : new Date(at).getTime(), BUSINESS_TZ);
}

/** Сейчас — в часах Ташкента. */
export function bizNow(): TZDate {
  return new TZDate(Date.now(), BUSINESS_TZ);
}

/** Полночь календарного дня по Ташкенту; месяц — с нуля, как у Date. */
export function bizDate(year: number, monthIndex: number, day: number): TZDate {
  return TZDate.tz(BUSINESS_TZ, year, monthIndex, day);
}

/** «Сегодня» по Ташкенту: «2026-10-14». */
export function bizToday(): string {
  return businessDay(Date.now());
}

/** День момента по Ташкенту: заказ в 03:30 тринадцатого — «…-13» на любом устройстве. */
export function bizDay(at: Moment): string {
  return businessDay(at);
}

/**
 * Полночь дня по Ташкенту — обычным Date, чтобы отдать серверу: toISOString()
 * у TZDate печатает «+05:00», а z.string().datetime() такую строку не берёт.
 */
export function bizDayStart(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(bizDate(y, m - 1, d).getTime());
}

/** isToday из date-fns спрашивает часы устройства; этот — Ташкент. */
export function isBizToday(at: Moment): boolean {
  return businessDay(at) === bizToday();
}

/** Вчера по Ташкенту. Сутки там всегда 24 часа: часы не переводят. */
export function isBizYesterday(at: Moment): boolean {
  return businessDay(at) === businessDay(Date.now() - 86_400_000);
}

/** format из date-fns — по Ташкенту, что бы ему ни передали. */
export function format(date: Moment, pattern: string, options?: FormatOptions): string {
  return dfFormat(date instanceof TZDate ? date : bizTime(date), pattern, options);
}

const zoned = (opts?: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions => ({ ...opts, timeZone: BUSINESS_TZ });

/** toLocaleDateString по Ташкенту. */
export function bizDateText(at: Moment, locale = "ru-RU", opts?: Intl.DateTimeFormatOptions): string {
  return new Date(at).toLocaleDateString(locale, zoned(opts));
}

/** toLocaleTimeString по Ташкенту. */
export function bizTimeText(at: Moment, locale = "ru-RU", opts?: Intl.DateTimeFormatOptions): string {
  return new Date(at).toLocaleTimeString(locale, zoned(opts));
}

/** toLocaleString по Ташкенту. */
export function bizDateTimeText(at: Moment, locale = "ru-RU", opts?: Intl.DateTimeFormatOptions): string {
  return new Date(at).toLocaleString(locale, zoned(opts));
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Момент → значение поля datetime-local по Ташкенту («2026-10-14T18:00»).
 * Пусто или не дата — пустое поле: оно значит «срок не называли».
 */
export function toBizInput(at: Moment | null | undefined): string {
  if (at == null || Number.isNaN(new Date(at).getTime())) return "";
  const t = bizTime(at);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

/** Значение поля datetime-local, введённое по Ташкенту, → момент. Пустое или битое — null. */
export function fromBizInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  return new Date(TZDate.tz(BUSINESS_TZ, y, mo - 1, d, h, mi).getTime());
}
