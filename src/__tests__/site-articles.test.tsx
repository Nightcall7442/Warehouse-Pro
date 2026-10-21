// @vitest-environment node
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderPage } from "@/site/entry-server";
import { PAGE_META, structuredData } from "@/site/site-head";
import { ARTICLES } from "@/site/articles/registry";
import { ARTICLE_TEXTS } from "@/site/articles/texts";
import type { ArticleBlock, ArticleText, L } from "@/site/articles/types";
import { pageLangOverride } from "@/i18n/page-lang";
import { FIELD_PRICE_UZS, formatSum } from "@contracts/pricing";
import {
  ARTICLE_KEYS, ARTICLE_SLUGS, SITE_LANGS, SITE_PAGES, absoluteUrl, alternatesOf, ogImagePath, pageLangs, sitePage,
  type ArticleKey, type SiteLang,
} from "@contracts/site-pages";

/**
 * Статьи сайта: пять задач дистрибьютора словами читателя — каждая на
 * русском (/shop-debts) и узбекском (/uz/shop-debts).
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * 1. Каждая статья рисуется при сборке на обоих языках, и в готовом HTML —
 *    весь её текст: вступление, разделы, подписи снимков, FAQ. Робот и
 *    человек без скрипта читают статью целиком.
 * 2. <head>: заголовки и описания всех страниц сайта разные (поиск не
 *    склеивает), og:type article, разметка Article и BreadcrumbList, FAQPage
 *    слово в слово с видимым FAQ.
 * 3. Карта сайта: у каждой статьи — пара ru/uz с x-default.
 * 4. Тексты: русская версия — 700–1200 слов, узбекская — латиницей и с
 *    обычным апострофом (do'kon), как весь сайт; структура обеих одна.
 * 5. Честность: ни конкурентов, ни «iOS и Android», а статья о доставке не
 *    обещает того, чего в основной ветке нет (слежения за курьером и
 *    подтверждения вручения снимком).
 * 6. Связи: статьи ведут друг на друга, приложение (App.tsx) знает их
 *    адреса.
 *
 * Нарочная поломка: поменять слово в ответе FAQ только в site-head — падает
 * «FAQPage слово в слово»; вписать в статью о доставке «GPS курьера» —
 * «доставка»; заменить апостроф в узбекском на «ʻ» — «узбекский текст».
 */

const decode = (s: string) =>
  s.replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
/** Видимый текст разметки: без тегов, комментариев и <style>. */
const textOf = (html: string) =>
  decode(html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

const ld = (head: string) => JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(head)![1]);
type Node = { "@type": string; [k: string]: unknown };
const node = (head: string, type: string) => (ld(head)["@graph"] as Node[]).find(n => n["@type"] === type);

/** Все строки статьи на языке — в порядке страницы. */
function blockTexts(b: ArticleBlock): L[] {
  if ("p" in b) return [b.p];
  if ("steps" in b) return b.steps;
  if ("list" in b) return b.list;
  if ("shot" in b) return [b.shot.caption];
  if ("note" in b) return [b.note.title, b.note.text];
  return [b.text];
}
function allTexts(a: ArticleText): L[] {
  return [
    a.h1,
    ...a.lead,
    ...a.sections.flatMap(s => [s.h2, ...s.blocks.flatMap(blockTexts)]),
    ...a.faq.flatMap(x => [x.q, x.a]),
  ];
}
/** Все пары строк статьи, включая подписи картинок и данные из списка статей. */
function everyPair(key: ArticleKey): L[] {
  const a = ARTICLE_TEXTS[key];
  const m = ARTICLES[key];
  const alts = a.sections.flatMap(s => s.blocks.flatMap(b => ("shot" in b ? [b.shot.alt] : [])));
  return [...allTexts(a), ...alts, m.nav, m.title, m.description, m.card.kicker, m.card.title, m.card.line];
}

const words = (s: string) => s.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;

const ARTICLE_PATHS = ARTICLE_KEYS.flatMap(k => SITE_LANGS.map(l => [k, l, sitePage(k).paths[l]!] as const));

