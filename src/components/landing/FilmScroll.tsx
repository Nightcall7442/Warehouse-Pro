import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslate } from "@/i18n";
import { LX } from "./landing-tokens";
import { reducedMotion } from "./landing-anime";
import { useScrollScrub, captionOpacity } from "./scroll-scrub";
import { SequenceCanvas } from "./SequenceCanvas";
import { FILM, pickFilmWidth } from "./film";

/* ═══════════════════════════════════════════════════════════════════════════
   ПЛЁНКА / СКЛАД НА РАССВЕТЕ

   Настоящий frame-by-frame, как у Apple: ролик, сгенерированный в
   Higgsfield (Seedance 2.0), порезан на кадры (scripts/landing-film.mjs),
   и прокрутка ведёт их по одному — камера едет по складу к машине ровно
   настолько, насколько читатель прокрутил. Три строки поверх сменяются
   в такт. Ролик — иллюстрация мира, в котором живёт программа, не снимок
   программы: продукт показывают соседние главы настоящими экранами.

   Кадры лежат в public/landing/film/<name>/NNN.webp; сколько их — в
   film.ts, который пишет скрипт резки. Первый кадр — постер под холстом.

   Второй заход (19.09.2026, владелец: «качественнее и красивее»): ролик
   Kling 3.0 pro, 8 с, кадры 1920 px вместо 1280 (на большом экране прежние
   давали мыло), без затухания между кадрами (оно двоило движение) и 240vh
   вместо 260 — за экран прокрутки камера проходит заметный путь.
   ═══════════════════════════════════════════════════════════════════════════ */

const LENGTH_VH = 240;
const FILM_NAME = "warehouse";


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
    { title: tr("Каждое утро товар уезжает со склада.", "Har kuni ertalab tovar ombordan ketadi."), text: tr("Сотни коробок, десятки точек, один рабочий день.", "Yuzlab quti, o'nlab nuqta, bitta ish kuni.") },
    { title: tr("Warehouse Pro ведёт его до магазина.", "Warehouse Pro uni do'kongacha olib boradi."), text: tr("Заказ, комплектация, рейс, приёмка — каждый шаг записан.", "Buyurtma, komplektatsiya, reys, qabul — har qadam yozilgan.") },
    // Кассы в продукте больше нет (расчёт живёт в заказе) — и в строке её нет.
    { title: tr("И деньги возвращаются.", "Va pul qaytadi."), text: tr("Наличные, карта, долг: вечером каждый заказ рассчитан до сума.", "Naqd, karta, qarz: kechqurun har bir buyurtma so'migacha hisoblangan.") },
  ];

  const captions = useRef<Array<HTMLDivElement | null>>([]);
  useEffect(() => still ? undefined : subscribe(p => {
    captions.current.forEach((el, i) => {
      if (!el) return;
      const o = captionOpacity(p, i, lines.length, 0.08);
      el.style.opacity = String(o);
      el.style.transform = `translateY(${Math.round((1 - o) * 14)}px)`;
    });
  }), [subscribe, still, lines.length]);

  return (
    <section
      ref={section}
      id="film"
      data-film
      aria-label={tr("Склад на рассвете", "Tongdagi ombor")}
      style={{ background: LX.night, height: still ? "auto" : `${LENGTH_VH}vh` }}
    >
      <div className={still ? "relative" : "sticky top-0 h-screen overflow-hidden"}>
        <SequenceCanvas
          frames={frames}
          subscribe={subscribe}
          alt={tr("Склад на рассвете: стеллажи с товаром, машина у рампы", "Tongdagi ombor: tovarli javonlar, rampadagi mashina")}
          fit="cover"
          anchor="center"
          blend={false}
          className={still ? "relative w-full" : "absolute inset-0"}
          style={still ? { aspectRatio: `${film.width} / ${film.height}` } : undefined}
        />
        {/* Виньетка — чтобы строки читались поверх любого кадра. */}
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={{ background: `linear-gradient(to bottom, ${LX.black80} 0%, transparent 35%, transparent 60%, ${LX.black85} 100%)` }} />
        <div className={still ? "absolute inset-x-0 bottom-0 px-6 pb-10" : "absolute inset-x-0 bottom-0 px-6 pb-[12vh]"}>
          <div className={`max-w-[1240px] mx-auto ${still ? "space-y-6" : "relative h-[132px] md:h-[150px]"}`}>
            {lines.map((l, i) => (
              <div key={l.title} ref={el => { captions.current[i] = el; }} data-film-line={i + 1} className={still ? "" : "absolute inset-x-0 bottom-0"} style={{ willChange: still ? undefined : "opacity, transform" }}>
                <div className="font-extrabold" style={{ fontSize: "clamp(1.75rem, 4.2vw, 3.5rem)", letterSpacing: "-0.035em", lineHeight: 1.02, maxWidth: "22ch", color: LX.paperOnInk }}>{l.title}</div>
                <p className="mt-3 text-[16px] md:text-[19px]" style={{ lineHeight: 1.45, maxWidth: "50ch", color: LX.softOnInk }}>{l.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
