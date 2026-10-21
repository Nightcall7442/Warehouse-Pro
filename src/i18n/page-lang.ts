/**
 * Язык, который задал адрес страницы: /uz, /uz/compare, /demo?lang=ru.
 *
 * ── Зачем отдельный модуль ──────────────────────────────────────────────────
 *
 * Адрес сильнее сохранённого выбора: человек открыл ссылку /uz — он ждёт
 * узбекский, даже если когда-то переключал приложение на русский. Но заход
 * по ссылке — не выбор: сохранённое «lang» при этом не трогается, иначе одна
 * ссылка из Telegram переключила бы человеку всё приложение.
 *
 * Контекст React этот язык знает (UrlLang в ./index), а помощники вне
 * дерева — нет: заголовок x-lang у каждого запроса и errorText читают язык
 * через uiLang() (lib/ui-text). Без общего места форма заявки на /uz слала
 * бы x-lang: ru и показывала ошибку по-русски. Модуль крошечный и без
 * зависимостей, чтобы его могли читать и словари, и ui-text, не втягивая
 * друг друга.
 *
 * ── Почему владелец, а не просто значение ───────────────────────────────────
 *
 * При переходе /uz → /uz/compare одна страница с языком адреса сменяет
 * другую. Уборка «просто обнулить», пришедшая после установки новой, стёрла
 * бы её язык — и порядок уборки и установки тут не должен ничего решать.
 * Поэтому снимает только тот, кто ставил.
 */
export type PageLang = "ru" | "uz";

let pageLang: PageLang | null = null;
let owner: object | null = null;

/** Язык из адреса — или null, если страница его не задаёт. */
export function pageLangOverride(): PageLang | null {
  return pageLang;
}

/** Поставить язык адреса от имени владельца (страницы). */
export function claimPageLang(by: object, lang: PageLang): void {
  owner = by;
  pageLang = lang;
}

/** Снять язык адреса — только если его ставил этот владелец. */
export function releasePageLang(by: object): void {
  if (owner !== by) return;
  owner = null;
  pageLang = null;
}

/** ?lang=ru|uz из строки запроса; всё остальное — null. */
export function langFromSearch(search: string): PageLang | null {
  try {
    const v = new URLSearchParams(search).get("lang");
    return v === "ru" || v === "uz" ? v : null;
  } catch {
    return null;
  }
}
