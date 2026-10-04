/**
 * Любая ошибка — одной понятной фразой на языке интерфейса.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Экраны печатали `error.message` как есть. Сервер отказывал только
 * по-русски, и человек с узбекским интерфейсом читал «Недостаточно товара» и
 * «Внутренняя ошибка сервера…» под узбекскими кнопками. Обрыв связи
 * печатался словами браузера — «Failed to fetch».
 *
 * ── Правило ─────────────────────────────────────────────────────────────────
 *
 * 1. Сервер ответил и пометил текст языком интерфейса (`data.lang`, его
 *    ставит форматтер ошибок по заголовку x-lang) — показываем его слова: в
 *    них всё дело, «доступно 3, нужно ещё 7».
 * 2. Сервер ответил без пометки (текст ему незнаком или сервер старый) —
 *    русский текст в русском интерфейсе ещё можно показать, остальное
 *    называем по коду отказа: «нет доступа», «не найдено», «сессия
 *    закончилась».
 * 3. Сервер не ответил вовсе — это про связь.
 * 4. Своя ошибка страницы — только помеченная humanError: узбекский текст
 *    по виду не отличить от английской строки библиотеки.
 *
 * Где своего текста нет, берётся `fallback` экрана («Не удалось сформировать
 * отчёт»), а без него — «не получилось, попробуйте ещё раз».
 *
 * Печатать `error.message` в обход этой функции нельзя — это стережёт
 * src/__tests__/errors-speak-ui-language.test.ts.
 */
import { uiLang, uiText } from "./ui-text";

const NO_CONNECTION = () => uiText("Нет связи с сервером. Проверьте интернет и попробуйте снова.", "Server bilan aloqa yo'q. Internetni tekshirib, qayta urinib ko'ring.");
const TOO_LONG = () => uiText("Сервер не ответил вовремя. Попробуйте ещё раз.", "Server o'z vaqtida javob bermadi. Qayta urinib ko'ring.");
const SERVER_BUSY = () => uiText("Сервер сейчас недоступен. Попробуйте через минуту.", "Server hozir ishlamayapti. Bir daqiqadan so'ng urinib ko'ring.");
const UNKNOWN = () => uiText("Не получилось. Попробуйте ещё раз.", "Bo'lmadi. Qayta urinib ko'ring.");
const NO_ACCESS = () => uiText("Нет доступа: у вашей роли нет прав на это.", "Ruxsat yo'q: rolingizda bunga huquq yo'q.");
const SESSION_OVER = () => uiText("Сессия закончилась. Войдите снова.", "Sessiya tugadi. Qaytadan kiring.");
const NOT_FOUND = () => uiText("Не найдено — возможно, уже удалено.", "Topilmadi — ehtimol, o'chirilgan.");
const TOO_MANY = () => uiText("Слишком много попыток. Попробуйте позже.", "Urinishlar juda ko'p. Keyinroq urinib ko'ring.");

/** Код отказа tRPC → HTTP-статус. */
const STATUS_OF_CODE: Record<string, number> = {
  UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, TIMEOUT: 408, TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500, BAD_GATEWAY: 502, SERVICE_UNAVAILABLE: 503, GATEWAY_TIMEOUT: 504,
};

interface ErrorLike {
  message?: unknown;
  name?: string;
  forHumans?: boolean;
  data?: { lang?: string; code?: string; httpStatus?: number } | null;
  shape?: { data?: { lang?: string; code?: string; httpStatus?: number } } | null;
  meta?: { response?: { status?: number } };
}

const CYRILLIC = /[А-Яа-яЁё]/;

function looksLikeNoConnection(text: string): boolean {
  const low = text.toLowerCase();
  return low.includes("failed to fetch") || low.includes("networkerror") || low.includes("load failed")
    || low.includes("network request failed") || low.includes("net::err");
}

/** Своя ошибка с текстом для человека — на любом языке. */
export function humanError(message: string): Error {
  return Object.assign(new Error(message), { forHumans: true });
}

export function errorText(e: unknown, fallback?: string): string {
  if (e === null || e === undefined) return "";
  if (typeof e === "string") return e;
  const err = e as ErrorLike;
  const raw = typeof err.message === "string" ? err.message : "";
  const lang = uiLang();

  if (raw && err.forHumans) return raw;

  const data = err.data ?? err.shape?.data ?? undefined;
  const fromTrpc = err.name === "TRPCClientError" || data !== undefined;

  if (fromTrpc) {
    // 1. Сервер сказал на нашем языке.
    if (raw && data?.lang === lang) return raw;
    // 2. Старый сервер или незнакомый ему текст: русский — русскому интерфейсу.
    if (raw && data && lang === "ru" && CYRILLIC.test(raw)) return raw;
    const status = data?.httpStatus ?? err.meta?.response?.status ?? (data?.code ? STATUS_OF_CODE[data.code] : undefined);
    if (typeof status === "number") {
      if (status === 401) return SESSION_OVER();
      if (status === 403) return NO_ACCESS();
      if (status === 404) return NOT_FOUND();
      if (status === 408 || status === 504) return TOO_LONG();
      if (status === 429) return TOO_MANY();
      // С конвертом tRPC сервер ответил сам — «недоступен» было бы неправдой.
      if (status >= 500) return data ? fallback ?? UNKNOWN() : SERVER_BUSY();
      return fallback ?? UNKNOWN();
    }
  }

  // 3. Ответа не было: запрос не доехал.
  if (looksLikeNoConnection(raw)) return NO_CONNECTION();
  if (/timeout|timed out/i.test(raw)) return TOO_LONG();

  // Русский текст своей ошибки — русскому интерфейсу (например, из разбора файла).
  if (raw && lang === "ru" && CYRILLIC.test(raw) && !fromTrpc) return raw;

  return fallback ?? UNKNOWN();
}
