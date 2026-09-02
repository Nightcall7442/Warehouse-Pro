import { useEffect, useRef } from "react";
import { animate, utils } from "animejs";
import { LX, MONO } from "./landing-tokens";

/* ═══════════════════════════════════════════════════════════════════════════
   ЖИВОЕ ПОЛЕ ЯЧЕЕК

   Единственный по-настоящему заметный образ на странице — и он же сам предмет
   разговора. Каждая метка это ячейка склада: тёмная занята, латунная в
   резерве, бледная свободна. Поле выкладывается столбец за столбцом, а потом
   тихо дышит: несколько меток в минуту меняют состояние, как меняется
   настоящий остаток, пока агенты оформляют заказы.

   ── Почему не абстрактный узор ────────────────────────────────────────────

   Градиентное пятно или парящие частицы можно поставить на любой сайт, и
   поэтому они не говорят ничего. Здесь движение НЕСЁТ смысл: посетитель за
   три секунды видит, что программа про остатки, резерв и оборот, — раньше,
   чем прочитает хоть слово.

   ── Сдержанность ──────────────────────────────────────────────────────────

   Дыхание нарочно редкое и почти незаметное: раз в полторы секунды меняются
   три метки из шести сотен. Поле должно жить на периферии зрения и не
   отбирать внимание у заголовка. Замеченная анимация на деловом сайте — уже
   ошибка.

   При включённом «уменьшить движение» поле рисуется сразу и не дышит.
   ═══════════════════════════════════════════════════════════════════════════ */

const COLS = 96;
const ROWS = 16;
const CELL_W = 8;
const CELL_H = 11;
const MARK_W = 2;
const MARK_H = 7;

/** Занятость столбца: две медленные волны, никакой случайности. */
const occupancy = (c: number) =>
  Math.min(0.97, Math.max(0.18, 0.6 + 0.26 * Math.sin(c * 0.098 + 0.6) + 0.1 * Math.sin(c * 0.27 + 2.2)));

type State = "taken" | "held" | "free";

const TONE: Record<State, string> = {
  taken: LX.ink,
  held: LX.brass,
  free: "rgba(72,66,55,0.18)",
};

interface Cell { x: number; y: number; state: State }

const CELLS: Cell[] = (() => {
  const out: Cell[] = [];
  for (let c = 0; c < COLS; c++) {
    const filled = Math.round(occupancy(c) * ROWS);
    const held = Math.max(1, Math.round(filled * 0.17));
    for (let r = 0; r < ROWS; r++) {
      const state: State = r >= filled ? "free" : r >= filled - held ? "held" : "taken";
      out.push({
        x: c * CELL_W + (CELL_W - MARK_W) / 2,
        y: (ROWS - 1 - r) * CELL_H + (CELL_H - MARK_H) / 2,
        state,
      });
    }
  }
  return out;
})();

const W = COLS * CELL_W;
const H = ROWS * CELL_H;

export default function TallyField() {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const marks = Array.from(svg.querySelectorAll<SVGRectElement>("rect[data-cell]"));
    if (marks.length === 0) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    // Прячем ИЗ сценария, а не стилями: не выполнится сценарий — поле просто
    // останется на месте видимым, а не исчезнет с листа.
    utils.set(marks, { opacity: 0, scaleY: 0.3 });

    let breathing: ReturnType<typeof setInterval> | undefined;
    let stopped = false;

    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();

      animate(marks, {
        opacity: [0, 1],
        scaleY: [0.3, 1],
        duration: 620,
        // Задержка по СТОЛБЦУ, а не по метке. Метки идут подряд по столбцам,
        // и обычный шаг stagger растянул бы выкладку на восемь секунд:
        // 1536 меток вместо 96 столбцов. Поле должно лечь меньше чем за
        // секунду — слева направо, как заполняют ведомость.
        delay: (_target?: unknown, i?: number) => Math.floor((i ?? 0) / ROWS) * 9,
        ease: "outQuint",
      });

      // Дыхание: три метки раз в полторы секунды меняют состояние.
      breathing = setInterval(() => {
        if (stopped || document.hidden) return;
        for (let k = 0; k < 3; k++) {
          const el = marks[Math.floor(Math.random() * marks.length)];
          if (!el) continue;
          const now = el.getAttribute("fill");
          const next = now === TONE.taken ? TONE.held : now === TONE.held ? TONE.free : TONE.taken;
          animate(el, { fill: next, duration: 900, ease: "inOutQuad" });
        }
      }, 1500);
    }, { threshold: 0.15 });

    io.observe(svg);
    return () => {
      stopped = true;
      io.disconnect();
      if (breathing) clearInterval(breathing);
    };
  }, []);

  return (
    <div className="pt-8 pb-10" style={{ borderTop: `1px solid ${LX.rule}` }} aria-hidden="true">
      <div
        className="max-w-[1240px] mx-auto px-6 flex items-baseline justify-between mb-5 text-[11px] uppercase"
        style={{ ...MONO, fontWeight: 500, color: LX.inkFaint, letterSpacing: "0.08em" }}
      >
        <span>{COLS} × {ROWS} — занятость ячеек</span>
        <span className="hidden sm:inline">обновляется на глазах</span>
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        style={{ display: "block", overflow: "visible" }}
      >
        {CELLS.map((c, i) => (
          <rect
            key={i}
            data-cell=""
            x={c.x}
            y={c.y}
            width={MARK_W}
            height={MARK_H}
            fill={TONE[c.state]}
            style={{ transformOrigin: `${c.x + MARK_W / 2}px ${c.y + MARK_H}px` }}
          />
        ))}
      </svg>
      <div
        className="max-w-[1240px] mx-auto px-6 flex flex-wrap gap-x-7 gap-y-1 mt-5 text-[13px] font-medium"
        style={{ color: LX.inkSoft }}
      >
        <Key tone={TONE.taken} label="занято" />
        <Key tone={TONE.held} label="резерв" />
        <Key tone={TONE.free} label="свободно" />
      </div>
    </div>
  );
}

function Key({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span style={{ display: "inline-block", width: 2, height: 9, background: tone }} />
      {label}
    </span>
  );
}
