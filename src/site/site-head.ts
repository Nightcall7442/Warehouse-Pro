/* ═══════════════════════════════════════════════════════════════════════════
   <head> готовых страниц сайта: то, что видят поиск и превью ссылки.

   ── Зачем своё на каждую страницу и язык ───────────────────────────────────

   Приложение одностраничное, и раньше сервер отдавал один index.html с одной
   русской карточкой на любой адрес. /uz показывал бы Telegram русский
   заголовок, /compare — «склад, заказы и агенты», а canonical у всех вёл на
   «/»: поиск склеивал страницы в одну. Теперь у каждой страницы на каждом
   языке — свои заголовок и описание, свой canonical на саму себя, ссылки на
   другую языковую версию (hreflang ru, uz и x-default — русская), своя
   картинка 1200×630 и разметка schema.org.

   ── Правило слов ───────────────────────────────────────────────────────────

   То же, что у сайта (site-content.ts): только то, что делает код. Цена — из
   contracts/pricing, вопросы FAQ — из FAQ_ITEMS (главная) и из текста
   статьи (src/site/articles), ровно теми словами, что на странице: разметка
   FAQPage, расходящаяся с видимым текстом, — нарушение правил поиска, и
   проверки (site-prerender, site-articles) это стерегут.

   У статьи сверх того — Article (заголовок, даты, картинка, кто издал) и
   BreadcrumbList (Главная › статья, как в хлебных крошках на странице), а
   og:type — article.

   Файл собирается вместе с сайтом для Node (src/site/entry-server.tsx) и
   работает только при сборке — в браузер не попадает.
   ═══════════════════════════════════════════════════════════════════════════ */
import { FIELD_PRICE_UZS, MIN_FIELD_USERS } from "@contracts/pricing";
import {
  ARTICLE_KEYS, OG_HEIGHT, OG_WIDTH, SITE_ORIGIN, absoluteUrl, alternatesOf, ogImagePath, pageLangs,
  type ArticleKey, type SiteLang, type SitePage, type SitePageKey,
} from "@contracts/site-pages";
import { CONTACT } from "@/components/landing/landing-tokens";
import { FAQ_ITEMS } from "@/components/landing/site-content";
import { sitePath } from "@/lib/site-paths";
import { ARTICLES } from "./articles/registry";
import { ARTICLE_TEXTS } from "./articles/texts";

type L = Record<SiteLang, string>;

type PageMeta = { title: L; description: L; imageAlt: L };

/** Статьи — из их списка (src/site/articles/registry): подпись картинки — заголовок карточки. */
const ARTICLE_META = Object.fromEntries(ARTICLE_KEYS.map(k => [k, {
  title: ARTICLES[k].title,
  description: ARTICLES[k].description,
  imageAlt: ARTICLES[k].card.title,
}])) as Record<ArticleKey, PageMeta>;

/** Заголовок, описание и подпись картинки — для каждой страницы на каждом языке. */
export const PAGE_META: Record<SitePageKey, PageMeta> = {
  ...ARTICLE_META,
  home: {
    title: {
      ru: "Warehouse Pro — агенты, долги магазинов и доставка в одной программе",
      uz: "Warehouse Pro — agentlar, do'kon qarzlari va yetkazish bitta dasturda",
    },
    description: {
      ru: "Программа для дистрибьюторов с торговыми агентами: заказы с телефона даже без сети, склад, доставка и долг каждого магазина. 14 дней бесплатно, без карты. Ургенч, Хорезм.",
      uz: "Savdo agentlari bor distribyutorlar uchun dastur: tarmoq bo'lmasa ham telefondan buyurtma, ombor, yetkazish va har bir do'konning qarzi. 14 kun bepul, kartasiz. Urganch, Xorazm.",
    },
    imageAlt: {
      ru: "Warehouse Pro — агенты, долги магазинов и доставка в одной программе",
      uz: "Warehouse Pro — agentlar, do'kon qarzlari va yetkazish bitta dasturda",
    },
  },
  compare: {
    title: {
      ru: "Warehouse Pro, Sales Doctor, Smartup — сравнение систем для дистрибуции",
      uz: "Warehouse Pro, Sales Doctor, Smartup — distribyutsiya tizimlarini taqqoslash",
    },
    description: {
      ru: "Раздел за разделом: погрузочные листы, редактор заказа, частичная доставка, акт сверки, склад, отчёты. Что работает у нас и что другие говорят публично — со ссылками и датой.",
      uz: "Bo'limma-bo'lim: yuklash varaqalari, buyurtma muharriri, qisman yetkazish, solishtirma dalolatnoma, ombor, hisobotlar. Bizda nima ishlaydi va boshqalar ochiq nima deydi — havola va sana bilan.",
    },
    imageAlt: {
      ru: "Сравнение систем для дистрибуции: Warehouse Pro, Sales Doctor, Smartup",
      uz: "Distribyutsiya tizimlarini taqqoslash: Warehouse Pro, Sales Doctor, Smartup",
    },
  },
  privacy: {
    // Политика — русский документ (src/pages/Privacy.tsx); узбекские строки
    // здесь только чтобы тип был полным — страницы /uz/privacy нет.
    title: {
      ru: "Политика конфиденциальности — Warehouse Pro",
      uz: "Maxfiylik siyosati — Warehouse Pro",
    },
    description: {
      ru: "Что собирает Warehouse Pro и зачем: данные организации, местоположение агента — только при включённом «Авто-трекинге», фото визитов. Кто это видит, сколько хранится и как удалить.",
      uz: "Warehouse Pro nimani va nima uchun yig'adi: tashkilot ma'lumotlari, agent joylashuvi — faqat «Avto-kuzatuv» yoqilganda, tashrif suratlari.",
    },
    imageAlt: {
      ru: "Warehouse Pro — политика конфиденциальности",
      uz: "Warehouse Pro — maxfiylik siyosati",
    },
  },
};

