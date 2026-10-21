import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import { LogoMark } from "@/components/brand/Logo";
import LeadForm from "@/components/landing/LeadForm";
import { useLang, useTranslate } from "@/i18n";
import { ArrowRight, Send } from "lucide-react";

import { LandingStyles, Accordion, SectionHead, BtnInk, BtnGhost } from "@/components/landing/landing-shared";
import { LX, MONO, tgLink, CONTACT } from "@/components/landing/landing-tokens";
import LandingHeader from "@/components/landing/LandingHeader";
import TallyField from "@/components/landing/TallyField";
import AudienceSection from "@/components/landing/AudienceSection";
import { startLandingMotion } from "@/lib/landing-motion";
import { captureAttribution, withAttribution } from "@/lib/attribution";
import { useSiteLinkClick } from "@/components/landing/use-site-link";
import HeroSection from "@/components/landing/HeroSection";
import { CTA_PHOTO } from "@/components/landing/PhotoStrip";
import OrdersSection from "@/components/landing/OrdersSection";
import StoryScroll from "@/components/landing/StoryScroll";
import FilmScroll from "@/components/landing/FilmScroll";
import WarehouseSection from "@/components/landing/WarehouseSection";
import MoneySection from "@/components/landing/MoneySection";
import SetupSection from "@/components/landing/SetupSection";
import MobileShowcase from "@/components/landing/MobileShowcase";
import ManualSection from "@/components/landing/ManualSection";
import ProductWindow from "@/components/landing/ProductWindow";
import LossSection from "@/components/landing/LossSection";
import FeaturesSection from "@/components/landing/FeaturesSection";
import PromisesSection from "@/components/landing/PromisesSection";
import PricingSection from "@/components/landing/PricingSection";
import StartSection from "@/components/landing/StartSection";
import { FAQ_ITEMS } from "@/components/landing/site-content";
import { ARTICLES } from "@/site/articles/registry";
import { ARTICLE_KEYS, sitePage } from "@contracts/site-pages";
import { appPath, sitePath } from "@/lib/site-paths";

/* ═══════════════════════════════════════════════════════════════════════════
   ЛЕНДИНГ «СКЛАДСКАЯ КНИГА»

   Композиция страницы и правила дизайн-системы — в landing-shared.tsx.
   Порядок: шапка → hero → для кого → архивные фото → окно продукта (чернила №1) →
   полоса фактов → день с продуктом → реестр возможностей → GPS → роли →
   отзывы → обещания → тарифы → как начать → FAQ → CTA (чернила №2) → футер.
   Якоря сохранены.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── 01 / Полоса фактов ────────────────────────────────────────────────────
   Стоит на месте trust-bar, поэтому без счётчиков функций и без обещаний
   уровня «99.9% uptime», которые нечем подтвердить. Только то, что можно
   проверить в продукте за 14 бесплатных дней. */
