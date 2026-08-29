import { useEffect, useMemo, useState } from "react";
import { LogoMark } from "@/components/brand/Logo";
import LeadForm from "@/components/landing/LeadForm";
import { useNavigate } from "react-router";
import { useTranslate } from "@/i18n";
import { ArrowRight, Send } from "lucide-react";

import { LandingStyles, Counter, Accordion, SectionHead, BtnInk, BtnGhost } from "@/components/landing/landing-shared";
import { LX, MONO, tgLink } from "@/components/landing/landing-tokens";
import LandingHeader from "@/components/landing/LandingHeader";
import HeroSection from "@/components/landing/HeroSection";
import PhotoStrip, { CTA_PHOTO } from "@/components/landing/PhotoStrip";
import ProductWindow from "@/components/landing/ProductWindow";
import LossSection from "@/components/landing/LossSection";
import FeaturesSection from "@/components/landing/FeaturesSection";
import PricingSection from "@/components/landing/PricingSection";

/* ═══════════════════════════════════════════════════════════════════════════
   ЛЕНДИНГ «СКЛАДСКАЯ КНИГА»

   Композиция страницы и правила дизайн-системы — в landing-shared.tsx.
   Порядок: шапка → hero → архивные фото → окно продукта (чернила №1) →
   полоса фактов → день с продуктом → реестр возможностей → GPS → роли →
   отзывы → тарифы → FAQ → CTA (чернила №2) → футер. Якоря сохранены.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── 01 / Полоса фактов ────────────────────────────────────────────────────
   Стоит на месте trust-bar, поэтому без счётчиков функций и без обещаний
   уровня «99.9% uptime», которые нечем подтвердить. Только то, что можно
   проверить в продукте за 14 бесплатных дней. */