describe("статьи в списке страниц", () => {
  it("пять статей, у каждой адрес /<слово> и /uz/<слово>", () => {
    expect(ARTICLE_KEYS).toHaveLength(5);
    for (const k of ARTICLE_KEYS) {
      const page = sitePage(k);
      expect(page.kind).toBe("article");
      expect(page.paths).toEqual({ ru: `/${ARTICLE_SLUGS[k]}`, uz: `/uz/${ARTICLE_SLUGS[k]}` });
      expect(ARTICLE_SLUGS[k]).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
    // Страницы — не статьи.
    expect(SITE_PAGES.filter(p => p.kind === "page").map(p => p.key).sort()).toEqual(["compare", "home", "privacy"]);
  });
});

describe("готовый HTML статьи", () => {
  it.each(ARTICLE_PATHS)("%s (%s) %s — весь текст статьи на языке адреса", (key, lang, p) => {
    const page = renderPage(p);
    expect(page.lang).toBe(lang);
    expect(page.key).toBe(key);
    const text = textOf(page.html);
    for (const s of allTexts(ARTICLE_TEXTS[key])) expect(text, s[lang]).toContain(squash(s[lang]));
    // Чужого языка в заголовке нет.
    const other: SiteLang = lang === "ru" ? "uz" : "ru";
    expect(text).not.toContain(ARTICLE_TEXTS[key].h1[other]);
    // Язык адреса снят после отрисовки.
    expect(pageLangOverride()).toBeNull();
  });

  it.each(ARTICLE_PATHS)("%s (%s): крошки, переключатель на пару, призыв и соседние статьи", (key, lang, p) => {
    const { html } = renderPage(p);
    const page = sitePage(key);
    const other: SiteLang = lang === "ru" ? "uz" : "ru";
    // Хлебные крошки: главная на этом языке, статья — текущая страница.
    expect(html).toMatch(new RegExp(`<a href="${lang === "uz" ? "/uz" : "/"}"[^>]*>${lang === "uz" ? "Bosh sahifa" : "Главная"}</a>`));
    expect(html).toContain(`<li aria-current="page">${ARTICLES[key].nav[lang].replace(/'/g, "&#x27;")}</li>`);
    // Переключатель — настоящая ссылка на ту же статью на другом языке.
    expect(html).toMatch(new RegExp(`<a href="${page.paths[other]}" hrefLang="${other}" lang="${other}"`));
    // Призыв: регистрация и демо на языке страницы.
    expect(html).toMatch(/data-testid="article-cta-register"/);
    expect(html).toMatch(/<a href="\/register"[^>]*data-testid="article-cta-register"/);
    expect(html).toContain(`href="/demo?lang=${lang}"`);
    // Цена под призывом — из contracts/pricing и в сумах (цена платформы).
    expect(html).toContain(`${formatSum(FIELD_PRICE_UZS)} ${lang === "ru" ? "сум" : "so&#x27;m"}`);
    // Четыре соседние статьи — на том же языке.
    for (const k of ARTICLE_KEYS.filter(x => x !== key)) {
      expect(html, k).toContain(`href="${sitePage(k).paths[lang]}"`);
    }
    // Снимки — из кадров лендинга этого языка, с размерами заранее.
    for (const m of html.matchAll(/<img src="([^"]+)"[^>]*>/g)) {
      expect(m[1]).toMatch(new RegExp(`^/landing/${lang}/[a-z-]+\\.webp$`));
      expect(m[0]).toMatch(/width="\d+" height="\d+"/);
      expect(m[0]).toMatch(/loading="lazy"/);
    }
  });

  it("<html lang> и метка wp-site — у каждой статьи свои", () => {
    for (const [key, lang, p] of ARTICLE_PATHS) {
      const { head } = renderPage(p);
      expect(head).toContain(`<meta name="wp-site" content="${key}" />`);
      expect(head).toContain(`<link rel="canonical" href="${absoluteUrl(p)}" />`);
      expect(head).toContain(`<meta property="og:locale" content="${lang === "uz" ? "uz_UZ" : "ru_RU"}" />`);
    }
  });
});

