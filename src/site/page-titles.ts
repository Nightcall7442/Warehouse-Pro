import { ARTICLE_KEYS, type ArticleKey, type SiteLang, type SitePageKey } from "@contracts/site-pages";
import { ARTICLES } from "./articles/registry";

/* ═══════════════════════════════════════════════════════════════════════════
   Заголовки страниц сайта — вкладка браузера и <title> готового HTML.

   Отдельно от site-head.ts, потому что нужны в двух местах:
     · при сборке — в <head> готовой страницы (site-head берёт их отсюда);
     · в браузере — при переходе по ссылке сайта без перезагрузки (SiteApp):
       готовый HTML был у первой страницы, и без этого вкладка, история и
       закладка показывали бы её заголовок на любой следующей.
   site-head тянет за собой тексты статей, FAQ и разметку schema.org — в
   браузер он не едет. Здесь — только строки заголовков, а статьи — из
   маленького списка (articles/registry), который сайт и так загружает.
   ═══════════════════════════════════════════════════════════════════════════ */

type L = Record<SiteLang, string>;

/** Заголовок каждой страницы на каждом языке. */
export const PAGE_TITLES: Record<SitePageKey, L> = {
  ...(Object.fromEntries(ARTICLE_KEYS.map(k => [k, ARTICLES[k].title])) as Record<ArticleKey, L>),
  home: {
    ru: "Warehouse Pro — агенты, долги магазинов и доставка в одной программе",
    uz: "Warehouse Pro — agentlar, do'kon qarzlari va yetkazish bitta dasturda",
  },
  compare: {
    ru: "Warehouse Pro, Sales Doctor, Smartup — сравнение систем для дистрибуции",
    uz: "Warehouse Pro, Sales Doctor, Smartup — distribyutsiya tizimlarini taqqoslash",
  },
  // Политика — русский документ (src/pages/Privacy.tsx); узбекская строка
  // здесь только чтобы тип был полным — страницы /uz/privacy нет.
  privacy: {
    ru: "Политика конфиденциальности — Warehouse Pro",
    uz: "Maxfiylik siyosati — Warehouse Pro",
  },
};
