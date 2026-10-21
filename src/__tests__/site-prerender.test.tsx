// @vitest-environment node
import { describe, it, expect } from "vitest";
import { renderNotFound, renderPage, renderSite } from "@/site/entry-server";
import { structuredData } from "@/site/site-head";
import { pageLangOverride } from "@/i18n/page-lang";
import { FAQ_ITEMS } from "@/components/landing/site-content";
import { CONTACT } from "@/components/landing/landing-tokens";
import { FIELD_PRICE_UZS, MIN_FIELD_USERS } from "@contracts/pricing";
import { SITE_PAGES, absoluteUrl, ogImagePath, pageLangs, siteRoute } from "@contracts/site-pages";

/**
 * Готовые страницы сайта: то, что сборка кладёт в dist/prerender, а сервер
 * отдаёт гостю и роботу до всякого скрипта.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Среда — Node, без document и window: так же, как при сборке.
 *
 * 1. Страницы рисуются вообще: модуль темы (useTheme) больше не трогает
 *    document при загрузке, и /compare, тянущий его через PitchShell, не
 *    роняет сборку.
 * 2. В разметке — настоящий текст на языке адреса: / — по-русски, /uz — по-
 *    узбекски; язык адреса для помощников вне React снят после отрисовки.
 * 3. Поле ячеек (1 536 меток SVG) — пустое место той же высоты; страница
 *    сравнения — тон «по системе», а не светлый по умолчанию.
 * 4. <head>: заголовок, описание, canonical на себя, hreflang ru/uz/x-default
 *    (у русской политики — ни одного), карточка 1200×630 своя на страницу и
 *    язык, twitter summary_large_image, метка wp-site.
 * 5. schema.org одним графом: Organization (Ургенч, почта), WebSite,
 *    SoftwareApplication с ценой из contracts/pricing; FAQPage на главной —
 *    слово в слово тот FAQ, что виден на странице, у сравнения и политики
 *    его нет (FAQPage статей — site-articles.test).
 * 6. 404 — оба языка, noindex.
 *
 * Нарочная поломка: убрать проверку document в useTheme — падает весь файл
 * («document is not defined» при загрузке); убрать usePrerender из
 * TallyField — «поле ячеек»; поменять слово в FAQ только в разметке —
 * «FAQPage слово в слово».
 */

const decode = (s: string) =>
  s.replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
/** Видимый текст разметки: без тегов, комментариев и <style>. */
const textOf = (html: string) =>
  decode(html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

const ld = (head: string) => JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(head)![1]);
type Node = { "@type": string; [k: string]: unknown };
const node = (head: string, type: string) => (ld(head)["@graph"] as Node[]).find(n => n["@type"] === type);