/** Заголовок и описание страницы «не найдено» — она двуязычная, одна на оба языка. */
export const NOT_FOUND_META = {
  title: "Страница не найдена · Sahifa topilmadi — Warehouse Pro",
  description: "Такой страницы на сайте нет. Bunday sahifa saytda yo'q.",
};

const OG_LOCALE: Record<SiteLang, string> = { ru: "ru_RU", uz: "uz_UZ" };

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** JSON внутри <script>: «</script>» в тексте не должен закрыть тег. */
const jsonForScript = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

const ORG_ID = `${SITE_ORIGIN}/#organization`;
const SITE_ID = `${SITE_ORIGIN}/#website`;
const APP_ID = `${SITE_ORIGIN}/#software`;

/** Вопросы и ответы — в разметку FAQPage тем же текстом, что на странице. */
const faqPage = (url: string, lang: SiteLang, items: ReadonlyArray<{ q: L; a: L }>) => ({
  "@type": "FAQPage",
  "@id": `${url}#faq`,
  inLanguage: lang,
  mainEntity: items.map(x => ({
    "@type": "Question",
    name: x.q[lang],
    acceptedAnswer: { "@type": "Answer", text: x.a[lang] },
  })),
});

/**
 * Разметка schema.org одним графом: кто (Organization), где (WebSite), что
 * продаётся и почём (SoftwareApplication с ценой из contracts/pricing), сама
 * страница (WebPage), на главной — FAQPage словами FAQ_ITEMS, у статьи —
 * Article, BreadcrumbList и FAQPage словами её FAQ.
 *
 * Только проверяемые факты: ни оценок, ни отзывов, ни числа клиентов.
 */