describe("<head> статей", () => {
  it("заголовки и описания всех страниц сайта на всех языках — разные", () => {
    const titles: string[] = [];
    const descriptions: string[] = [];
    for (const page of SITE_PAGES) for (const lang of pageLangs(page)) {
      titles.push(PAGE_META[page.key].title[lang]);
      descriptions.push(PAGE_META[page.key].description[lang]);
    }
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    // И в отданном <head> — те же.
    for (const [key, lang, p] of ARTICLE_PATHS) {
      const { head } = renderPage(p);
      expect(head).toContain(`<title>${ARTICLES[key].title[lang]}</title>`);
    }
  });

  it("длина: заголовок до 90 знаков, описание 60–200", () => {
    for (const k of ARTICLE_KEYS) for (const l of SITE_LANGS) {
      expect(ARTICLES[k].title[l].length, `${k}/${l}`).toBeLessThanOrEqual(90);
      expect(ARTICLES[k].description[l].length, `${k}/${l}`).toBeGreaterThanOrEqual(60);
      expect(ARTICLES[k].description[l].length, `${k}/${l}`).toBeLessThanOrEqual(200);
    }
  });

  it.each(ARTICLE_PATHS)("%s (%s): og:type article, Article и BreadcrumbList", (key, lang, p) => {
    const { head, html } = renderPage(p);
    const page = sitePage(key);
    const url = absoluteUrl(p);
    expect(head).toContain('<meta property="og:type" content="article" />');
    expect(head).toContain(`<meta property="article:modified_time" content="${page.lastmod}" />`);
    const article = node(head, "Article")!;
    expect(article.headline).toBe(ARTICLE_TEXTS[key].h1[lang]);
    expect((article.headline as string).length).toBeLessThanOrEqual(110);
    expect(article.inLanguage).toBe(lang);
    expect(article.image).toBe(absoluteUrl(ogImagePath(key, lang)));
    expect(article.dateModified).toBe(page.lastmod);
    expect(article.datePublished).toBe(ARTICLES[key].published);
    expect(article.mainEntityOfPage).toEqual({ "@id": `${url}#webpage` });
    // Крошки разметки — те же, что видны на странице.
    const crumbs = node(head, "BreadcrumbList")!.itemListElement as Array<{ position: number; name: string; item: string }>;
    expect(crumbs.map(c => c.position)).toEqual([1, 2]);
    expect(crumbs[0].item).toBe(absoluteUrl(lang === "uz" ? "/uz" : "/"));
    expect(crumbs[1]).toMatchObject({ name: ARTICLES[key].nav[lang], item: url });
    const visible = textOf(html);
    for (const c of crumbs) expect(visible).toContain(c.name);
    // Ни оценок, ни отзывов.
    expect(head).not.toMatch(/aggregateRating|"review"/);
    // Тот же граф, что строит site-head.
    expect(ld(head)).toEqual(JSON.parse(JSON.stringify(structuredData(page, lang))));
  });

  it.each(ARTICLE_PATHS)("%s (%s): FAQPage слово в слово с видимым FAQ", (key, lang, p) => {
    const { head, html } = renderPage(p);
    const faq = node(head, "FAQPage")!;
    const entities = faq.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>;
    expect(entities.map(e => e.name)).toEqual(ARTICLE_TEXTS[key].faq.map(x => x.q[lang]));
    expect(entities.map(e => e.acceptedAnswer.text)).toEqual(ARTICLE_TEXTS[key].faq.map(x => x.a[lang]));
    const visible = textOf(html);
    for (const e of entities) {
      expect(visible, e.name).toContain(squash(e.name));
      expect(visible, e.name).toContain(squash(e.acceptedAnswer.text));
    }
  });
});

describe("карта сайта", () => {
  const xml = readFileSync(path.join(process.cwd(), "public/sitemap.xml"), "utf8");
  it.each(ARTICLE_PATHS)("%s (%s) %s — в карте с парой и x-default", (key, _lang, p) => {
    const body = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => m[1]).find(b => b.includes(`<loc>${absoluteUrl(p)}</loc>`));
    expect(body, p).toBeDefined();
    const alternates = [...body!.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)" \/>/g)].map(a => ({ hreflang: a[1], href: a[2] }));
    expect(alternates).toEqual(alternatesOf(sitePage(key)));
    expect(alternates.map(a => a.hreflang)).toEqual(["ru", "uz", "x-default"]);
  });
});

