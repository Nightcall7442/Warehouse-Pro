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

   Статьи — так же: /shop-debts и /uz/shop-debts. Адрес — короткое слово
   латиницей, одно на оба языка: пара страниц узнаётся по нему и в hreflang,
   и в переключателе языка.

   Модуль чистый — ни React, ни Node: его читают и сервер, и браузер.
   ═══════════════════════════════════════════════════════════════════════════ */

export const SITE_ORIGIN = "https://www.warehouse-pro.uz";

export type SiteLang = "ru" | "uz";
export const SITE_LANGS: readonly SiteLang[] = ["ru", "uz"];

/**
 * Статьи сайта: задача читателя его словами — и как она решается в программе.
 * Ключ — для файлов (картинка карточки og/<ключ>-<язык>.jpg, кусок сборки),
 * адрес — в ARTICLE_SLUGS.
 */
export type ArticleKey = "agents" | "debts" | "reconciliation" | "delivery" | "warehouse";
export const ARTICLE_KEYS: readonly ArticleKey[] = ["agents", "debts", "reconciliation", "delivery", "warehouse"];

/**
 * Адреса статей. Ни один не совпадает с разделом приложения (APP_ROOTS):
 * «/reconciliation» — экран «Акт сверки» внутри программы, поэтому статья о
 * нём — /reconciliation-act. Проверка site-pages-plumbing это стережёт.
 */
export const ARTICLE_SLUGS: Record<ArticleKey, string> = {
  agents: "sales-agents",
  debts: "shop-debts",
  reconciliation: "reconciliation-act",
  delivery: "delivery-cash",
  warehouse: "distributor-warehouse",
};

export type SitePageKey = "home" | "compare" | "privacy" | ArticleKey;

export interface SitePage {
  key: SitePageKey;
  /** Статья (своя разметка Article, раскладка ArticleLayout) или страница сайта. */
  kind: "page" | "article";
  /** Адрес на каждом языке. Нет языка — нет и страницы на нём (политика только русская). */
  paths: { ru: string; uz?: string };
  /** Дата последней правки содержания — она же <lastmod> в карте сайта. */
  lastmod: string;
  changefreq: "weekly" | "monthly" | "yearly";
  priority: string;
}

const article = <K extends ArticleKey>(key: K, lastmod: string): SitePage & { key: K } => ({
  key, kind: "article",
  paths: { ru: `/${ARTICLE_SLUGS[key]}`, uz: `/uz/${ARTICLE_SLUGS[key]}` },
  lastmod, changefreq: "monthly", priority: "0.7",
});

/*
  Страницы — записью по ключу, а не списком с поиском: ключ без страницы
  (новый в SitePageKey, а адреса нет) ловит проверка типов, а не падение
  сборки, и sitePage() ни в каком случае не остаётся без ответа. Порядок
  ключей — порядок карты сайта и сборки.
*/
const PAGE_BY_KEY: { [K in SitePageKey]: SitePage & { key: K } } = {
  home: { key: "home", kind: "page", paths: { ru: "/", uz: "/uz" }, lastmod: "2026-10-21", changefreq: "weekly", priority: "1.0" },
  compare: { key: "compare", kind: "page", paths: { ru: "/compare", uz: "/uz/compare" }, lastmod: "2026-10-21", changefreq: "monthly", priority: "0.8" },
  // Политика — документ, а не экран: только по-русски (см. src/pages/Privacy.tsx).
  privacy: { key: "privacy", kind: "page", paths: { ru: "/privacy" }, lastmod: "2026-09-29", changefreq: "yearly", priority: "0.3" },
  // Статьи — в порядке пути денег и товара: агент → долг → сверка → доставка → склад.
  agents: article("agents", "2026-10-21"),
  debts: article("debts", "2026-10-21"),
  reconciliation: article("reconciliation", "2026-10-21"),
  delivery: article("delivery", "2026-10-21"),
  warehouse: article("warehouse", "2026-10-21"),
};

export const SITE_PAGES: readonly SitePage[] = Object.values(PAGE_BY_KEY);

/** Страница сайта по ключу. */
export function sitePage(key: SitePageKey): SitePage {
  return PAGE_BY_KEY[key];
}

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
 * лежат кадры и снимки лендинга. Адрес статьи — тоже своя первая часть:
 * /shop-debts/xyz — 404, а не оболочка приложения.
 */
export const SITE_ROOTS: readonly string[] = ["compare", "privacy", "uz", "landing", ...ARTICLE_KEYS.map(k => ARTICLE_SLUGS[k])];

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
