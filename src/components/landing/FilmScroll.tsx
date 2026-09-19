import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslate } from "@/i18n";
import { LX, MONO } from "./landing-tokens";
import { reducedMotion } from "./landing-anime";
import { useScrollScrub } from "./scroll-scrub";
import { SequenceCanvas } from "./SequenceCanvas";
import { FILM, WAREHOUSE_ACTS, pickFilmWidth, windowOpacity, frameInset } from "./film";

/* ═══════════════════════════════════════════════════════════════════════════
   ПЛЁНКА / ОДИН ДЕНЬ ТОВАРА

   Настоящий frame-by-frame, как у Apple: три ролика Higgsfield (Kling 3.0),
   склеенные наплывом и порезанные на кадры (scripts/landing-film.mjs), и
   прокрутка ведёт их по одному. Три акта — утро на складе, день у магазина,
   вечер у ворот — и три строки, каждая в своём акте. Ролик — иллюстрация
   мира, в котором живёт программа, не снимок программы: продукт показывают
   соседние главы настоящими экранами.

   Третий заход (19.09.2026). Владелец о втором: «некрасиво, на отъебись,
   очень короткий» — и снимок, где строка режется краем окна. Разбор:
     · один ролик на 64 кадра, камера за экран прокрутки едва двигалась,
       а строки обещали магазин и деньги, которых в кадре не было;
     · первая строка была видна ещё пока секция въезжала — и резалась;
     · секция в 240vh кончалась за десяток щелчков колеса.
   Теперь: три акта на 150 с лишним кадров и 520vh пути; кадр въезжает
   листом с полями и раскрывается на весь экран, только потом появляется
   строка; внизу — волосяная линия хода плёнки с отметками актов.
   ═══════════════════════════════════════════════════════════════════════════ */

const LENGTH_VH = 520;
const FILM_NAME = "warehouse";
/** Доля пути на раскрытие кадра в начале и сворачивание в конце. */
const LEAD = 0.07;
/** Ширина затухания строки, в долях пути. */
const EDGE = 0.045;
/** Зазор строки от границы акта: наплыв между актами идёт без слов. */
const GAP = 0.012;
// Границы актов в долях пути: кадр k рисуется при p = k / (count − 1).
const BOUNDS = WAREHOUSE_ACTS.map(k => k / (FILM[FILM_NAME].count - 1));
/** Отрезок пути, на котором видна строка акта i. */
const WINDOWS = BOUNDS.map((b, i) => ({
  from: i === 0 ? LEAD + GAP : b + GAP,
  to: i === BOUNDS.length - 1 ? 1 - LEAD - GAP : BOUNDS[i + 1] - GAP,
}));
/** Ход плёнки на линии — без входа и выхода кадра. */
const along = (p: number) => Math.min(1, Math.max(0, (p - LEAD) / (1 - 2 * LEAD)));