function FactsStrip() {
  const tr = useTranslate();
  const facts = [
    {
      big: <><Counter target={40} />+</>,
      label: tr("дистрибьюторов ведут учёт в системе", "distribyutor tizimda hisob yuritadi"),
    },
    { big: "1С", label: tr("двусторонний обмен: товары, заказы, контрагенты", "ikki tomonlama almashinuv: tovar, buyurtma, kontragent") },
    { big: <span style={MONO}>24/7</span>, label: tr("офлайн-режим: заказы не теряются без связи", "oflayn rejim: aloqasiz buyurtma yo'qolmaydi") },
    { big: <span style={MONO}>14</span>, label: tr("дней бесплатно — карта не привязывается", "kun bepul — karta bog'lanmaydi") },
  ];
  return (
    <section style={{ borderBottom: `1px solid ${LX.rule}` }}>
      <div className="max-w-[1240px] mx-auto px-6">
        {/*
          Разделители через зазор сетки, а не border-left по индексу: на
          двухколоночном мобильном третья ячейка открывает второй ряд и
          получала линию у самого края, ни от чего не отделяя.
        */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px" style={{ background: LX.rule }}>
          {facts.map((f, i) => (
            <div
              key={i}
              className="py-8 md:py-10 px-4 md:px-8"
              style={{ background: LX.paper }}
            >
              <div className="font-bold" style={{ fontSize: "clamp(2rem, 3.4vw, 3rem)", letterSpacing: "-0.02em", color: LX.ink }}>
                {f.big}
              </div>
              <p className="mt-2 text-[12.5px] leading-snug max-w-[220px]" style={{ color: LX.inkSoft }}>
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
  const items = useMemo(
    () => [
      {
        q: tr("Работает ли обмен с 1С:Предприятие?", "1C:Predpriyatiye bilan almashinuv ishlaydimi?"),
        a: tr(
          "Да, двусторонний: товары, заказы, остатки и контрагенты синхронизируются автоматически. При подключении помогаем настроить обмен бесплатно.",
          "Ha, ikki tomonlama: tovarlar, buyurtmalar, qoldiqlar va kontragentlar avtomatik sinxronlanadi. Ulanishda almashinuvni bepul sozlab beramiz.",
        ),
      },
      {
        q: tr("Агенты не дружат с программами — справятся?", "Agentlar dastur bilan chiqisha olmaydi — uddalay oladimi?"),
        a: tr(
          // Без обещания переноса данных всем: это фича тарифа Exclusive, и
          // FAQ противоречил бы собственному прайсу двумя экранами ниже.
          "У агента три экрана: план визитов, заказ, долги точки. На освоение уходит один день. Обучение команды и разбор первых заказов входят в подключение на любом тарифе.",
          "Agentda uchta ekran bor: tashriflar rejasi, buyurtma, nuqta qarzlari. O'rganishga bir kun ketadi. Jamoani o'qitish va birinchi buyurtmalarni birga ko'rib chiqish har qanday tarifda ulanishga kiradi.",
        ),
      },
      {
        q: tr("Что будет в точках, где нет интернета?", "Internet yo'q nuqtalarda nima bo'ladi?"),
        a: tr(
          "Мобильное приложение работает офлайн: заказы, визиты и фото сохраняются на телефоне и уходят на сервер, как только появляется сеть.",
          "Mobil ilova oflayn ishlaydi: buyurtmalar, tashriflar va suratlar telefonda saqlanadi va tarmoq paydo bo'lishi bilan serverga jo'naydi.",
        ),
      },
      {
        q: tr("Сколько времени занимает запуск?", "Ishga tushirish qancha vaqt oladi?"),
        a: tr(
          "Регистрация и базовая настройка — 10 минут: компания, склад, товары, команда. Перенос остатков и справочников из Excel или 1С входит в тариф Exclusive и занимает несколько дней.",
          "Ro'yxatdan o'tish va asosiy sozlash — 10 daqiqa: kompaniya, ombor, tovarlar, jamoa. Qoldiq va ma'lumotnomalarni Excel yoki 1C dan ko'chirish Exclusive tarifiga kiradi va bir necha kun oladi.",
        ),
      },
      {
        q: tr("Что случится после 14 бесплатных дней?", "14 kunlik bepul sinovdan keyin nima bo'ladi?"),
        a: tr(
          "Ничего не спишется — карта не привязана. Выбираете тариф и продолжаете; все данные, введённые за триал, сохраняются.",
          "Hech narsa yechilmaydi — karta bog'lanmagan. Tarifni tanlab davom etasiz; sinov davrida kiritilgan barcha ma'lumotlar saqlanadi.",
        ),
      },
      {
        q: tr("Насколько защищены мои данные?", "Ma'lumotlarim qanchalik himoyalangan?"),
        a: tr(
          "Каждая компания изолирована от других, доступ — по ролям, все действия пишутся в журнал, резервные копии делаются ежедневно.",
          "Har bir kompaniya boshqalardan izolyatsiyalangan, kirish rollar bo'yicha, barcha amallar jurnalga yoziladi, zaxira nusxalar har kuni olinadi.",
        ),
      },
    ],
    [tr],
  );
  return (
    <section className="py-16 md:py-24" style={{ borderTop: `1px solid ${LX.rule}` }}>
      <div className="max-w-[1240px] mx-auto px-6 grid lg:grid-cols-[380px_1fr] gap-10 lg:gap-16">
        <SectionHead
          index="08"
          label="FAQ"
          title={tr("Вопросы, которые задают до покупки", "Sotib olishdan oldin beriladigan savollar")}
        />
        <Accordion items={items} />
      </div>
    </section>
  );
}

/* ── Чернильная зона №2: финальный CTA ───────────────────────────────────── */
function CtaSection() {
  const navigate = useNavigate();
  const tr = useTranslate();
  const tg = tgLink(tr("Здравствуйте! Хочу подключить Warehouse Pro.", "Assalomu alaykum! Warehouse Pro'ni ulamoqchiman."));
  return (
    <section className="lx-ink relative overflow-hidden" style={{ background: LX.ink }}>
      <img
        src={CTA_PHOTO}
        alt=""
        aria-hidden="true"
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover"
        style={{ opacity: 0.16, filter: "grayscale(0.6) sepia(0.3)" }}
      />
      <div className="relative max-w-[1240px] mx-auto px-6 py-20 md:py-28 text-center">
        <p className="text-[11px] uppercase mb-6" style={{ ...MONO, color: LX.softOnInk, letterSpacing: "0.22em" }}>
          {tr("Последняя строка реестра", "Reyestrning oxirgi qatori")}
        </p>
        <h2
          className="font-extrabold mx-auto max-w-3xl"
          style={{ fontSize: "clamp(2.1rem, 4.6vw, 3.6rem)", letterSpacing: "-0.035em", lineHeight: 1.05, color: LX.paperOnInk }}
        >
          {tr("Наведите порядок на складе за 14 дней", "14 kunda omboringizni tartibga keltiring")}
        </h2>
        <p className="mt-5 text-[15px] max-w-md mx-auto" style={{ color: LX.softOnInk }}>
          {tr("Бесплатно, без привязки карты. Настройка — 10 минут.", "Bepul, karta bog'lamasdan. Sozlash — 10 daqiqa.")}
        </p>
        <div className="mt-9 flex flex-wrap justify-center items-center gap-3">
          <BtnInk onPaper={false} onClick={() => navigate("/register")}>
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
          className="mt-12 mx-auto max-w-lg text-left pt-10"
          style={{ borderTop: `1px solid ${LX.ruleOnInk}` }}
        >
          <p className="text-[13px] mb-3 text-center" style={{ color: LX.softOnInk }}>
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
  const cols = [
    { label: tr("Продукт", "Mahsulot"), href: "#features" },
    { label: tr("Как работает", "Qanday ishlaydi"), href: "#how" },
    { label: tr("Роли", "Rollar"), href: "#roles" },
    { label: tr("Цены", "Narxlar"), href: "#pricing" },
  ];
  return (
    <footer className="py-12" style={{ borderTop: `1px solid ${LX.rule}` }}>
      <div className="max-w-[1240px] mx-auto px-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-8">
          <div className="max-w-xs">
            <div className="flex items-center gap-2.5 mb-4">
              <LogoMark size={28} decorative />
              <span className="font-bold text-[14px]" style={{ color: LX.ink }}>Warehouse Pro</span>
            </div>
            <p className="text-[13px] leading-relaxed" style={{ color: LX.inkSoft }}>
              {tr(
                "Система учёта склада, заказов и доставки для дистрибьюторов Узбекистана.",
                "O'zbekiston distribyutorlari uchun ombor, buyurtma va yetkazish hisobi tizimi.",
              )}
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-8 gap-y-3">
            {cols.map(c => (
              <a key={c.href} href={c.href} className="text-[13.5px] hover:underline underline-offset-4" style={{ color: LX.inkSoft }}>
                {c.label}
              </a>
            ))}
          </nav>
        </div>
        <div
          className="mt-10 pt-6 flex flex-col md:flex-row justify-between gap-3 text-[11.5px]"
          style={{ ...MONO, color: LX.inkFaint, borderTop: `1px solid ${LX.rule}` }}
        >
          <span>© 2026 Warehouse Pro · {tr("Все права защищены", "Barcha huquqlar himoyalangan")}</span>
          <span>{tr("Ташкент, Узбекистан", "Toshkent, O'zbekiston")}</span>
        </div>
      </div>
    </footer>
  );
}

/* ── Мобильная закреплённая CTA ───────────────────────────────────────────
   Директор почти наверняка смотрит с телефона, а до финальной CTA десяток
   экранов. Панель появляется после первого экрана и не перекрывает hero. */
function MobileCtaBar() {
  const navigate = useNavigate();
  const tr = useTranslate();
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
        <button
          type="button"
          onClick={() => navigate("/register")}
          className="flex-1 h-11 rounded-[9px] text-[14px] font-semibold cursor-pointer"
          style={{ background: LX.paper, color: LX.ink }}
        >
          {tr("Начать бесплатно", "Bepul boshlash")}
        </button>
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
  return (
    <div
      id="top"
      className="lx-root min-h-screen overflow-x-clip pb-16 md:pb-0"
      style={{ background: LX.paper, color: LX.ink, fontFamily: "'DM Sans', system-ui, sans-serif" }}
    >
      <LandingStyles />
      <LandingHeader />
      <div className="lx-rails max-w-[1240px] mx-auto">
        <HeroSection />
        <PhotoStrip />
      </div>
      <ProductWindow />
      <div className="lx-rails max-w-[1240px] mx-auto">
        <FactsStrip />
        <LossSection />
        <FeaturesSection />
        <PricingSection />
        <FaqSection />
      </div>
      <CtaSection />
      <Footer />
      <MobileCtaBar />
    </div>
  );
}
