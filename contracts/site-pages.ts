/* ═══════════════════════════════════════════════════════════════════════════
   Страницы сайта: какие адреса есть, на каких языках и что за ними.

   ── Зачем общий список ─────────────────────────────────────────────────────

   Одни и те же адреса знают четыре места: сборка, которая заранее рисует
   страницы в HTML (src/site/entry-server, scripts/prerender.mjs), сервер,
   который их отдаёт и отвечает 301 на старые адреса (api/lib/site-pages),
   вход браузера, решающий, грузить гостю сайт или приложение (src/main.tsx),
   и карта сайта для поиска (public/sitemap.xml, сверяется тестом). Когда
   адрес записан в четырёх местах руками, однажды одно из них отстаёт — и
   страница, которой нет в карте, или карта, ведущая на 404, всплывает
   только в Search Console.

   ── Схема адресов ──────────────────────────────────────────────────────────

   Русская страница — без приставки (/, /compare), узбекская — под /uz
   (/uz, /uz/compare); та же схема, что в src/lib/site-paths. Без косой черты
   в конце: /uz/ и /compare/ отвечают 301 на /uz и /compare, у страницы ровно
   один адрес. /ru/… не заводится: русский — язык по умолчанию.

   Модуль чистый — ни React, ни Node: его читают и сервер, и браузер.
   ═══════════════════════════════════════════════════════════════════════════ */

export const SITE_ORIGIN = "https://www.warehouse-pro.uz";

export type SiteLang = "ru" | "uz";
export const SITE_LANGS: readonly SiteLang[] = ["ru", "uz"];

export type SitePageKey = "home" | "compare" | "privacy";

export interface SitePage {
  key: SitePageKey;
  /** Адрес на каждом языке. Нет языка — нет и страницы на нём (политика только русская). */
  paths: { ru: string; uz?: string };
  /** Дата последней правки содержания — она же <lastmod> в карте сайта. */
  lastmod: string;
  changefreq: "weekly" | "monthly" | "yearly";
  priority: string;
}

export const SITE_PAGES: readonly SitePage[] = [
  { key: "home", paths: { ru: "/", uz: "/uz" }, lastmod: "2026-10-21", changefreq: "weekly", priority: "1.0" },
  { key: "compare", paths: { ru: "/compare", uz: "/uz/compare" }, lastmod: "2026-10-21", changefreq: "monthly", priority: "0.8" },
  // Политика — документ, а не экран: только по-русски (см. src/pages/Privacy.tsx).
  { key: "privacy", paths: { ru: "/privacy" }, lastmod: "2026-09-29", changefreq: "yearly", priority: "0.3" },
];

/** Языки, на которых страница есть. */
export function pageLangs(page: SitePage): SiteLang[] {
  return SITE_LANGS.filter(l => page.paths[l] !== undefined);
}

/** Точный адрес → страница и язык; всё остальное (в том числе /uz/) — null. */
export function siteRoute(path: string): { page: SitePage; lang: SiteLang } | null {
  for (const page of SITE_PAGES) {
    for (const lang of pageLangs(page)) if (page.paths[lang] === path) return { page, lang };
  }
  return null;
}

/** Полный адрес страницы на языке — для canonical, hreflang и карты сайта. */
export function absoluteUrl(path: string): string {
  return SITE_ORIGIN + path;
}

/**
 * Альтернативы страницы для hreflang: каждый её язык и x-default — русская
 * версия (язык сайта по умолчанию). У страницы на одном языке их нет.
 */
export function alternatesOf(page: SitePage): Array<{ hreflang: string; href: string }> {
  const langs = pageLangs(page);
  if (langs.length < 2) return [];
  return [
    ...langs.map(l => ({ hreflang: l, href: absoluteUrl(page.paths[l]!) })),
    { hreflang: "x-default", href: absoluteUrl(page.paths.ru) },
  ];
}

/** Картинка карточки ссылки (1200×630) — своя у каждой страницы и языка. */
export function ogImagePath(key: SitePageKey, lang: SiteLang): string {
  return `/og/${key}-${lang}.jpg`;
}
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** Файл готовой страницы в dist/prerender: "/" → index.html, "/uz/compare" → uz/compare.html. */
export function prerenderFile(path: string): string {
  return path === "/" ? "index.html" : `${path.slice(1)}.html`;
}
/** Страница «не найдено» — тот же каталог. */
export const NOT_FOUND_FILE = "404.html";

/**
 * Первые части адресов, которые разбирает сайт, а не приложение: всё под
 * ними, кроме страниц из SITE_PAGES, — честный 404 (/uz/xyz, /compare/xyz).
 * /landing — прежний адрес лендинга: сам он отвечает 301 на «/», а под ним
 * лежат кадры и снимки лендинга.
 */
export const SITE_ROOTS: readonly string[] = ["compare", "privacy", "uz", "landing"];

/**
 * Первые части адресов приложения (маршруты src/App.tsx). На них сервер
 * отдаёт оболочку, и адрес разбирает уже React Router — со своим «не
 * найдено» внутри приложения. Любой другой адрес, который просит страницу, —
 * 404 с настоящим кодом: раньше на него приходила оболочка с кодом 200, и
 * поиск считал опечатки страницами сайта.
 *
 * Список сверяется с маршрутами App.tsx тестом (site-pages-plumbing): новый
 * раздел приложения, забытый здесь, открывался бы как 404.
 */
export const APP_ROOTS: readonly string[] = [
  "agent", "analytics", "arrivals", "audit-log", "barcode", "billing", "catalog", "control", "courier",
  "dashboard", "deliveries", "demo", "forgot-password", "invite", "login", "monitoring", "notifications",
  "offline-orders", "onboarding", "orders", "pitch", "pnl", "price-lists", "products", "reconciliation",
  "register", "reports", "reset-password", "returns", "salaries", "settings", "shops", "subscription-blocked",
  "super-admin", "supervisor", "support", "users", "verify-email", "warehouse", "warehouse-reports",
];
