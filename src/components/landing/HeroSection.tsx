import { useNavigate } from "react-router";
import LeadForm from "./LeadForm";
import { useTranslate } from "@/i18n";
import { ArrowRight, ArrowDown } from "lucide-react";
import { BtnInk, Stamp } from "./landing-shared";
import { LX, MONO } from "./landing-tokens";

/* ═══════════════════════════════════════════════════════════════════════════
   ПЕРВЫЙ ЭКРАН — разворот бланка, а не стопка.

   Было шесть блоков по одной оси: надзаголовок, заголовок, абзац, две кнопки,
   форма, строка галочек. Правая половина пуста, три призыва к действию дерутся
   между собой, на телефоне всё это занимает экран целиком, и человек не
   видит ни одного доказательства, пока не промотает.

   Стало три колонки: поле листа 96px с рубрикой, тело с заголовком и ОДНОЙ
   кнопкой, справа — панель «Склад · сегодня», которая впервые ПОКАЗЫВАЕТ
   программу: шесть строк реального дня. Форма заявки уходит в подвал бланка
   под всеми тремя колонками. На телефоне порядок переписан: кнопка, сразу за
   ней форма (поле телефона видно без прокрутки), потом панель.

   ── Панель дня ────────────────────────────────────────────────────────────

   Строки покрывают продукт целиком, а не только доставку: склад, рейс,
   частичная приёмка, офлайн, долг, выгрузка в 1С. Метка «демо-данные» стоит
   честно — ни одна цифра на странице не выдаёт себя за боевую. Четыре тона
   состояния, пятого не заводить.

   ── Переносы заголовка ────────────────────────────────────────────────────

   Не хардкодятся <br> под русскую меру: узбекский на 15–30% длиннее и уронил
   бы высоту первого экрана. Заголовок отдаётся в tr() целиком, каждый
   вариант со своими переносами.
   ═══════════════════════════════════════════════════════════════════════════ */

const TONE = {
  neutral: LX.inkFaint,
  good: LX.good,
  warn: LX.brassText,
  bad: LX.bad,
  ink: LX.ink,
} as const;

