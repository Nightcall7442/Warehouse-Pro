import { useEffect, useMemo, useRef, useState } from "react";
import { useLang, useTranslate } from "@/i18n";
import { LX, MONO } from "./landing-tokens";
import { Browser } from "./landing-frames";
import { webContent, type WebShotKey } from "./shots";
import { reducedMotion } from "./landing-anime";
import { useScrollScrub, captionOpacity } from "./scroll-scrub";
import { SequenceCanvas } from "./SequenceCanvas";

/* ═══════════════════════════════════════════════════════════════════════════
   ИНТЕРЛЮДИЯ / ОТ ЗАКАЗА ДО ДЕНЕГ — ОДНИМ ДВИЖЕНИЕМ

   Владелец: «хочу frame-by-frame scroll-эффекты с плавными переходами, как
   у Apple». Сцена прилипает к экрану, а прокрутка сквозь секцию ведёт
   плёнку: ОДНО окно программы проходит четыре кадра пути товара и денег,
   подписи слева сменяются в такт. Кадры — снимки настоящей программы
   (конвейер docs/landing-*), не рисунки.

   Первая версия ставила рядом окно и телефон внахлёст — владелец назвал
   это «через жопу»: два предмета спорили за глаз, окно резалось краем
   экрана. Правило Apple: один предмет в кадре, крупно, целиком. Окно
   размером от высоты экрана (не от ширины), чтобы никогда не резалось.

   Это интерлюдия без номера: главы 06–09 ниже разворачивают те же четыре
   шага подробно, как у Apple обзор перед разделами.
   ═══════════════════════════════════════════════════════════════════════════ */

const LENGTH_VH = 320; // высота секции: три с лишним экрана прокрутки на четыре кадра

type Step = { web: WebShotKey; title: string; text: string };

export default function StoryScroll() {
  const tr = useTranslate();
  const { lang } = useLang();
  const section = useRef<HTMLElement>(null);
  const { subscribe } = useScrollScrub(section);
  // «Уменьшить движение»: сцена не прилипает, подписи — списком, кадры стоят.
  const [still] = useState(() => reducedMotion());

  const steps: Step[] = [
    { web: "orders", title: tr("Заказ принят", "Buyurtma qabul qilindi"), text: tr("Агент набрал его в магазине — оператор видит сразу: позиции, цена этого магазина, долг.", "Agent do'konda terdi — operator darhol ko'radi: pozitsiyalar, shu do'kon narxi, qarz.") },
    { web: "picking", title: tr("Собран под рейс", "Reys uchun yig'ildi"), text: tr("Комплектация по партиям и срокам годности: складу — список, курьеру — рейс.", "Partiya va muddat bo'yicha komplektatsiya: omborga — ro'yxat, kuryerga — reys.") },
    { web: "warehouse", title: tr("Довезён и принят", "Yetkazildi va qabul qilindi"), text: tr("Курьер отмечает, сколько магазин принял на самом деле; остаток возвращается на склад.", "Kuryer do'kon aslida qancha olganini belgilaydi; qolgani omborga qaytadi.") },
    { web: "pnl", title: tr("Деньги сошлись", "Pul to'g'ri keldi"), text: tr("Наличные — на руках у курьера, долг магазина — по факту, директор видит P&L за день.", "Naqd — kuryer qo'lida, do'kon qarzi — haqiqat bo'yicha, direktor kunlik P&L ni ko'radi.") },
  ];
  const webFrames = useMemo(() => steps.map(s => webContent(s.web, lang)), [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // Подписи, рейка прогресса и лёгкий наезд на окно — напрямую в стили, без
  // перерисовки React на каждый кадр прокрутки.
  const captions = useRef<Array<HTMLDivElement | null>>([]);
  const rail = useRef<HTMLDivElement>(null);
  const win = useRef<HTMLDivElement>(null);
  useEffect(() => still ? undefined : subscribe(p => {
    captions.current.forEach((el, i) => {
      if (!el) return;
      const o = captionOpacity(p, i, steps.length);
      el.style.opacity = String(o);
      el.style.transform = `translateY(${Math.round((1 - o) * 10)}px)`;
      el.style.pointerEvents = o > 0.5 ? "auto" : "none";
    });
    if (rail.current) rail.current.style.transform = `scaleX(${p})`;
    if (win.current) win.current.style.transform = `scale(${(1 + p * 0.03).toFixed(4)})`;
  }), [subscribe, still, steps.length]);

  const eyebrow = (
    <div className="text-[11px] uppercase" style={{ ...MONO, fontWeight: 500, letterSpacing: "0.08em", lineHeight: 1.9, color: LX.brassText }}>
      {tr("Путь товара и денег", "Tovar va pul yo'li")}
    </div>
  );
  const h2 = (
    <h2 className="font-bold mt-3" style={{ fontSize: "clamp(1.625rem, 2.6vw, 2.125rem)", letterSpacing: "-0.025em", lineHeight: 1.1, maxWidth: "18ch", color: LX.ink }}>
      {tr("От заказа до денег — одним движением", "Buyurtmadan pulgacha — bir harakatda")}
    </h2>
  );

  return (
    <section
      ref={section}
      id="story"
      data-story
      aria-label={tr("От заказа до денег", "Buyurtmadan pulgacha")}
      style={{ background: LX.paper, borderTop: `1px solid ${LX.rule}`, height: still ? "auto" : `${LENGTH_VH}vh` }}
    >
      <div className={still ? "py-20 md:py-32" : "sticky top-0 h-screen flex items-center overflow-hidden pt-14 md:pt-0"}>
        <div className="max-w-[1240px] mx-auto px-6 w-full">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-8 items-center">
            {/* ── Подписи ───────────────────────────────────────────────── */}
            <div className="md:col-span-5">
              {eyebrow}
              {h2}
              <div ref={rail} aria-hidden="true" className="mt-6 h-px w-full origin-left" style={{ background: LX.brass, transform: still ? "none" : "scaleX(0)" }} />
              <div className={still ? "mt-6 space-y-6" : "relative mt-6 h-[150px] md:h-[170px]"}>
                {steps.map((s, i) => (
                  <div
                    key={s.title}
                    ref={el => { captions.current[i] = el; }}
                    data-story-step={i + 1}
                    className={still ? "" : "absolute inset-x-0 top-0"}
                    style={{ willChange: still ? undefined : "opacity, transform" }}
                  >
                    <div className="text-[12px]" style={{ ...MONO, color: LX.brassText }}>{String(i + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}</div>
                    <div className="mt-1 text-[22px] md:text-[26px] font-bold" style={{ letterSpacing: "-0.02em", lineHeight: 1.15, color: LX.ink }}>{s.title}</div>
                    <p className="mt-2 text-[15px] md:text-[16px]" style={{ lineHeight: 1.5, maxWidth: "40ch", color: LX.inkSoft }}>{s.text}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Сцена: одно окно программы, целиком, размером от высоты экрана ── */}
            <div className="md:col-span-7 flex md:justify-end">
              <div ref={win} className="w-full md:w-auto" style={{ willChange: still ? undefined : "transform", transformOrigin: "50% 50%" }}>
                <Browser content fade={false} style={still ? undefined : { height: "min(74vh, 640px)", width: "auto", aspectRatio: "1174 / 1036", maxWidth: "100%" }}>
                  <SequenceCanvas frames={webFrames} subscribe={subscribe} alt={tr("Окно программы: заказы, комплектация, склад, P&L", "Dastur oynasi: buyurtmalar, komplektatsiya, ombor, P&L")} fit="cover" anchor="top" className="absolute inset-0" />
                </Browser>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
