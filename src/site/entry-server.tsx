import { StrictMode, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
// Страницы — обычным импортом, не лениво: renderToString не ждёт ленивых
// кусков и нарисовал бы вместо страницы пустой Suspense.
import Landing from "@/pages/Landing";
import Compare from "@/pages/Compare";
import Privacy from "@/pages/Privacy";
import AgentsArticle from "@/site/articles/AgentsArticle";
import DebtsArticle from "@/site/articles/DebtsArticle";
import ReconciliationArticle from "@/site/articles/ReconciliationArticle";
import DeliveryArticle from "@/site/articles/DeliveryArticle";
import WarehouseArticle from "@/site/articles/WarehouseArticle";
import { claimPageLang, releasePageLang } from "@/i18n/page-lang";
import {
  NOT_FOUND_FILE, SITE_PAGES, pageLangs, prerenderFile, siteRoute,
  type SiteLang, type SitePageKey,
} from "@contracts/site-pages";
import SiteApp, { type SitePages } from "./SiteApp";
import SiteNotFound from "./SiteNotFound";
import { PrerenderContext } from "./prerender";
import { notFoundHead, siteHead } from "./site-head";

/* ═══════════════════════════════════════════════════════════════════════════
   Сайт для Node: готовый HTML каждой страницы на каждом языке.

   ── Зачем ──────────────────────────────────────────────────────────────────

   Раньше гость получал пустой <div id="root"> и короткую заглушку, а всё
   остальное рисовал скрипт. Робот Google такую страницу выполняет не сразу и
   не всегда, Яндекс и превью Telegram — никогда; человек на медленной связи
   смотрел на заглушку, пока ехали сотни килобайт. Теперь сборка
   (scripts/prerender.mjs) вызывает renderSite() и кладёт настоящий текст
   страниц в HTML: его видят и робот, и человек — до первого байта скрипта.

   ── Как это сходится с браузером ───────────────────────────────────────────

   Те же SiteApp и те же страницы, что у лёгкого входа (site-main): разница
   только в роутере (StaticRouter вместо BrowserRouter) и в метке
   PrerenderContext — по ней тяжёлое и декоративное рисуется пустым местом
   того же размера (TallyField), а тон страницы конкурса — «по системе».
   Браузер не «оживляет» эту разметку (hydrate), а рисует страницу заново
   поверх (createRoot): ни одно расхождение между Node и браузером — язык из
   localStorage, тема, ширина окна — не может сломать страницу.

   ── Язык ───────────────────────────────────────────────────────────────────

   Страница сайта обёрнута в SitePageLang, статья — в свой UrlLang
   (ArticleLayout): язык из адреса. Но эффект, который сообщает язык
   помощникам вне React (tt, uiText), в Node не выполняется. Поэтому язык
   адреса ставится вокруг отрисовки здесь же — и снимается сразу после.
   ═══════════════════════════════════════════════════════════════════════════ */

const PAGES: SitePages = {
  home: Landing, compare: Compare, privacy: Privacy,
  agents: AgentsArticle, debts: DebtsArticle, reconciliation: ReconciliationArticle,
  delivery: DeliveryArticle, warehouse: WarehouseArticle,
};

export interface PrerenderedPage {
  /** Адрес страницы: "/", "/uz/compare". */
  path: string;
  /** Файл в dist/prerender: "index.html", "uz/compare.html". */
  file: string;
  key: SitePageKey;
  lang: SiteLang;
  /** Содержимое <head> страницы (site-head). */
  head: string;
  /** Разметка внутри <div id="root">. */
  html: string;
}

function draw(location: string, tree: ReactNode): string {
  return renderToString(
    <StrictMode>
      <PrerenderContext.Provider value={true}>
        <StaticRouter location={location}>{tree}</StaticRouter>
      </PrerenderContext.Provider>
    </StrictMode>,
  );
}

/** Одна страница сайта по адресу; адрес не из SITE_PAGES — ошибка сборки. */
export function renderPage(path: string): PrerenderedPage {
  const route = siteRoute(path);
  if (!route) throw new Error(`Нет такой страницы сайта: ${path}`);
  const { page, lang } = route;
  const owner = {};
  claimPageLang(owner, lang);
  try {
    return {
      path,
      file: prerenderFile(path),
      key: page.key,
      lang,
      head: siteHead(page, lang),
      html: draw(path, <SiteApp pages={PAGES} />),
    };
  } finally {
    releasePageLang(owner);
  }
}

/** Все страницы сайта на всех их языках — то, что сборка кладёт в dist/prerender. */
export function renderSite(): PrerenderedPage[] {
  return SITE_PAGES.flatMap(page => pageLangs(page).map(lang => renderPage(page.paths[lang]!)));
}

/** «Страница не найдена» — двуязычная, без скрипта. */
export function renderNotFound(): { file: string; head: string; html: string } {
  return { file: NOT_FOUND_FILE, head: notFoundHead(), html: draw("/404", <SiteNotFound />) };
}