describe("тексты статей", () => {
  it.each(ARTICLE_KEYS)("%s: русская версия — 700–1200 слов вместе с FAQ", key => {
    const n = allTexts(ARTICLE_TEXTS[key]).reduce((sum, s) => sum + words(s.ru), 0);
    expect(n).toBeGreaterThanOrEqual(700);
    expect(n).toBeLessThanOrEqual(1200);
  });

  it.each(ARTICLE_KEYS)("%s: узбекский текст — латиницей, апостроф обычный, перевод полный", key => {
    for (const s of everyPair(key)) {
      expect(s.uz.trim(), s.ru).not.toBe("");
      expect(s.ru.trim(), s.uz).not.toBe("");
      expect(s.uz, s.uz).not.toMatch(/[Ѐ-ӿ]/);
      // ʻ ʼ ‘ ’ ` — так пишут o‘zbek в других местах интернета; у нас, как во всём
      // приложении, обычный «'» (do'kon, o'z, ma'lumot).
      expect(s.uz, s.uz).not.toMatch(/[ʻʼ‘’`]/);
      expect(s.ru, s.ru).toMatch(/[а-яё]/i);
    }
  });

  it.each(ARTICLE_KEYS)("%s: структура одна — вступление, разделы, FAQ, ссылки", key => {
    const a = ARTICLE_TEXTS[key];
    expect(a.key).toBe(key);
    expect(a.lead.length).toBeGreaterThanOrEqual(2);
    expect(a.sections.length).toBeGreaterThanOrEqual(4);
    expect(a.faq.length).toBeGreaterThanOrEqual(4);
    // Якоря — латиницей и разные: на них ведёт оглавление.
    const ids = a.sections.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+$/);
    expect(ids).not.toContain("faq");
    // Хотя бы одна ссылка на соседнюю статью — и не на саму себя.
    const sees = a.sections.flatMap(s => s.blocks.flatMap(b => ("see" in b ? [b.see] : [])));
    expect(sees.length).toBeGreaterThanOrEqual(1);
    expect(sees).not.toContain(key);
  });

  it("снимки — настоящие кадры лендинга, на обоих языках", () => {
    let shots = 0;
    for (const k of ARTICLE_KEYS) for (const s of ARTICLE_TEXTS[k].sections) for (const b of s.blocks) {
      if (!("shot" in b)) continue;
      shots++;
      for (const l of SITE_LANGS) {
        const html = renderPage(sitePage(k).paths[l]!).html;
        const src = /<img src="([^"]+)"/.exec(html)![1];
        expect(existsSync(path.join(process.cwd(), "public", src)), src).toBe(true);
      }
    }
    // Четыре статьи из пяти — со снимком; у акта сверки подходящего кадра нет.
    expect(shots).toBe(4);
  });

  it("ни конкурентов, ни «iOS и Android», ни выдуманных клиентов", () => {
    for (const k of ARTICLE_KEYS) for (const s of everyPair(k)) for (const l of SITE_LANGS) {
      expect(s[l]).not.toMatch(/Sales ?Doctor|Smartup|Wareon|iOS (и|va) Android|клиент[а-я]* (говор|сказ)/i);
    }
  });

  it("статья о доставке — только то, что есть: ни слежения за курьером, ни подтверждения снимком", () => {
    for (const s of everyPair("delivery")) {
      expect(s.ru, s.ru).not.toMatch(/GPS|геолокац|слежени|фото|снимк|подпис/i);
      expect(s.uz, s.uz).not.toMatch(/GPS|geolokats|kuzatuv|surat|foto|imzo/i);
    }
    // И в отданной странице — в самой статье; «Ещё по теме» ниже честно
    // пересказывает статью об агентах, где GPS есть.
    for (const l of SITE_LANGS) {
      const body = /<article[\s\S]*<\/article>/.exec(renderPage(sitePage("delivery").paths[l]!).html)![0];
      expect(textOf(body)).not.toMatch(/GPS/);
    }
  });
});

describe("связи статей с сайтом и приложением", () => {
  it("приложение знает адреса статей на обоих языках — вошедшему не «не найдено»", () => {
    const app = readFileSync(path.join(process.cwd(), "src/App.tsx"), "utf8");
    const uzFallback = app.indexOf('<Route path="/uz/*"');
    for (const [, , p] of ARTICLE_PATHS) {
      const at = app.indexOf(`<Route path="${p}" `);
      expect(at, p).toBeGreaterThan(0);
      // Раньше общего «/uz/*» — иначе он перехватил бы узбекскую статью.
      expect(at, p).toBeLessThan(uzFallback);
    }
  });

  it("статья читается с телефона: текст 17px, ни одна читаемая строка не мельче 16px", () => {
    const src = readFileSync(path.join(process.cwd(), "src/site/articles/ArticleLayout.tsx"), "utf8");
    expect(src).toMatch(/\.wa-body \{ font-size: 17px;/);
    // Номера оглавления (14px) — рисунок рядом со ссылкой, не текст для чтения.
    const sizes = [...src.matchAll(/\.wa-[\w-]+(?:\s[^{]*)?\{[^}]*font-size: (\d+)px/g)]
      .filter(m => !m[0].includes("::before"))
      .map(m => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(4);
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(16);
  });
});
