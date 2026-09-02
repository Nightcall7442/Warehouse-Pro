import { useEffect, useState, useId, type ReactNode, type CSSProperties } from "react";
import { cn, LX, MONO, useInView } from "./landing-tokens";

/* ═══════════════════════════════════════════════════════════════════════════
   СКЛАДСКАЯ КНИГА — дизайн-система лендинга
   ───────────────────────────────────────────────────────────────────────────
   Метафора: разлинованный складской реестр. Бумага, чернила, латунная печать.

   Три правила, на которых всё держится:

   1. БЮДЖЕТ ЧЕРНИЛ. Ровно две полночернильные зоны на страницу — окно
      продукта и финальный CTA. Всё остальное — бумага. Контраст стреляет,
      только когда редок; четыре тёмных пятна превращают ритм в зебру.

   2. ЛИНОВКА, А НЕ ТЕНИ. Секции разделяются волосяными линиями во всю
      ширину, контент прижат к боковым рельсам. Тени почти не используются —
      прежний неоморфизм с двойной тенью на каждом элементе и был причиной
      «дешёвого» вида.

   3. ДВА ШРИФТА, НОЛЬ НОВЫХ ЗАГРУЗОК. DM Sans (уже грузится приложением)
      несёт заголовки и текст; DM Mono (тоже уже в index.html) — номера
      строк, суммы, подписи, кольцо печати. Эмфаза строится на смене
      семейства и масштаба, не на цвете.
   ═══════════════════════════════════════════════════════════════════════════ */


/* ── Глобальные стили лендинга ─────────────────────────────────────────────
   Один <style> на страницу: keyframes входа, печати и боковые рельсы.
   Классы с префиксом lx-, чтобы не задеть остальное приложение. */
export function LandingStyles() {
  return (
    <style>{`
      .lx-rails { position: relative; }
      @media (min-width: 1240px) {
        .lx-rails::before, .lx-rails::after {
          content: ""; position: absolute; top: 0; bottom: 0; width: 1px;
          background: ${LX.rule};
        }
        .lx-rails::before { left: 0; }
        .lx-rails::after { right: 0; }
      }
      @keyframes lx-enter {
        from { opacity: 0; transform: translateY(14px); }
        to   { opacity: 1; transform: none; }
      }
      .lx-enter { animation: lx-enter .55s ease-out both; }
      .lx-enter-1 { animation-delay: .05s; }
      .lx-enter-2 { animation-delay: .14s; }
      .lx-enter-3 { animation-delay: .23s; }
      @keyframes lx-stamp {
        0%   { opacity: 0; transform: scale(1.4) rotate(var(--lx-rot, -5deg)); }
        55%  { opacity: 1; transform: scale(.94) rotate(var(--lx-rot, -5deg)); }
        100% { opacity: 1; transform: scale(1) rotate(var(--lx-rot, -5deg)); }
      }
      .lx-stamp-hidden { opacity: 0; transform: rotate(var(--lx-rot, -5deg)); }
      .lx-stamp-in { animation: lx-stamp .5s cubic-bezier(.2,.9,.3,1.2) both; }
      @media (prefers-reduced-motion: reduce) {
        .lx-enter, .lx-stamp-in { animation: none; }
        .lx-stamp-hidden { opacity: 1; }
        .lx-anim { transition: none !important; }
      }
      /* Видимый фокус с клавиатуры: по всей странице кольцо латунью на
         бумаге и бумагой на чернилах. Без него навигация табом по
         восьми секциям вслепую. */
      .lx-root :is(a, button):focus-visible {
        outline: 2px solid ${LX.brass};
        outline-offset: 3px;
        border-radius: 6px;
      }
      .lx-ink :is(a, button):focus-visible { outline-color: ${LX.paperOnInk}; }
    `}</style>
  );
}

/* ── Появление в вьюпорте ──────────────────────────────────────────────────
   Единственная скролл-анимация страницы — оттиск печати и счётчики.
   Ковровые fade-up на каждой секции сняты сознательно: одно точное движение
   запоминается лучше двадцати одинаковых. */


const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Число защёлкивается как механический счётчик — один раз, при появлении. */
export function Counter({ target, duration = 1200 }: { target: number; duration?: number }) {
  const { ref, seen } = useInView<HTMLSpanElement>(0.4);
  const [value, setValue] = useState(0);
  // Настройка «уменьшить движение» читается до эффекта.
  //
  // Раньше при включённой настройке эффект делал setValue сразу и синхронно:
  // человек, попросивший систему не двигать картинку, видел кадр с нулём и
  // скачок числа — то есть ровно то движение, от которого отказался.
  const reduced = prefersReducedMotion();
  useEffect(() => {
    if (!seen || reduced) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, reduced, target, duration]);
  return (
    <span ref={ref} style={MONO}>
      {(seen && reduced ? target : value).toLocaleString("ru-RU")}
    </span>
  );
}

