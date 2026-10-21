/**
 * Адреса страниц сайта на двух языках.
 *
 * Русская страница живёт без приставки (/, /compare), узбекская — под /uz
 * (/uz, /uz/compare). Схема одна на весь сайт: шапка, подвал, переключатель
 * языка и маршруты App.tsx берут адрес отсюда, а не собирают его на месте —
 * иначе одна из ссылок однажды повела бы с /uz на русскую страницу.
 *
 * /ru/… отдельно не заводится: русский — язык по умолчанию, и у каждой
 * страницы ровно один русский адрес.
 */
export type SiteLang = "ru" | "uz";

export const UZ_PREFIX = "/uz";

/**
 * Адрес страницы сайта на нужном языке: ("uz", "/compare#otish") →
 * "/uz/compare#otish". Якорь на этой же странице («#faq») и внешние адреса
 * возвращаются как есть.
 */
export function sitePath(lang: SiteLang, path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  const plain = stripUzPrefix(path);
  if (lang === "ru") return plain;
  const cut = plain.search(/[?#]/);
  const pathname = cut < 0 ? plain : plain.slice(0, cut);
  const tail = cut < 0 ? "" : plain.slice(cut);
  return (pathname === "/" ? UZ_PREFIX : UZ_PREFIX + pathname) + tail;
}

/** "/uz/compare" → "/compare", "/uz" → "/"; без приставки — как есть. */
export function stripUzPrefix(path: string): string {
  if (path === UZ_PREFIX) return "/";
  if (path.startsWith(UZ_PREFIX + "/") || path.startsWith(UZ_PREFIX + "?") || path.startsWith(UZ_PREFIX + "#")) {
    const rest = path.slice(UZ_PREFIX.length);
    return rest.startsWith("/") ? rest : "/" + rest;
  }
  return path;
}