function FactsStrip() {
  const tr = useTranslate();
  /*
    Ни одного выдуманного числа. Прежнее «40+ дистрибьюторов» было ложью —
    организаций в базе тринадцать. Теперь каждая цифра берётся из боевой
    базы (2 сентября 2026) или из тарифа и подписана так, чтобы её можно
    было проверить.
  */
  const facts: Array<{ value: number; suffix?: string; label: string }> = [
    { value: 13, label: tr("компаний ведут учёт в системе", "kompaniya tizimda hisob yuritadi") },
    { value: 3358, label: tr("торговых точек в базе", "bazadagi savdo nuqtalari") },
    { value: 1121, label: tr("заказов проведено за последние 30 дней", "so'nggi 30 kunda o'tkazilgan buyurtmalar") },
    { value: 14, label: tr("дней бесплатно — карта не привязывается", "kun bepul — karta bog'lanmaydi") },
  ];
  return (
    <section style={{ background: LX.verso, borderTop: `1px solid ${LX.ruleStrong}`, borderBottom: `1px solid ${LX.ruleStrong}` }}>
      <div className="max-w-[1240px] mx-auto px-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px" style={{ background: LX.ruleStrong }}>
          {facts.map((f, i) => (
            <div key={i} data-reveal="fact" className="py-8 md:py-10 px-4 md:px-8" style={{ background: LX.verso }}>
              <div className="text-[32px] md:text-[40px] leading-none" style={{ ...MONO, letterSpacing: "-0.02em", color: LX.ink }}>
                <span data-count={f.value}>{f.value.toLocaleString("ru-RU")}</span>{f.suffix ?? ""}
              </div>
              <p className="mt-3 text-[15px] leading-snug max-w-[220px] font-medium" style={{ color: LX.inkSoft }}>
                {f.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── 08 / FAQ — реальные возражения, а не декоративные вопросы ───────────── */
function FaqSection() {
  const tr = useTranslate();
  // Вопросы и ответы — в site-content (одним источником слов сайта).
  const items = useMemo(() => FAQ_ITEMS.map(x => ({ q: tr(x.q.ru, x.q.uz), a: tr(x.a.ru, x.a.uz) })), [tr]);
  return (
    <section className="py-16 md:py-24" style={{ borderTop: `1px solid ${LX.rule}` }}>
      <div className="max-w-[1240px] mx-auto px-6 lg:pl-[136px]">
        <div className="max-w-[880px]">
        <SectionHead
          id="faq"
          index="15"
          label="FAQ"
          title={tr("Вопросы, которые задают до покупки", "Sotib olishdan oldin beriladigan savollar")}
        />
        <div className="mt-10"><Accordion items={items} /></div>
        </div>
      </div>
    </section>
  );
}

/* ── Чернильная зона №2: финальный CTA ───────────────────────────────────── */
function CtaSection() {
  const tr = useTranslate();
  const { lang } = useLang();
  const tg = tgLink(tr("Здравствуйте! Хочу подключить Warehouse Pro.", "Assalomu alaykum! Warehouse Pro'ni ulamoqchiman."));
  return (
    <section className="lx-ink relative overflow-hidden" style={{ background: LX.night, borderTop: `1px solid ${LX.brassOnNight}` }}>
      <img
        src={CTA_PHOTO}
        alt=""
        aria-hidden="true"
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover"
        style={{ opacity: 0.16, filter: "grayscale(0.6) sepia(0.3)" }}
      />
      <div className="relative max-w-[1240px] mx-auto px-6 py-20 md:py-28 lg:pl-[136px]">
        <p data-reveal="cta" className="text-[12px] uppercase mb-6" style={{ ...MONO, fontWeight: 500, color: LX.brassOnNight, letterSpacing: "0.08em" }}>
          {/* Номер — следующий за последней главой (15 · FAQ): это та же лента. */}
          16 · {tr("Последняя строка реестра", "Reyestrning oxirgi qatori")}
        </p>
        <h2
          data-reveal="cta"
          className="font-extrabold max-w-3xl"
          style={{ fontSize: "clamp(2.1rem, 4.6vw, 3.6rem)", letterSpacing: "-0.035em", lineHeight: 1.05, color: LX.paperOnInk }}
        >
          {tr("Наведите порядок на складе за 14 дней", "14 kunda omboringizni tartibga keltiring")}
        </h2>
        <p data-reveal="cta" className="mt-5 text-[18px] max-w-md" style={{ color: LX.softOnInk }}>
          {tr("Бесплатно, без привязки карты. Настройка — 10 минут.", "Bepul, karta bog'lamasdan. Sozlash — 10 daqiqa.")}
        </p>
        <div data-reveal="cta" className="mt-9 flex flex-wrap items-center gap-3">
          <BtnInk onPaper={false} href={withAttribution(appPath(lang, "/register"))}>
            {tr("Начать бесплатно", "Bepul boshlash")}
            <ArrowRight size={15} />
          </BtnInk>
          {tg && (
            <BtnGhost onPaper={false} href={tg}>
              <Send size={14} />
              {tr("Написать в Telegram", "Telegramda yozish")}
            </BtnGhost>
          )}
        </div>

        {/* Второй путь для тех, кто регистрироваться сам не станет. */}
        <div
          data-reveal="cta"
          className="mt-12 max-w-lg text-left rounded-lg p-6 md:p-8"
          style={{ background: LX.ink, border: `1px solid ${LX.ruleOnInk}` }}
        >
          <p className="text-[15px] mb-3" style={{ color: LX.softOnInk }}>
            {tr("Или оставьте номер — перезвоним и разберём ваш случай.",
                "Yoki raqamingizni qoldiring — qo'ng'iroq qilib, holatingizni ko'rib chiqamiz.")}
          </p>
          <LeadForm onInk source="cta" />
        </div>
      </div>
    </section>
  );
}

/* ── Футер ────────────────────────────────────────────────────────────────── */
function Footer() {
  const tr = useTranslate();
  const { lang } = useLang();
  const siteClick = useSiteLinkClick();
  const cols = [
    { label: tr("Продукт", "Mahsulot"), href: "#features" },
    { label: tr("Как работает", "Qanday ishlaydi"), href: "#how" },
    { label: tr("Роли", "Rollar"), href: "#roles" },
    { label: tr("Цены", "Narxlar"), href: "#pricing" },
    // Сравнение с Sales Doctor и Smartup — отдельная страница сайта, на
    // языке этой: с /uz — /uz/compare (был /compare — по-русски и с
    // перезагрузкой, а на /uz/compare не вела ни одна ссылка).
    { label: tr("Сравнение", "Taqqoslash"), href: sitePath(lang, "/compare") },
  ];
  return (
    <footer className="py-12" style={{ borderTop: `1px solid ${LX.rule}` }}>
      <div className="max-w-[1240px] mx-auto px-6">
        {/* Последний лист реестра: та же метка, что открывала первый экран. */}
        <div className="mb-8 flex flex-wrap gap-x-6 text-[12px] uppercase" style={{ ...MONO, fontWeight: 500, letterSpacing: "0.08em", lineHeight: 1.9 }}>
          <span style={{ color: LX.brassText }}>{tr("Лист 01 из 01", "Varaq 01 / 01")}</span>
          <span style={{ color: LX.inkFaint }}>{tr("Реестр WP-2026", "Reyestr WP-2026")}</span>
          <span style={{ color: LX.inkFaint }}>{tr("Сходится вечером", "Kechqurun to'g'ri keladi")}</span>
        </div>
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-8">
          <div className="max-w-xs">
            <div className="flex items-center gap-2.5 mb-4">
              <LogoMark size={28} decorative />
              <span className="font-bold text-[14px]" style={{ color: LX.ink }}>Warehouse Pro</span>
            </div>
            <p className="text-[15px] leading-relaxed" style={{ color: LX.inkSoft }}>
              {tr(
                "Система учёта склада, заказов и доставки для дистрибьюторов Узбекистана.",
                "O'zbekiston distribyutorlari uchun ombor, buyurtma va yetkazish hisobi tizimi.",
              )}
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-8 gap-y-3">
            {cols.map(c => (
              <a key={c.href} href={c.href} onClick={siteClick} className="text-[13.5px] hover:underline underline-offset-4" style={{ color: LX.inkSoft }}>
                {c.label}
              </a>
            ))}
          </nav>
        </div>
        {/*
          Статьи — по одной на задачу, которую дистрибьютор ищет словами
          («учёт долгов магазинов», «акт сверки»). Ссылка — на статью на языке
          этой страницы; переход — без перезагрузки.
        */}
        <nav aria-label={tr("Статьи", "Maqolalar")} className="mt-8 flex flex-col md:flex-row md:items-baseline gap-x-8 gap-y-3" data-testid="footer-articles">
          <span className="text-[12px] uppercase" style={{ ...MONO, letterSpacing: "0.08em", color: LX.brassText }}>{tr("Статьи", "Maqolalar")}</span>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {ARTICLE_KEYS.map(k => (
              <a
                key={k}
                href={sitePath(lang, sitePage(k).paths.ru)}
                onClick={siteClick}
                className="text-[13.5px] hover:underline underline-offset-4"
                style={{ color: LX.inkSoft }}
              >
                {ARTICLES[k].nav[lang]}
              </a>
            ))}
          </div>
        </nav>
        <div
          className="mt-10 pt-6 flex flex-col md:flex-row justify-between gap-3 text-[12px]"
          style={{ ...MONO, color: LX.inkFaint, borderTop: `1px solid ${LX.rule}` }}
        >
          <span>© 2026 Warehouse Pro · {tr("Все права защищены", "Barcha huquqlar himoyalangan")}</span>
          {/*
            Ссылка на политику — в подвале, а не спрятана.

            Её требуют оба магазина приложений, и проверяющий ищет её именно
            здесь. Но важнее другое: приложение записывает, где находится
            человек на работе, и документ об этом должен находиться без
            подсказки.
          */}
          <a href="/privacy" style={{ color: "inherit" }}>
            {tr("Политика конфиденциальности", "Maxfiylik siyosati")}
          </a>
          {CONTACT.email && (
            <a href={`mailto:${CONTACT.email}`} data-testid="footer-support-email" style={{ color: "inherit" }}>
              {tr("Поддержка", "Yordam")}: {CONTACT.email}
            </a>
          )}
          <span>{tr("Ургенч, Хорезм, Узбекистан", "Urganch, Xorazm, O'zbekiston")}</span>
        </div>
      </div>
    </footer>
  );
}

/* ── Мобильная закреплённая CTA ───────────────────────────────────────────
   Директор почти наверняка смотрит с телефона, а до финальной CTA десяток
   экранов. Панель появляется после первого экрана и не перекрывает hero. */
function MobileCtaBar() {
  const tr = useTranslate();
  const { lang } = useLang();
  const siteClick = useSiteLinkClick();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const h = () => setShown(window.scrollY > 640);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);
  const tg = tgLink(tr("Здравствуйте! Интересует Warehouse Pro.", "Assalomu alaykum! Warehouse Pro bo'yicha ma'lumot olmoqchiman."));
  return (
    <div
      // Уехавшая за экран панель остаётся в порядке обхода табом, и, будучи
      // fixed, доскроллиться до неё браузер не может: фокус пропадал совсем.
      inert={!shown}
      className="md:hidden fixed bottom-0 inset-x-0 z-40 transition-transform duration-300 lx-anim"
      style={{
        transform: shown ? "none" : "translateY(110%)",
        background: "rgba(38,35,30,0.97)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div className="px-4 py-3 flex gap-2.5">
        <a
          href={withAttribution(appPath(lang, "/register"))}
          onClick={siteClick}
          data-testid="mobile-cta-register"
          className="flex-1 h-11 inline-flex items-center justify-center rounded-[9px] text-[14px] font-semibold cursor-pointer"
          style={{ background: LX.paper, color: LX.ink }}
        >
          {tr("Начать бесплатно", "Bepul boshlash")}
        </a>
        {tg && (
          <a
            href={tg}
            target="_blank"
            rel="noreferrer"
            aria-label="Telegram"
            className="w-11 h-11 rounded-[9px] flex items-center justify-center"
            style={{ border: `1px solid ${LX.ruleOnInk}`, color: LX.paperOnInk }}
          >
            <Send size={16} />
          </a>
        )}
      </div>
    </div>
  );
}

export default function Landing() {
  const root = useRef<HTMLDivElement>(null);
  // Метки рекламы из адреса (/?utm_source=ig) — до отрисовки детей: ссылки
  // «Начать» берут их в свой адрес уже в первом кадре (lib/attribution).
  const { search } = useLocation();
  useState(() => captureAttribution(search));

  // Движение включается один раз на всю страницу: сценарий сам находит, что
  // оживлять, по атрибутам в разметке. Уборка обязательна — наблюдатели
  // пересечений и повтор дыхания иначе переживут уход со страницы.
  useEffect(() => startLandingMotion(root.current), []);

  return (
    <div
      ref={root}
      id="top"
      className="lx-root min-h-screen overflow-x-clip pb-16 md:pb-0"
      style={{ background: LX.paper, color: LX.ink, fontFamily: "'Manrope', system-ui, sans-serif" }}
    >
      <LandingStyles />
      <LandingHeader />
      {/*
        Такты страницы: светло → светло во всю ширину (поле ячеек) → НОЧЬ с
        чернильной панелью внутри (потери + окно продукта) → оборот (факты,
        ведомость) → светло (день, GPS) → фото во всю ширину → светло (тарифы)
        → светло-узко (FAQ) → НОЧЬ (замок). Тёмных зон две, третий регистр
        взят бумагой, а не краской.
      */}
      <HeroSection />
      <TallyField />
      {/* Сразу за первым экраном — для кого программа и кому не подойдёт: человек узнаёт себя раньше, чем начнёт читать про функции. */}
      <AudienceSection />
      <LossSection />
      {/* Плёнка без номера: склад на рассвете кадр за кадром по прокрутке — внутри той же ночной полосы. */}
      <FilmScroll />
      <ProductWindow />
      <FactsStrip />
      <FeaturesSection />
      {/*
        Главы о сильных сторонах — по слову владельца: «лендинг очень мало
        информации». Порядок повторяет путь товара и денег: заказы → склад →
        деньги → настройки, потом телефон, потом справка, потом цена.
      */}
      {/* Интерлюдия без номера: плёнка «от заказа до денег» — обзор перед главами 06–09. */}
      <StoryScroll />
      <OrdersSection />
      <WarehouseSection />
      <MoneySection />
      <SetupSection />
      <MobileShowcase />
      <ManualSection />
      {/* Перед ценой — что программа делает всегда и как это проверить за пробные дни. */}
      <PromisesSection />
      <PricingSection />
      {/* За ценой — что будет, если нажать: шаги со временем и пилот для крупных. */}
      <StartSection />
      <FaqSection />
      <CtaSection />
      <Footer />
      <MobileCtaBar />
    </div>
  );
}
