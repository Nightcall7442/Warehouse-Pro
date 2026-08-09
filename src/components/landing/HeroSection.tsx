import { useNavigate } from "react-router";
import { useTranslate } from "@/i18n";
import { ArrowRight, ArrowDown, Check, Send } from "lucide-react";
import { LX, MONO, BtnInk, BtnGhost, Stamp, tgLink } from "./landing-shared";

/* ═══════════════════════════════════════════════════════════════════════════
   HERO — первая страница реестра.

   Композиция документа: всё выровнено влево, как в настоящем бланке; сверху
   моно-строка шапки, заголовок — самый крупный объект первого экрана.
   Эмфаза в H1 — сменой семейства (DM Mono внутри DM Sans 800), а не цветом:
   при двух запертых шрифтах это единственный доступный display-контраст.

   Справа — оттиск латунной печати «14 дней бесплатно»: культурный знак
   «сделка реальна» и первое из двух её появлений на странице.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function HeroSection() {
  const navigate = useNavigate();
  const tr = useTranslate();
  const tg = tgLink(tr("Здравствуйте! Хочу узнать подробнее о Warehouse Pro.", "Assalomu alaykum! Warehouse Pro haqida bilmoqchiman."));

  return (
    <section className="relative pt-28 md:pt-36 pb-14 md:pb-20 overflow-hidden">
      <div className="max-w-[1240px] mx-auto px-6">
        {/* Шапка бланка */}
        <div
          className="lx-enter flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] md:text-[11px] uppercase mb-8 md:mb-10"
          style={{ ...MONO, color: LX.brassText, letterSpacing: "0.2em" }}
        >
          <span>{tr("Складская книга", "Ombor daftari")}</span>
          <span aria-hidden="true" style={{ color: LX.inkFaint }}>·</span>
          {/* Без знака «№»: в DM Mono нет этого глифа, браузер подставлял «%» */}
          <span>{tr("Реестр WP-2026", "Reyestr WP-2026")}</span>
          <span aria-hidden="true" style={{ color: LX.inkFaint }}>·</span>
          <span>{tr("Ташкент", "Toshkent")}</span>
        </div>

        <div className="relative">
          {/*
            Ширина под самую длинную строку, а не под глазомер: при
            max-w-4xl (896px) строка «Учёт склада и доставки» на 1280px
            занимала 931px и переносилась, разбивая заголовок на четыре
            строки вместо трёх, заложенных <br>. Правый предел оставляет
            место оттиску печати.
          */}
          <h1
            className="lx-enter lx-enter-1 font-extrabold max-w-[15ch] lg:max-w-[19ch]"
            style={{
              fontSize: "clamp(2.4rem, 6.2vw, 5.2rem)",
              letterSpacing: "-0.04em",
              lineHeight: 1.02,
              color: LX.ink,
            }}
          >
            {tr("Учёт склада и доставки", "Ombor va yetkazish hisobi")}
            <br />
            <span style={{ ...MONO, fontWeight: 400, fontSize: "0.82em", letterSpacing: "-0.055em", wordSpacing: "-0.3em" }}>
              {tr("без разрывов", "uzilishlarsiz")}
            </span>{" "}
            {tr("между отделами", "— bo'limlar orasida")}
          </h1>

          {/*
            Оттиск справа появляется только с lg: на планшетных 768–1023px
            он ложился прямо на строку «между отделами», перекрывая её на
            120px. Ниже lg печать стоит отдельным блоком под кнопками.
          */}
          <div className="hidden lg:block absolute -top-4 right-0 xl:right-10">
            <Stamp
              ring={tr(
                "14 ДНЕЙ БЕСПЛАТНО · КАРТА НЕ НУЖНА · 14 KUN BEPUL · ",
                "14 KUN BEPUL · KARTA KERAK EMAS · 14 ДНЕЙ · ",
              )}
              center="WP"
              sub="2026"
              size={158}
              rotate={-6}
            />
          </div>
        </div>

        <p
          className="lx-enter lx-enter-2 mt-7 md:mt-9 max-w-xl text-[16px] md:text-[17px] leading-relaxed"
          style={{ color: LX.inkSoft }}
        >
          {tr(
            "Один источник данных для директора, склада, агентов и курьеров — вместо Excel-таблиц, тетрадей и звонков «где машина?».",
            "Direktor, ombor, agentlar va kuryerlar uchun yagona ma'lumot manbai — Excel jadvallar, daftarlar va «mashina qayerda?» qo'ng'iroqlari o'rniga.",
          )}
        </p>

        <div className="lx-enter lx-enter-2 mt-9 flex flex-wrap items-center gap-3">
          <BtnInk onClick={() => navigate("/register")}>
            {tr("Начать бесплатно", "Bepul boshlash")}
            <ArrowRight size={15} />
          </BtnInk>
          <BtnGhost href="#product">
            {tr("Посмотреть интерфейс", "Interfeysni ko'rish")}
            <ArrowDown size={14} />
          </BtnGhost>
          {tg && (
            <BtnGhost href={tg}>
              <Send size={14} />
              {tr("Написать в Telegram", "Telegramda yozish")}
            </BtnGhost>
          )}
        </div>

        {/* Оттиск в потоке — под кнопками, чтобы не давить на H1 */}
        <div className="lg:hidden mt-8">
          <Stamp
            ring={tr(
              "14 ДНЕЙ БЕСПЛАТНО · КАРТА НЕ НУЖНА · 14 KUN BEPUL · ",
              "14 KUN BEPUL · KARTA KERAK EMAS · 14 ДНЕЙ · ",
            )}
            center="WP"
            sub="2026"
            size={126}
            rotate={-6}
          />
        </div>

        <div
          className="lx-enter lx-enter-3 mt-10 md:mt-12 pt-6 flex flex-wrap gap-x-8 gap-y-3"
          style={{ borderTop: `1px solid ${LX.rule}` }}
        >
          {[
            tr("Двусторонний обмен с 1С", "1C bilan ikki tomonlama almashinuv"),
            tr("Мобильное приложение работает без интернета", "Mobil ilova internetsiz ishlaydi"),
            tr("14 дней бесплатно, карта не нужна", "14 kun bepul, karta kerak emas"),
          ].map(s => (
            <span key={s} className="flex items-center gap-2.5 text-[13px]" style={{ color: LX.inkSoft }}>
              <Check size={14} strokeWidth={3} style={{ color: LX.brassText }} />
              {s}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