export function structuredData(page: SitePage, lang: SiteLang): object {
  const url = absoluteUrl(page.paths[lang]!);
  const meta = PAGE_META[page.key];
  const uz = lang === "uz";
  const graph: object[] = [
    {
      "@type": "Organization",
      "@id": ORG_ID,
      name: "Warehouse Pro",
      url: `${SITE_ORIGIN}/`,
      logo: `${SITE_ORIGIN}/icon-512.png`,
      ...(CONTACT.email ? { email: CONTACT.email } : {}),
      areaServed: { "@type": "Country", name: uz ? "O'zbekiston" : "Узбекистан" },
      address: {
        "@type": "PostalAddress",
        addressLocality: uz ? "Urganch" : "Ургенч",
        addressRegion: uz ? "Xorazm viloyati" : "Хорезмская область",
        addressCountry: "UZ",
      },
    },
    {
      "@type": "WebSite",
      "@id": SITE_ID,
      url: `${SITE_ORIGIN}/`,
      name: "Warehouse Pro",
      inLanguage: ["ru", "uz"],
      publisher: { "@id": ORG_ID },
    },
    {
      "@type": "SoftwareApplication",
      "@id": APP_ID,
      name: "Warehouse Pro",
      url: `${SITE_ORIGIN}/`,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, Android",
      inLanguage: ["ru", "uz"],
      description: PAGE_META.home.description[lang],
      publisher: { "@id": ORG_ID },
      offers: {
        "@type": "Offer",
        price: String(FIELD_PRICE_UZS),
        priceCurrency: "UZS",
        description: uz
          ? `Har bir dala xodimi uchun oyiga, kamida ${MIN_FIELD_USERS} nafar; ofis xodimlari bepul. 14 kun bepul sinov.`
          : `За полевого сотрудника в месяц, минимум ${MIN_FIELD_USERS}; офис — бесплатно. 14 дней бесплатно.`,
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: String(FIELD_PRICE_UZS),
          priceCurrency: "UZS",
          referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
        },
        eligibleQuantity: { "@type": "QuantitativeValue", minValue: MIN_FIELD_USERS },
      },
    },
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: meta.title[lang],
      description: meta.description[lang],
      inLanguage: lang,
      isPartOf: { "@id": SITE_ID },
      about: { "@id": APP_ID },
      ...(page.kind === "article" ? { breadcrumb: { "@id": `${url}#breadcrumb` } } : {}),
    },
  ];
  if (page.key === "home") graph.push(faqPage(url, lang, FAQ_ITEMS));
  if (page.kind === "article") {
    const key = page.key as ArticleKey;
    const text = ARTICLE_TEXTS[key];
    const homeUrl = absoluteUrl(sitePath(lang, "/"));
    graph.push(
      {
        "@type": "Article",
        "@id": `${url}#article`,
        headline: text.h1[lang],
        description: meta.description[lang],
        inLanguage: lang,
        image: absoluteUrl(ogImagePath(page.key, lang)),
        datePublished: ARTICLES[key].published,
        dateModified: page.lastmod,
        author: { "@id": ORG_ID },
        publisher: { "@id": ORG_ID },
        mainEntityOfPage: { "@id": `${url}#webpage` },
        about: { "@id": APP_ID },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: uz ? "Bosh sahifa" : "Главная", item: homeUrl },
          { "@type": "ListItem", position: 2, name: ARTICLES[key].nav[lang], item: url },
        ],
      },
      faqPage(url, lang, text.faq),
    );
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

/**
 * Содержимое <head> страницы сайта на языке: заголовок, описание, canonical,
 * hreflang, карточка ссылки (og и twitter), разметка schema.org и метка
 * wp-site — по ней вход браузера (src/main.tsx) узнаёт готовую страницу.
 */
export function siteHead(page: SitePage, lang: SiteLang): string {
  const meta = PAGE_META[page.key];
  const url = absoluteUrl(page.paths[lang]!);
  const title = meta.title[lang];
  const description = meta.description[lang];
  const image = absoluteUrl(ogImagePath(page.key, lang));
  const other = pageLangs(page).filter(l => l !== lang);
  const lines = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    ...alternatesOf(page).map(a => `<link rel="alternate" hreflang="${a.hreflang}" href="${esc(a.href)}" />`),
    `<meta property="og:type" content="${page.kind === "article" ? "article" : "website"}" />`,
    `<meta property="og:site_name" content="Warehouse Pro" />`,
    `<meta property="og:locale" content="${OG_LOCALE[lang]}" />`,
    ...other.map(l => `<meta property="og:locale:alternate" content="${OG_LOCALE[l]}" />`),
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:image:type" content="image/jpeg" />`,
    `<meta property="og:image:width" content="${OG_WIDTH}" />`,
    `<meta property="og:image:height" content="${OG_HEIGHT}" />`,
    `<meta property="og:image:alt" content="${esc(meta.imageAlt[lang])}" />`,
    ...(page.kind === "article" ? [
      `<meta property="article:published_time" content="${ARTICLES[page.key as ArticleKey].published}" />`,
      `<meta property="article:modified_time" content="${page.lastmod}" />`,
    ] : []),
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
    `<meta name="twitter:image:alt" content="${esc(meta.imageAlt[lang])}" />`,
    `<meta name="wp-site" content="${page.key}" />`,
    `<script type="application/ld+json">${jsonForScript(structuredData(page, lang))}</script>`,
  ];
  return lines.join("\n    ");
}

/** <head> страницы «не найдено»: двуязычная, в поиск не идёт. */
export function notFoundHead(): string {
  return [
    `<title>${esc(NOT_FOUND_META.title)}</title>`,
    `<meta name="description" content="${esc(NOT_FOUND_META.description)}" />`,
    `<meta name="robots" content="noindex" />`,
  ].join("\n    ");
}