export default function FilmScroll() {
  const tr = useTranslate();
  const section = useRef<HTMLElement>(null);
  const { subscribe } = useScrollScrub(section);
  const [still] = useState(() => reducedMotion());
  const film = FILM[FILM_NAME];
  // Ширина кадров — по экрану, один раз: телефону 960, ноутбуку и монитору 1920.
  const [width] = useState(() => pickFilmWidth(film.widths, typeof window === "undefined" ? 0 : window.innerWidth * Math.min(2, window.devicePixelRatio || 1)));
  const frames = useMemo(() => Array.from({ length: film.count }, (_, i) => `/landing/film/${FILM_NAME}/w${width}/${String(i + 1).padStart(3, "0")}.webp`), [film.count, width]);

  const lines = [
    { eyebrow: tr("Утро · склад", "Ertalab · ombor"), title: tr("Каждое утро товар уезжает со склада.", "Har kuni ertalab tovar ombordan ketadi."), text: tr("Сотни коробок, десятки точек, один рабочий день.", "Yuzlab quti, o'nlab nuqta, bitta ish kuni.") },
    { eyebrow: tr("День · магазин", "Kunduzi · do'kon"), title: tr("Warehouse Pro ведёт его до магазина.", "Warehouse Pro uni do'kongacha olib boradi."), text: tr("Заказ, комплектация, рейс, приёмка — каждый шаг записан.", "Buyurtma, komplektatsiya, reys, qabul — har qadam yozilgan.") },
    // Кассы в продукте больше нет (расчёт живёт в заказе) — и в строке её нет.
    { eyebrow: tr("Вечер · расчёт", "Kechqurun · hisob"), title: tr("И деньги возвращаются.", "Va pul qaytadi."), text: tr("Наличные, карта, долг: вечером каждый заказ рассчитан до сума.", "Naqd, karta, qarz: kechqurun har bir buyurtma so'migacha hisoblangan.") },
  ];
  const frame = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const captions = useRef<Array<HTMLDivElement | null>>([]);
  useEffect(() => still ? undefined : subscribe(p => {
    const inset = frameInset(p, LEAD);
    if (frame.current) {
      frame.current.style.transform = `scale(${(1 - 0.08 * inset).toFixed(4)})`;
      frame.current.style.borderRadius = `${(18 * inset).toFixed(1)}px`;
    }
    if (rail.current) rail.current.style.opacity = String(1 - inset);
    if (fill.current) fill.current.style.transform = `scaleX(${along(p).toFixed(4)})`;
    captions.current.forEach((el, i) => {
      if (!el) return;
      const o = windowOpacity(p, WINDOWS[i].from, WINDOWS[i].to, EDGE);
      el.style.opacity = String(o);
      el.style.transform = `translateY(${Math.round((1 - o) * 16)}px)`;
    });
  }), [subscribe, still]);

  const caption = (l: (typeof lines)[number]) => (
    <>
      <div className="text-[12px] md:text-[13px] uppercase" style={{ ...MONO, fontWeight: 600, letterSpacing: "0.12em", lineHeight: 1.6, color: LX.brassOnNight }}>{l.eyebrow}</div>
      <div className="font-extrabold mt-2.5" style={{ fontSize: "clamp(2rem, 4.6vw, 4.25rem)", letterSpacing: "-0.035em", lineHeight: 1.0, maxWidth: "15ch", textWrap: "balance", color: LX.paperOnInk }}>{l.title}</div>
      <p className="mt-4 text-[16px] md:text-[20px]" style={{ lineHeight: 1.45, maxWidth: "46ch", color: LX.softOnInk }}>{l.text}</p>
    </>
  );

  if (still) {
    // Без движения: постер листом и три строки списком под ним — ничего не спрятано.
    return (
      <section ref={section} id="film" data-film aria-label={tr("Один день товара", "Tovarning bir kuni")} style={{ background: LX.night }} className="px-6 md:px-10 py-16 md:py-24">
        <div className="max-w-[1240px] mx-auto">
          <SequenceCanvas frames={frames} subscribe={subscribe} alt={tr("Склад на рассвете: стеллажи с товаром, машина у рампы", "Tongdagi ombor: tovarli javonlar, rampadagi mashina")} fit="cover" anchor="center" blend={false} className="relative w-full" style={{ aspectRatio: `${film.width} / ${film.height}`, borderRadius: 18 }} />
          <div className="grid gap-10 md:grid-cols-3 mt-12">
            {lines.map((l, i) => <div key={l.title} data-film-line={i + 1}>{caption(l)}</div>)}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section ref={section} id="film" data-film aria-label={tr("Один день товара", "Tovarning bir kuni")} style={{ background: LX.night, height: `calc(${LENGTH_VH}vh / var(--lx-zoom, 1))` }}>
      <div className="sticky top-0 overflow-hidden" style={{ height: "calc(100vh / var(--lx-zoom, 1))" }}>
        {/* Кадр: въезжает листом с полями и скруглением, раскрывается на весь экран. */}
        <div ref={frame} className="absolute inset-0 overflow-hidden" style={{ willChange: "transform", transformOrigin: "50% 50%" }}>
          <SequenceCanvas
            frames={frames}
            subscribe={subscribe}
            alt={tr("Склад на рассвете: стеллажи с товаром, машина у рампы", "Tongdagi ombor: tovarli javonlar, rampadagi mashina")}
            fit="cover"
            anchor="center"
            blend={false}
            className="absolute inset-0"
          />
          {/* Тень под строки — только снизу, кадр сверху остаётся чистым. */}
          <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={{ background: `linear-gradient(to top, ${LX.black80} 0%, ${LX.black25} 38%, transparent 68%)` }} />
        </div>
        <div className="absolute inset-x-0 bottom-0 px-6 md:px-10 pb-[15vh] md:pb-[11vh]">
          <div className="max-w-[1240px] mx-auto relative h-[190px] md:h-[236px]">
            {lines.map((l, i) => (
              <div key={l.title} ref={el => { captions.current[i] = el; }} data-film-line={i + 1} className="absolute inset-x-0 bottom-0" style={{ willChange: "opacity, transform" }}>
                {caption(l)}
              </div>
            ))}
          </div>
        </div>
        {/* Ход плёнки: волосяная линия, заполняется по прокрутке; отметки — начала актов. */}
        <div ref={rail} aria-hidden="true" className="absolute inset-x-0 px-6 md:px-10 bottom-[10vh] md:bottom-[5.5vh]">
          <div className="max-w-[1240px] mx-auto relative h-px" style={{ background: LX.paperOnInk10 }}>
            <div ref={fill} className="absolute inset-y-0 left-0 w-full" style={{ background: LX.paperOnInk, transformOrigin: "left", transform: "scaleX(0)" }} />
            {BOUNDS.slice(1).map(b => (
              <div key={b} className="absolute w-px" style={{ left: `${(along(b) * 100).toFixed(2)}%`, top: -3, height: 7, background: LX.paperOnInk34 }} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