/* ── Печать (muhr) ─────────────────────────────────────────────────────────
   Фирменный артефакт направления: круглая латунная печать, как на договоре.
   Появляется оттиском — единственное «грязное» пятно на чистой бумаге.
   Ровно два оттиска на страницу: hero и карточка Pro. */
export function Stamp({
  ring,
  center,
  sub,
  size = 148,
  rotate = -5,
  className,
}: {
  /** Текст по кольцу; повторите с разделителями до полной окружности. */
  ring: string;
  center: string;
  sub?: string;
  size?: number;
  rotate?: number;
  className?: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { ref, seen } = useInView<HTMLDivElement>(0.5);
  const c = size / 2;
  const rText = c - 15;
  // Кольцо растягивается ровно по окружности через textLength.
  //
  // С фиксированным letter-spacing длина строки зависела от языка и размера:
  // узбекская на большом оттиске оставляла пустой сектор в 57°, а на
  // мобильном (126px) обе строки были ДЛИННЕЕ пути, и SVG обрезал глифы
  // посреди слова. Здесь браузер сам подбирает межбуквенный интервал под
  // конкретную строку, поэтому любой язык замыкает круг.
  const ringLength = 2 * Math.PI * rText;
  const ringFont = Math.max(7, size / 16.6);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn("select-none", seen ? "lx-stamp-in" : "lx-stamp-hidden", className)}
      style={{ width: size, height: size, mixBlendMode: "multiply", ["--lx-rot" as string]: `${rotate}deg` }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <path
            id={`lxs${id}`}
            d={`M ${c},${c} m -${rText},0 a ${rText},${rText} 0 1,1 ${rText * 2},0 a ${rText},${rText} 0 1,1 -${rText * 2},0`}
          />
        </defs>
        <circle cx={c} cy={c} r={c - 2} fill="none" stroke={LX.brass} strokeWidth="2.5" opacity="0.9" />
        <circle cx={c} cy={c} r={c - 7} fill="none" stroke={LX.brass} strokeWidth="1" opacity="0.75" />
        <circle cx={c} cy={c} r={c - 27} fill="none" stroke={LX.brass} strokeWidth="1" opacity="0.75" />
        <text
          fill={LX.brass}
          style={{ fontFamily: "'DM Mono', monospace", fontSize: ringFont }}
          opacity="0.92"
        >
          <textPath href={`#lxs${id}`} textLength={ringLength} lengthAdjust="spacing">
            {ring}
          </textPath>
        </text>
        <text
          x={c}
          y={sub ? c + 1 : c + 7}
          textAnchor="middle"
          fill={LX.brass}
          style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: size / 7.4, letterSpacing: 0.5 }}
        >
          {center}
        </text>
        {sub && (
          <text
            x={c}
            y={c + 17}
            textAnchor="middle"
            fill={LX.brass}
            style={{ fontFamily: "'DM Mono', monospace", fontSize: 8.5, letterSpacing: 1.6 }}
            opacity="0.9"
          >
            {sub}
          </text>
        )}
      </svg>
    </div>
  );
}

/* ── Кнопки ────────────────────────────────────────────────────────────────
   Чернильная — единственный сильный элемент; призрачная — контур на
   волосяной линии. Никаких выпуклых теней. */
/**
 * Внешняя ссылка открывается в новой вкладке, якорь на этой же странице — нет.
 *
 * Раньше target="_blank" ставился на любой href, поэтому кнопка героя
 * «Посмотреть интерфейс» с href="#product" открывала копию лендинга в новой
 * вкладке вместо того, чтобы прокрутить к окну продукта.
 */
const linkProps = (href: string) =>
  href.startsWith("#") ? {} : { target: "_blank" as const, rel: "noreferrer" };

export function BtnInk({
  children,
  onClick,
  href,
  className,
  onPaper = true,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  className?: string;
  /** false — кнопка стоит на чернильной зоне и инвертируется в бумагу. */
  onPaper?: boolean;
}) {
  const style: CSSProperties = onPaper
    ? { background: LX.ink, color: LX.paperOnInk }
    : { background: LX.paper, color: LX.ink };
  const cls = cn(
    "lx-anim inline-flex items-center justify-center gap-2.5 h-12 px-7 rounded-[10px]",
    "text-[14px] font-semibold cursor-pointer transition-all duration-200",
    "hover:-translate-y-0.5 active:translate-y-0 hover:shadow-[0_10px_24px_-12px_rgba(38,35,30,0.55)]",
    className,
  );
  if (href)
    return (
      <a href={href} {...linkProps(href)} className={cls} style={style}>
        {children}
      </a>
    );
  return (
    <button type="button" onClick={onClick} className={cls} style={style}>
      {children}
    </button>
  );
}