describe("готовые страницы рисуются в Node", () => {
  it("каждая страница сайта на каждом её языке — и только они", () => {
    const pages = renderSite();
    expect(pages.map(p => p.path).sort()).toEqual(SITE_PAGES.flatMap(p => pageLangs(p).map(l => p.paths[l]!)).sort());
    for (const p of pages) expect(p.html.length, p.path).toBeGreaterThan(5000);
    expect(pages.map(p => p.file).sort()).toEqual([
      "compare.html", "delivery-cash.html", "distributor-warehouse.html", "index.html", "privacy.html",
      "reconciliation-act.html", "sales-agents.html", "shop-debts.html", "uz.html", "uz/compare.html",
      "uz/delivery-cash.html", "uz/distributor-warehouse.html", "uz/reconciliation-act.html",
      "uz/sales-agents.html", "uz/shop-debts.html",
    ]);
  });

  it("/ — русский текст первого экрана, /uz — узбекский", () => {
    const ru = renderPage("/");
    const uz = renderPage("/uz");
    expect(ru.lang).toBe("ru");
    expect(uz.lang).toBe("uz");
    expect(textOf(ru.html)).toMatch(/Агенты, долги магазинов/);
    expect(textOf(uz.html)).toMatch(/Agentlar, do'kon qarzlari/);
    expect(textOf(uz.html)).not.toMatch(/Агенты, долги магазинов/);
    // Язык адреса — только на время отрисовки /uz.
    expect(pageLangOverride()).toBeNull();
  });

  it("сравнение и политика — со своим текстом", () => {
    expect(textOf(renderPage("/compare").html)).toMatch(/Sales Doctor/);
    expect(textOf(renderPage("/uz/compare").html)).toMatch(/Sales Doctor/);
    const privacy = renderPage("/privacy").html;
    expect(textOf(privacy)).toMatch(/Политика конфиденциальности/);
    // Ссылки на главную — на «/», а не на прежний /landing (он теперь 301).
    expect(privacy).not.toMatch(/href="\/landing"/);
    expect(privacy).toMatch(/href="\/"/);
  });

  it("поле ячеек — пустое место той же высоты, подписи на месте", () => {
    const html = renderPage("/").html;
    expect(html).not.toMatch(/data-cell/);
    expect(html).toMatch(/data-testid="tally-placeholder" style="height:176px"/);
    expect(textOf(html)).toMatch(/занятость ячеек/);
  });

  it("страница сравнения — тон «по системе», а не светлый по умолчанию", () => {
    expect(renderPage("/compare").html).toMatch(/class="pitch" data-tone="auto"/);
  });

  it("адрес не из списка — ошибка сборки, а не пустая страница", () => {
    expect(() => renderPage("/nope")).toThrow(/Нет такой страницы/);
    expect(() => renderPage("/uz/")).toThrow();
  });
});

describe("<head> страницы на её языке", () => {
  it.each(SITE_PAGES.flatMap(p => pageLangs(p).map(l => [p.paths[l]!, l] as const)))("%s (%s)", (path, lang) => {
    const { head } = renderPage(path);
    const page = siteRoute(path)!.page;
    const url = absoluteUrl(path);
    expect(head).toMatch(/<title>[^<]{20,}<\/title>/);
    expect(head).toMatch(/<meta name="description" content="[^"]{60,}" \/>/);
    expect(head).toContain(`<link rel="canonical" href="${url}" />`);
    const alternates = [...head.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)" \/>/g)].map(m => [m[1], m[2]]);
    if (pageLangs(page).length > 1) {
      expect(alternates).toEqual([
        ["ru", absoluteUrl(page.paths.ru)],
        ["uz", absoluteUrl(page.paths.uz!)],
        ["x-default", absoluteUrl(page.paths.ru)],
      ]);
    } else {
      expect(alternates).toEqual([]);
    }
    expect(head).toContain(`<meta property="og:url" content="${url}" />`);
    expect(head).toContain(`<meta property="og:image" content="${absoluteUrl(ogImagePath(page.key, lang))}" />`);
    expect(head).toContain('<meta property="og:image:width" content="1200" />');
    expect(head).toContain('<meta property="og:image:height" content="630" />');
    expect(head).toContain(`<meta property="og:locale" content="${lang === "uz" ? "uz_UZ" : "ru_RU"}" />`);
    expect(head).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(head).toContain(`<meta name="wp-site" content="${page.key}" />`);
    expect(head).not.toMatch(/noindex/);
    // Язык заголовка — язык страницы.
    const title = /<title>([^<]+)<\/title>/.exec(head)![1];
    expect(/[а-яё]/i.test(title), title).toBe(lang === "ru");
  });

  it("schema.org: организация в Ургенче, сайт, программа с ценой из contracts/pricing", () => {
    for (const [path, lang] of [["/", "ru"], ["/uz", "uz"]] as const) {
      const { head } = renderPage(path);
      const org = node(head, "Organization")!;
      expect((org.address as { addressLocality: string }).addressLocality).toBe(lang === "ru" ? "Ургенч" : "Urganch");
      expect((org.address as { addressRegion: string }).addressRegion).toMatch(lang === "ru" ? /Хорезм/ : /Xorazm/);
      expect((org.address as { addressCountry: string }).addressCountry).toBe("UZ");
      expect(org.logo).toBe("https://www.warehouse-pro.uz/icon-512.png");
      expect(org.email).toBe(CONTACT.email);
      expect(node(head, "WebSite")).toBeDefined();
      const app = node(head, "SoftwareApplication")!;
      const offer = app.offers as { price: string; priceCurrency: string; eligibleQuantity: { minValue: number } };
      expect(offer.price).toBe(String(FIELD_PRICE_UZS));
      expect(offer.priceCurrency).toBe("UZS");
      expect(offer.eligibleQuantity.minValue).toBe(MIN_FIELD_USERS);
      // Ни оценок, ни отзывов: их нечем подтвердить.
      expect(head).not.toMatch(/aggregateRating|"review"/);
    }
  });

  it("FAQPage на главной — слово в слово тот FAQ, что виден на странице; у сравнения и политики — нет", () => {
    for (const [path, lang] of [["/", "ru"], ["/uz", "uz"]] as const) {
      const { head, html } = renderPage(path);
      const faq = node(head, "FAQPage")!;
      const entities = faq.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>;
      expect(entities.map(e => e.name)).toEqual(FAQ_ITEMS.map(x => x.q[lang]));
      expect(entities.map(e => e.acceptedAnswer.text)).toEqual(FAQ_ITEMS.map(x => x.a[lang]));
      const visible = textOf(html);
      for (const e of entities) {
        expect(visible, e.name).toContain(e.name.replace(/\s+/g, " "));
        expect(visible, e.name).toContain(e.acceptedAnswer.text.replace(/\s+/g, " "));
      }
    }
    for (const path of ["/compare", "/uz/compare", "/privacy"]) expect(node(renderPage(path).head, "FAQPage"), path).toBeUndefined();
    // Тот же граф, что строит site-head, — проверка смотрит в отданный <head>, не в копию.
    expect(ld(renderPage("/").head)).toEqual(JSON.parse(JSON.stringify(structuredData(SITE_PAGES[0], "ru"))));
  });

  it("«</script>» в тексте не закрывает разметку schema.org", () => {
    const { head } = renderPage("/");
    const inner = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(head)![1];
    expect(inner).not.toMatch(/<\//);
  });
});

describe("страница 404", () => {
  it("оба языка, noindex, ссылки на обе главные", () => {
    const { file, head, html } = renderNotFound();
    expect(file).toBe("404.html");
    expect(head).toContain('<meta name="robots" content="noindex" />');
    expect(head).toMatch(/<title>[^<]*не найдена[^<]*topilmadi[^<]*<\/title>/);
    const text = textOf(html);
    expect(text).toMatch(/Такой страницы нет/);
    expect(text).toMatch(/Bunday sahifa yo'q/);
    expect(html).toMatch(/<section lang="ru"/);
    expect(html).toMatch(/<section lang="uz"/);
    expect(html).toMatch(/href="\/"/);
    expect(html).toMatch(/href="\/uz"/);
  });
});
