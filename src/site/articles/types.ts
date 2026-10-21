import type { ArticleKey, SiteLang } from "@contracts/site-pages";
import type { MobileShotKey, WebShotKey } from "@/components/landing/shots";

/* ═══════════════════════════════════════════════════════════════════════════
   Статьи сайта — данные, а не разметка.

   ── Зачем данными ──────────────────────────────────────────────────────────

   Один и тот же текст нужен в трёх местах: на странице (ArticleLayout), в
   разметке schema.org (src/site/site-head: заголовок статьи и FAQPage) и в
   проверках. FAQPage обязан повторять видимый FAQ слово в слово — иначе это
   нарушение правил поиска; когда вопрос и ответ записаны один раз, разойтись
   им негде.

   Русский и узбекский — рядом, в одной паре: так переводчик и проверка видят,
   что у каждого абзаца есть оба языка и что структура одна.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Текст на обоих языках сайта. */
export type L = Record<SiteLang, string>;

/** Пара строк: русская и узбекская. */
export const both = (ru: string, uz: string): L => ({ ru, uz });

/** Снимок настоящей программы из public/landing/<язык>/ — тот же, что на лендинге. */
export type ArticleShot =
  | { phone: MobileShotKey; alt: L; caption: L }
  | { web: WebShotKey; alt: L; caption: L };

/** Кусок раздела статьи. Текст — без разметки: экраны программы — в «ёлочках». */
export type ArticleBlock =
  | { p: L }
  /** Пошаговое: нумерованный список. */
  | { steps: L[] }
  | { list: L[] }
  | { shot: ArticleShot }
  /** Честная оговорка: чего программа не делает. */
  | { note: { title: L; text: L } }
  /** Ссылка на соседнюю статью — словами, о чём она. */
  | { see: ArticleKey; text: L };

export interface ArticleSection {
  /** Якорь раздела (#gps) — латиницей, для оглавления. */
  id: string;
  h2: L;
  blocks: ArticleBlock[];
}

export interface ArticleText {
  key: ArticleKey;
  h1: L;
  /** Вступление: задача словами читателя. */
  lead: L[];
  sections: ArticleSection[];
  /** Вопросы и ответы — видны на странице целиком и ровно так же уходят в FAQPage. */
  faq: Array<{ q: L; a: L }>;
}

/** Всё, что о статье знают другие страницы: подвал лендинга, соседние статьи, <head>, карточка ссылки. */
export interface ArticleMeta {
  key: ArticleKey;
  /** Короткое имя — для ссылок и хлебных крошек. */
  nav: L;
  /** <title> — до ~70 знаков, с названием программы. */
  title: L;
  /** <meta name="description"> — 60–200 знаков. */
  description: L;
  /** Текст картинки карточки ссылки (scripts/og-images.mjs). */
  card: { kicker: L; title: L; line: L };
  /** Дата первой публикации — datePublished в разметке. */
  published: string;
}