export function BtnGhost({
  children,
  onClick,
  href,
  className,
  onPaper = true,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  className?: string;
  onPaper?: boolean;
}) {
  const style: CSSProperties = onPaper
    ? { border: `1px solid ${LX.ruleStrong}`, color: LX.ink, background: "transparent" }
    : { border: `1px solid ${LX.ruleOnInk}`, color: LX.paperOnInk, background: "transparent" };
  const cls = cn(
    "lx-anim inline-flex items-center justify-center gap-2.5 h-12 px-7 rounded-[10px]",
    "text-[14px] font-medium cursor-pointer transition-colors duration-200",
    onPaper ? "hover:bg-[#ece9e2]" : "hover:bg-[rgba(240,238,232,0.08)]",
    className,
  );
  if (href)
    return (
      <a href={href} {...linkProps(href)} className={cls} style={style}>
        {children}
      </a>
    );
  return (
    <button type="button" onClick={onClick} className={cls} style={style}>
      {children}
    </button>
  );
}

/* ── Шапка секции: строка реестра ──────────────────────────────────────────
   Моно-индекс + рубрика, волосяная линия дотягивается до правого рельса.
   Номера строк здесь мотивированы: это разлиновка журнала, а не
   декоративные «01/02/03». */
export function SectionHead({
  index,
  label,
  title,
  lead,
  id,
}: {
  index: string;
  label: string;
  title: ReactNode;
  lead?: string;
  id?: string;
}) {
  return (
    <div id={id} data-reveal="head" className="scroll-mt-24">
      <div className="flex items-center gap-4 mb-8">
        <span
          className="text-[11px] uppercase shrink-0"
          style={{ ...MONO, color: LX.brassText, letterSpacing: "0.22em" }}
        >
          {index} / {label}
        </span>
        <span aria-hidden="true" className="h-px flex-1" style={{ background: LX.rule }} />
      </div>
      <h2
        className="font-bold max-w-2xl"
        style={{
          fontSize: "clamp(1.9rem, 3.6vw, 2.9rem)",
          letterSpacing: "-0.03em",
          lineHeight: 1.08,
          color: LX.ink,
        }}
      >
        {title}
      </h2>
      {lead && (
        <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed" style={{ color: LX.inkSoft }}>
          {lead}
        </p>
      )}
    </div>
  );
}

/* ── Аккордеон на линовке ────────────────────────────────────────────────── */
export function Accordion({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(0);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <div style={{ borderTop: `1px solid ${LX.rule}` }}>
      {items.map((item, i) => (
        <div key={item.q} style={{ borderBottom: `1px solid ${LX.rule}` }}>
          <button
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
            aria-controls={`lxfaq${uid}-${i}`}
            id={`lxfaqb${uid}-${i}`}
            className="w-full flex items-baseline gap-5 py-5 text-left cursor-pointer group"
          >
            <span
              className="text-[11px] shrink-0 w-6"
              style={{ ...MONO, color: open === i ? LX.brassText : LX.inkFaint }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span
              className="text-[15px] font-medium flex-1 transition-colors"
              style={{ color: LX.ink }}
            >
              {item.q}
            </span>
            <span
              aria-hidden="true"
              className="text-[15px] shrink-0 transition-transform duration-300"
              style={{ ...MONO, color: LX.inkFaint, transform: open === i ? "rotate(45deg)" : "none" }}
            >
              +
            </span>
          </button>
          {/*
            aria-hidden на свёрнутой панели обязателен: приём с
            grid-template-rows: 0fr прячет ответ только геометрически, а
            в дереве доступности он остаётся — скринридер зачитывал все шесть
            ответов подряд, прямо противореча aria-expanded="false".
          */}
          <div
            id={`lxfaq${uid}-${i}`}
            role="region"
            aria-labelledby={`lxfaqb${uid}-${i}`}
            aria-hidden={open !== i}
            className="grid transition-[grid-template-rows] duration-300 lx-anim"
            style={{ gridTemplateRows: open === i ? "1fr" : "0fr" }}
          >
            <div className="overflow-hidden">
              <p className="pb-6 pl-11 pr-8 text-[14px] leading-relaxed max-w-2xl" style={{ color: LX.inkSoft }}>
                {item.a}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