export default function HeroSection() {
  const navigate = useNavigate();
  const tr = useTranslate();

  const rows: Array<{ t: string; title: string; note: string; value: string; tone: keyof typeof TONE }> = [
    { t: "07:30", title: tr("Рейс собран", "Reys yig'ildi"), note: tr("18 точек, маршрут в телефоне агента", "18 nuqta, marshrut agent telefonida"), value: "18", tone: "neutral" },
    { t: "09:15", title: tr("Доставлено", "Yetkazildi"), note: tr("первые четыре точки, оплата наличными", "birinchi to'rt nuqta, naqd to'lov"), value: "24 / 24", tone: "good" },
    { t: "11:40", title: tr("Частичная приёмка", "Qisman qabul"), note: tr("магазин принял 80 из 100, остаток — на склад", "do'kon 100 dan 80 qabul qildi, qolgani — omborga"), value: "80 / 100", tone: "warn" },
    { t: "14:05", title: tr("Нет связи", "Aloqa yo'q"), note: tr("заказ сохранён в телефоне, уйдёт при сети", "buyurtma telefonda saqlandi, tarmoqda jo'naydi"), value: tr("в очереди", "navbatda"), tone: "neutral" },
    { t: "16:20", title: tr("Долг не закрыт", "Qarz yopilmagan"), note: tr("прошлая неделя, магазин в списке на утро", "o'tgan hafta, do'kon ertalabki ro'yxatda"), value: "200 000", tone: "bad" },
    { t: "19:40", title: tr("День закрыт", "Kun yopildi"), note: tr("выгрузка в 1С прошла, сверка наличных сошлась", "1C ga yuklash o'tdi, naqd solishtiruv to'g'ri keldi"), value: "1С ✓", tone: "ink" },
  ];

  const panel = (
    <div className="relative">
      <div
        data-hero-step="3"
        className="rounded-xl overflow-hidden"
        style={{ background: LX.paperRaised, border: `1px solid ${LX.rule}` }}
      >
        <div
          className="flex items-center justify-between pl-5 pr-24 h-[52px] text-[11px] uppercase"
          style={{ ...MONO, fontWeight: 500, letterSpacing: "0.08em", borderBottom: `1px solid ${LX.rule}` }}
        >
          <span style={{ color: LX.brassText }}>{tr("Склад · сегодня", "Ombor · bugun")}</span>
          <span style={{ color: LX.inkFaint }}>{tr("демо-данные", "demo ma'lumotlar")}</span>
        </div>
        <ol>
          {rows.map(r => (
            <li
              key={r.t}
              data-reveal="day"
              className="grid grid-cols-[52px_1fr_auto] items-center gap-x-3 px-5 py-3 min-h-[60px] lg:min-h-[68px]"
              style={{ borderBottom: `1px solid ${LX.rule}` }}
            >
              <span className="text-[12px]" style={{ ...MONO, color: LX.brassText }}>{r.t}</span>
              <span className="min-w-0">
                <span className="block text-[14.5px] font-semibold truncate" style={{ color: LX.ink }}>{r.title}</span>
                <span className="block text-[12.5px] leading-snug" style={{ color: LX.inkSoft }}>{r.note}</span>
              </span>
              <span className="text-[13px] text-right whitespace-nowrap" style={{ ...MONO, color: TONE[r.tone] }}>{r.value}</span>
            </li>
          ))}
        </ol>
        <div
          className="px-5 h-[44px] flex items-center text-[11px] uppercase"
          style={{ ...MONO, fontWeight: 500, letterSpacing: "0.08em", color: LX.inkFaint }}
        >
          {tr("строки появляются по факту, а не по плану", "qatorlar reja bo'yicha emas, fakt bo'yicha paydo bo'ladi")}
        </div>
      </div>
      {/* Одна печать на первый экран; вторая и последняя — на тарифе Pro. */}
      <div data-stamp="" className="absolute -top-8 -right-6" style={{ mixBlendMode: "multiply" }}>
        <Stamp
          ring={tr("14 ДНЕЙ БЕСПЛАТНО · КАРТА НЕ НУЖНА · 14 KUN BEPUL · ", "14 KUN BEPUL · KARTA KERAK EMAS · 14 ДНЕЙ · ")}
          center="WP"
          sub="2026"
          size={96}
          rotate={-8}
        />
      </div>
    </div>
  );

  return (
    <section className="relative pt-24 md:pt-32 pb-14 md:pb-[88px]">
      <div className="max-w-[1240px] mx-auto px-6">
        <div className="grid gap-x-0 lg:grid-cols-[96px_1fr_400px]">

          {/* Поле листа */}
          <aside
            data-hero-step="0"
            className="lg:pr-6 mb-6 lg:mb-0 flex lg:block gap-x-4 text-[11px] uppercase whitespace-nowrap"
            style={{ ...MONO, fontWeight: 500, letterSpacing: "0.08em", lineHeight: 1.9, borderRight: undefined }}
          >
            <span className="block" style={{ color: LX.brassText }}>{tr("Лист 01", "Varaq 01")}</span>
            <span className="block" style={{ color: LX.inkFaint }}>{tr("Реестр WP-2026", "Reyestr WP-2026")}</span>
            <span className="block" style={{ color: LX.inkFaint }}>{tr("Ташкент", "Toshkent")}</span>
          </aside>

          {/* Тело */}
          <div className="lg:pl-10 lg:pr-8 lg:border-l" style={{ borderColor: LX.rule }}>
            <h1
              data-hero-title=""
              className="font-extrabold"
              style={{ fontSize: "clamp(2.75rem, 5.4vw, 5.25rem)", letterSpacing: "-0.045em", lineHeight: 0.96, color: LX.ink, maxWidth: "12ch" }}
            >
              {tr("Учёт склада", "Ombor hisobi")}
              <br />
              {tr("и доставки", "va yetkazish")}
              <br />
              <span style={{ ...MONO, fontWeight: 400, fontSize: "0.82em", letterSpacing: "-0.055em" }}>
                {tr("без разрывов", "uzilishlarsiz")}
              </span>
              <br />
              {tr("между отделами", "bo'limlar orasida")}
            </h1>

            <p data-hero-step="1" className="mt-7 lg:mt-8 text-[18px] lg:text-[20px]" style={{ lineHeight: 1.5, maxWidth: 520, color: LX.inkSoft }}>
              {tr(
                "Один источник данных для директора, склада, агентов и курьеров — вместо тетрадей, Excel и звонков «где машина?».",
                "Direktor, ombor, agentlar va kuryerlar uchun yagona manba — daftar, Excel va «mashina qayerda?» qo'ng'iroqlari o'rniga.",
              )}
            </p>

            <div data-hero-step="2" className="mt-8 lg:mt-10 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-7">
              <BtnInk onClick={() => navigate("/register")} className="h-[52px] px-7 text-[15px] w-full sm:w-auto justify-center">
                {tr("Начать бесплатно", "Bepul boshlash")}
                <ArrowRight size={15} />
              </BtnInk>
              {/* Не кнопка: ссылка на якорь внутри страницы. Два равновесных прямоугольника — это отсутствие иерархии. */}
              <a
                href="#product"
                className="inline-flex items-center gap-1.5 text-[15px] font-medium underline underline-offset-[6px] decoration-1"
                style={{ color: LX.ink, textDecorationColor: LX.ruleStrong }}
              >
                {tr("Посмотреть интерфейс", "Interfeysni ko'rish")}
                <ArrowDown size={14} />
              </a>
            </div>

            {/* На телефоне форма — сразу за кнопкой: поле телефона в первом экране без прокрутки. */}
            <div className="lg:hidden mt-7">
              <LeadForm compact stack source="hero" />
            </div>
          </div>

          {/* Панель дня */}
          <div className="mt-10 lg:mt-2 lg:pl-8">{panel}</div>
        </div>

        {/* Подвал бланка — во всю ширину, под всеми тремя колонками. Только десктоп: на телефоне форма уже стоит выше. */}
        <div
          data-reveal="hero-foot"
          className="hidden lg:grid grid-cols-[280px_1fr] gap-10 mt-14 pt-8"
          style={{ borderTop: `1px solid ${LX.rule}` }}
        >
          <div>
            <p className="text-[15px] font-semibold" style={{ color: LX.ink }}>
              {tr("Не хотите разбираться сами?", "O'zingiz tushunishni xohlamaysizmi?")}
            </p>
            <p className="text-[13px] mt-1" style={{ color: LX.inkSoft }}>
              {tr("Оставьте номер — перезвоним и покажем на ваших данных.", "Raqam qoldiring — qo'ng'iroq qilib, o'z ma'lumotlaringizda ko'rsatamiz.")}
            </p>
          </div>
          <div>
            <LeadForm compact source="hero" />
            <p className="mt-3 text-[13px] font-medium" style={{ color: LX.inkSoft }}>
              {tr("Двусторонний обмен с 1С", "1C bilan ikki tomonlama almashinuv")}
              <span style={{ color: LX.inkFaint }}> · </span>
              {tr("Приложение работает без интернета", "Ilova internetsiz ishlaydi")}
              <span style={{ color: LX.inkFaint }}> · </span>
              {tr("14 дней бесплатно, карта не привязывается", "14 kun bepul, karta bog'lanmaydi")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
