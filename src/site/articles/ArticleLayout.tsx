import { useCallback, useState, type MouseEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { ArrowRight } from "lucide-react";
import { LogoMark } from "@/components/brand/Logo";
import { UrlLang, useLang, type Lang } from "@/i18n";
import { LandingStyles } from "@/components/landing/landing-shared";
import { CONTACT, LX, MONO } from "@/components/landing/landing-tokens";
import { useSiteLinkClick } from "@/components/landing/use-site-link";
import { MOBILE_ASPECT, WEB_CONTENT_ASPECT, mobileShot, webContent } from "@/components/landing/shots";
import { PRICE_LINE } from "@/components/landing/price-line";
import { captureAttribution, withAttribution } from "@/lib/attribution";
import { appPath, langOfPath, sitePath } from "@/lib/site-paths";
import { formatDay } from "@contracts/pricing";
import { ARTICLE_KEYS, sitePage, type SiteLang } from "@contracts/site-pages";
import { ARTICLES } from "./registry";
import type { ArticleBlock, ArticleShot, ArticleText, L } from "./types";

/* ═══════════════════════════════════════════════════════════════════════════
   Раскладка статьи сайта: шапка, хлебные крошки, текст, FAQ, призыв и
   соседние статьи.

   ── Язык — из адреса ───────────────────────────────────────────────────────

   /shop-debts — всегда по-русски, /uz/shop-debts — всегда по-узбекски, у
   любого человека и робота: статья — это текст на одном языке, и у каждого
   языка свой адрес в поиске. Сохранённый выбор языка адрес не перебивает,
   а заход по ссылке выбором не считается (UrlLang). Переключатель «Ру / Uz» —
   настоящая ссылка на парную статью: её видит робот, её можно открыть в
   новой вкладке; обычное нажатие сохраняет выбор и уходит туда же без
   перезагрузки.

   ── Вид ────────────────────────────────────────────────────────────────────

   Бумага и чернила лендинга (landing-tokens) — ни одного нового цвета.
   Текст — 17px; всё, что читают подряд (абзацы, списки, подписи к снимкам,
   крошки, FAQ, «Ещё по теме»), — не мельче 16px: статью читают с телефона.
   Служебные метки — рубрика над заголовком, номера оглавления, «Ру / Uz»,
   кнопки шапки — 13–14px: их узнают взглядом, как табличку, и для них
   действует общее правило сайта — не мельче 12px (landing-min-font).
   Одна чернильная зона — призыв в конце, как у лендинга.
   ═══════════════════════════════════════════════════════════════════════════ */

const UI = {
  kicker: { ru: "Статья", uz: "Maqola" },
  updated: { ru: "обновлено", uz: "yangilangan" },
  home: { ru: "Главная", uz: "Bosh sahifa" },
  crumbs: { ru: "Хлебные крошки", uz: "Navigatsiya yo'li" },
  toc: { ru: "Содержание", uz: "Mundarija" },
  faq: { ru: "Частые вопросы", uz: "Ko'p beriladigan savollar" },
  login: { ru: "Войти", uz: "Kirish" },
  start: { ru: "Начать", uz: "Boshlash" },
  langOther: { ru: "O'zbekcha", uz: "По-русски" },
  ctaTitle: { ru: "Проверьте на своих магазинах", uz: "O'z do'konlaringizda sinab ko'ring" },
  ctaStart: { ru: "Начать бесплатно", uz: "Bepul boshlash" },
  ctaDemo: { ru: "Демо без регистрации", uz: "Ro'yxatdan o'tmasdan demo" },
  more: { ru: "Ещё по теме", uz: "Mavzuga oid" },
  compare: { ru: "Сравнение", uz: "Taqqoslash" },
  privacy: { ru: "Политика конфиденциальности", uz: "Maxfiylik siyosati" },
  support: { ru: "Поддержка", uz: "Yordam" },
  rights: { ru: "Все права защищены", uz: "Barcha huquqlar himoyalangan" },
} satisfies Record<string, L>;

/** Стили статьи — классы wa-, только токены лендинга. */
function ArticleStyles() {
  return (
    <style>{`
      .wa-body { font-size: 17px; line-height: 1.7; }
      .wa-body h1 { font-size: clamp(30px, 6.4vw, 46px); line-height: 1.12; letter-spacing: -0.025em; font-weight: 800; margin: 14px 0 22px; }
      .wa-body h2 { font-size: clamp(24px, 4.6vw, 30px); line-height: 1.22; letter-spacing: -0.015em; font-weight: 800; margin: 52px 0 16px; scroll-margin-top: 24px; }
      .wa-body h3 { font-size: 18px; line-height: 1.4; font-weight: 700; margin: 0 0 6px; }
      .wa-body p { margin: 0 0 16px; }
      .wa-lead { font-size: 19px; line-height: 1.65; color: ${LX.inkSoft}; }
      .wa-body ol, .wa-body ul { margin: 0 0 18px; padding-left: 26px; }
      .wa-body li { margin: 0 0 10px; padding-left: 4px; }
      .wa-body ol li::marker { font-family: 'JetBrains Mono', ui-monospace, monospace; color: ${LX.brassText}; font-weight: 600; }
      .wa-body ul li::marker { color: ${LX.brass}; }
      .wa-crumbs ol { display: flex; flex-wrap: wrap; gap: 4px 10px; list-style: none; padding: 0; margin: 0; font-size: 16px; }
      .wa-crumbs li + li::before { content: "›"; color: ${LX.inkFaint}; margin-right: 10px; }
      .wa-crumbs a { color: ${LX.inkSoft}; text-decoration: underline; text-underline-offset: 4px; text-decoration-color: ${LX.ruleStrong}; }
      .wa-toc { border-top: 1px solid ${LX.rule}; border-bottom: 1px solid ${LX.rule}; padding: 18px 0 8px; margin: 28px 0 8px; }
      .wa-toc ol { list-style: none; padding: 0; margin: 0; counter-reset: wa; }
      .wa-toc li { counter-increment: wa; padding: 0; margin: 0 0 10px; }
      .wa-toc li::before { content: counter(wa, decimal-leading-zero); font-family: 'JetBrains Mono', ui-monospace, monospace; color: ${LX.brassText}; font-size: 14px; margin-right: 12px; }
      .wa-toc a, .wa-see a, .wa-related a { color: ${LX.ink}; text-decoration: underline; text-underline-offset: 4px; text-decoration-color: ${LX.ruleStrong}; }
      .wa-toc a:hover, .wa-see a:hover, .wa-related a:hover, .wa-crumbs a:hover { text-decoration-color: ${LX.brass}; }
      .wa-shot { margin: 28px 0 30px; }
      .wa-shot img { display: block; height: auto; background: ${LX.paperRaised}; border: 1px solid ${LX.rule}; }
      .wa-shot-phone img { width: min(100%, 300px); margin: 0 auto; border-radius: 28px; }
      .wa-shot-web img { width: 100%; border-radius: 12px; }
      .wa-shot figcaption { font-size: 16px; line-height: 1.55; color: ${LX.inkSoft}; margin-top: 12px; text-align: center; }
      .wa-note { background: ${LX.paperRaised}; border-left: 3px solid ${LX.brass}; padding: 18px 20px 4px; margin: 26px 0; border-radius: 0 10px 10px 0; }
      .wa-note-title { font-weight: 700; }
      .wa-see { font-weight: 600; }
      .wa-faq { border-top: 1px solid ${LX.rule}; padding: 20px 0 6px; }
      .wa-faq p { color: ${LX.inkSoft}; }
      .wa-related li { margin: 0 0 14px; }
      .wa-related p { margin: 4px 0 0; color: ${LX.inkSoft}; font-size: 16px; line-height: 1.55; }
      .wa-brand-name { display: inline; }
      @media (max-width: 379px) { .wa-brand-name { display: none; } }
    `}</style>
  );
}

export default function ArticleLayout({ article }: { article: ArticleText }) {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const lang = langOfPath(pathname);
  const page = sitePage(article.key);
  // Метки рекламы (/shop-debts?utm_source=tg) — до отрисовки ссылок «Начать»:
  // они берут метки в свой адрес уже в первом кадре (lib/attribution).
  useState(() => captureAttribution(search));
  // Нажатие на «Ру / Uz» — выбор: UrlLang сохраняет его и зовёт сюда, а
  // отсюда — на ту же статью на другом языке, с теми же метками в адресе.
  const onSwitch = useCallback(
    (l: Lang) => navigate((page.paths[l] ?? page.paths.ru) + search + hash),
    [navigate, page, search, hash],
  );
  return (
    <UrlLang lang={lang} onSwitch={onSwitch}>
      <ArticlePage article={article} lang={lang} />
    </UrlLang>
  );
}

function ArticlePage({ article, lang }: { article: ArticleText; lang: SiteLang }) {
  const siteClick = useSiteLinkClick();
  const page = sitePage(article.key);
  const meta = ARTICLES[article.key];
  const home = sitePath(lang, "/");
  return (
    <div
      className="lx-root min-h-screen overflow-x-clip"
      data-article={article.key}
      style={{ background: LX.paper, color: LX.ink, fontFamily: "'Manrope', system-ui, sans-serif" }}
    >
      <LandingStyles />
      <ArticleStyles />
      <ArticleHeader lang={lang} pair={page.paths[lang === "ru" ? "uz" : "ru"] ?? page.paths.ru} />

      <main>
        <article className="wa-body max-w-[760px] mx-auto px-4 sm:px-6 pt-8 pb-16">
          <nav aria-label={UI.crumbs[lang]} className="wa-crumbs">
            <ol>
              <li><a href={home} onClick={siteClick}>{UI.home[lang]}</a></li>
              <li aria-current="page">{meta.nav[lang]}</li>
            </ol>
          </nav>

          <p className="text-[13px] uppercase" style={{ ...MONO, letterSpacing: "0.1em", color: LX.brassText, margin: "28px 0 0" }}>
            {UI.kicker[lang]} · {UI.updated[lang]} <time dateTime={page.lastmod}>{formatDay(page.lastmod)}</time>
          </p>
          <h1>{article.h1[lang]}</h1>
          {article.lead.map((p, i) => <p key={i} className="wa-lead">{p[lang]}</p>)}

          <nav aria-label={UI.toc[lang]} className="wa-toc">
            <ol>
              {article.sections.map(s => <li key={s.id}><a href={`#${s.id}`}>{s.h2[lang]}</a></li>)}
              <li><a href="#faq">{UI.faq[lang]}</a></li>
            </ol>
          </nav>

          {article.sections.map(s => (
            <section key={s.id} aria-labelledby={s.id}>
              <h2 id={s.id}>{s.h2[lang]}</h2>
              {s.blocks.map((b, i) => <Block key={i} block={b} lang={lang} />)}
            </section>
          ))}

          <section aria-labelledby="faq">
            <h2 id="faq">{UI.faq[lang]}</h2>
            {article.faq.map((x, i) => (
              <div key={i} className="wa-faq">
                <h3>{x.q[lang]}</h3>
                <p>{x.a[lang]}</p>
              </div>
            ))}
          </section>
        </article>

        <ArticleCta lang={lang} />
        <Related current={article} lang={lang} />
      </main>

      <ArticleFooter lang={lang} />
    </div>
  );
}

function ArticleHeader({ lang, pair }: { lang: SiteLang; pair: string }) {
  const siteClick = useSiteLinkClick();
  const { setLang } = useLang();
  const other: SiteLang = lang === "ru" ? "uz" : "ru";
  // Обычное нажатие — выбор языка (сохраняется) и переход без перезагрузки;
  // с Ctrl, Cmd, Shift или колёсиком — как обычная ссылка.
  const switchLang = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setLang(other);
  };
  const chip = "inline-flex items-center justify-center h-[44px] min-w-[44px] px-3 text-[13px] uppercase";
  return (
    <header style={{ borderBottom: `1px solid ${LX.rule}`, paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="max-w-[1240px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        <a href={sitePath(lang, "/")} onClick={siteClick} className="flex items-center gap-2.5 shrink-0" aria-label="Warehouse Pro">
          <LogoMark size={28} decorative />
          <span className="wa-brand-name font-bold tracking-tight text-[15px]" style={{ color: LX.ink }}>Warehouse Pro</span>
        </a>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md overflow-hidden" style={{ border: `1px solid ${LX.ruleStrong}`, ...MONO, letterSpacing: "0.08em" }}>
            {(["ru", "uz"] as const).map(l => l === lang ? (
              <span key={l} aria-current="true" className={chip} style={{ background: LX.ink, color: LX.paperOnInk }}>
                {l === "ru" ? "Ру" : "Uz"}
              </span>
            ) : (
              <a
                key={l}
                href={pair}
                hrefLang={l}
                lang={l}
                aria-label={UI.langOther[lang]}
                onClick={switchLang}
                data-testid="article-lang-switch"
                className={chip}
                style={{ color: LX.inkSoft }}
              >
                {l === "ru" ? "Ру" : "Uz"}
              </a>
            ))}
          </div>
          <a href={appPath(lang, "/login")} onClick={siteClick} className="hidden sm:inline-flex items-center h-10 px-3.5 rounded-md text-[14px] font-medium" style={{ color: LX.ink }}>
            {UI.login[lang]}
          </a>
          <a
            href={withAttribution(appPath(lang, "/register"))}
            onClick={siteClick}
            data-testid="article-header-register"
            className="inline-flex items-center h-[44px] px-4 rounded-[9px] text-[14px] font-semibold"
            style={{ background: LX.ink, color: LX.paperOnInk }}
          >
            {UI.start[lang]}
          </a>
        </div>
      </div>
    </header>
  );
}

function Block({ block, lang }: { block: ArticleBlock; lang: SiteLang }) {
  const siteClick = useSiteLinkClick();
  if ("p" in block) return <p>{block.p[lang]}</p>;
  if ("steps" in block) return <ol>{block.steps.map((s, i) => <li key={i}>{s[lang]}</li>)}</ol>;
  if ("list" in block) return <ul>{block.list.map((s, i) => <li key={i}>{s[lang]}</li>)}</ul>;
  if ("shot" in block) return <Shot shot={block.shot} lang={lang} />;
  if ("note" in block) {
    return (
      <aside className="wa-note">
        <p className="wa-note-title">{block.note.title[lang]}</p>
        <p>{block.note.text[lang]}</p>
      </aside>
    );
  }
  const to = sitePage(block.see).paths;
  return (
    <p className="wa-see">
      <a href={to[lang] ?? to.ru} onClick={siteClick} data-testid={`article-see-${block.see}`}>
        {block.text[lang]}
        <ArrowRight size={16} aria-hidden className="inline-block ml-1.5" style={{ verticalAlign: "-2px" }} />
      </a>
    </p>
  );
}

/** Снимок настоящей программы: размеры заданы заранее — текст под ним не прыгает. */
function Shot({ shot, lang }: { shot: ArticleShot; lang: SiteLang }) {
  const phone = "phone" in shot;
  const src = "phone" in shot ? mobileShot(shot.phone, lang) : webContent(shot.web, lang);
  const [w, h] = (phone ? MOBILE_ASPECT : WEB_CONTENT_ASPECT).split(" / ").map(Number);
  return (
    <figure className={`wa-shot ${phone ? "wa-shot-phone" : "wa-shot-web"}`}>
      <img src={src} alt={shot.alt[lang]} width={w} height={h} loading="lazy" decoding="async" />
      <figcaption>{shot.caption[lang]}</figcaption>
    </figure>
  );
}

function ArticleCta({ lang }: { lang: SiteLang }) {
  const siteClick = useSiteLinkClick();
  const btn = "inline-flex items-center justify-center gap-2 h-12 px-6 rounded-[10px] text-[15px] font-semibold";
  return (
    <section className="lx-ink" aria-labelledby="cta-h" style={{ background: LX.ink, color: LX.paperOnInk }}>
      <div className="max-w-[760px] mx-auto px-4 sm:px-6 py-14">
        <h2 id="cta-h" className="font-extrabold" style={{ fontSize: "clamp(26px, 5vw, 34px)", lineHeight: 1.2, letterSpacing: "-0.02em", margin: 0 }}>
          {UI.ctaTitle[lang]}
        </h2>
        <p className="text-[17px]" style={{ lineHeight: 1.65, color: LX.softOnInk, margin: "14px 0 26px" }}>{PRICE_LINE[lang]}</p>
        <div className="flex flex-wrap gap-3">
          <a href={withAttribution(appPath(lang, "/register"))} onClick={siteClick} data-testid="article-cta-register" className={btn} style={{ background: LX.paper, color: LX.ink }}>
            {UI.ctaStart[lang]}
            <ArrowRight size={16} aria-hidden />
          </a>
          <a href={`/demo?lang=${lang}`} onClick={siteClick} data-testid="article-cta-demo" className={btn} style={{ border: `1px solid ${LX.ruleOnInk}`, color: LX.paperOnInk }}>
            {UI.ctaDemo[lang]}
          </a>
        </div>
      </div>
    </section>
  );
}

/** Остальные статьи — ссылками со словами, о чём они. */
function Related({ current, lang }: { current: ArticleText; lang: SiteLang }) {
  const siteClick = useSiteLinkClick();
  return (
    <nav aria-labelledby="related-h" className="wa-related max-w-[760px] mx-auto px-4 sm:px-6 py-14">
      <h2 id="related-h" className="font-extrabold" style={{ fontSize: "clamp(22px, 4vw, 26px)", margin: "0 0 20px" }}>{UI.more[lang]}</h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {ARTICLE_KEYS.filter(k => k !== current.key).map(k => {
          const to = sitePage(k).paths;
          return (
            <li key={k}>
              <a href={to[lang] ?? to.ru} onClick={siteClick} className="text-[18px] font-semibold" data-testid={`article-related-${k}`}>
                {ARTICLES[k].nav[lang]}
              </a>
              <p>{ARTICLES[k].description[lang]}</p>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  const siteClick = useSiteLinkClick();
  return <a href={href} onClick={siteClick} style={{ color: "inherit" }}>{children}</a>;
}

function ArticleFooter({ lang }: { lang: SiteLang }) {
  return (
    <footer style={{ borderTop: `1px solid ${LX.rule}` }}>
      <div
        className="max-w-[1240px] mx-auto px-4 sm:px-6 py-8 flex flex-wrap gap-x-6 gap-y-3 text-[14px]"
        style={{ ...MONO, color: LX.inkFaint }}
      >
        <span>© 2026 Warehouse Pro · {UI.rights[lang]}</span>
        <FooterLink href={sitePath(lang, "/")}>{UI.home[lang]}</FooterLink>
        <FooterLink href={sitePath(lang, "/compare")}>{UI.compare[lang]}</FooterLink>
        {/* Политика — русский документ, у неё один адрес. */}
        <FooterLink href="/privacy">{UI.privacy[lang]}</FooterLink>
        {CONTACT.email && <a href={`mailto:${CONTACT.email}`} style={{ color: "inherit" }}>{UI.support[lang]}: {CONTACT.email}</a>}
      </div>
    </footer>
  );
}
