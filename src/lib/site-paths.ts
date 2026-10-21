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

/** Язык страницы сайта по адресу: /uz и всё под ним — узбекский, остальное — русский. */
export function langOfPath(pathname: string): SiteLang {
  return stripUzPrefix(pathname) === pathname ? "ru" : "uz";
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

/**
 * Адрес экрана приложения (/register, /login) со страницы сайта: с
 * узбекской — с ?lang=uz, с русской — как есть.
 *
 * Регистрация и вход живут в приложении, а его язык — сохранённый выбор
 * (LangProvider). Посетитель /uz выбора не делал — заход по ссылке не
 * считается, — и «Bepul boshlang» открывал ему русскую форму. ?lang=uz
 * несёт язык страницы дальше (QueryLang в App.tsx). Русский — язык по
 * умолчанию, как и в адресах сайта: с русской страницы ссылка без ?lang, и
 * тот, кто когда-то выбрал узбекский, получает свой выбор.
 */
export function appPath(lang: SiteLang, path: string): string {
  if (lang === "ru") return path;
  const hashAt = path.indexOf("#");
  const hash = hashAt >= 0 ? path.slice(hashAt) : "";
  const noHash = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const qAt = noHash.indexOf("?");
  const q = new URLSearchParams(qAt >= 0 ? noHash.slice(qAt + 1) : "");
  q.set("lang", lang);
  return `${qAt >= 0 ? noHash.slice(0, qAt) : noHash}?${q.toString()}${hash}`;
}
