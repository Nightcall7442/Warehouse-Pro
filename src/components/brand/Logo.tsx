import { useId } from "react";

/* ═══════════════════════════════════════════════════════════════════════════
   Знак Warehouse Pro.

   Сложенная лента «W» — она же гофрокартон, она же ломаная графика продаж, она
   же маршрут. Янтарная точка сверху справа — прибытие.

   ── Почему идентификаторы градиентов вычисляются ───────────────────────────

   В исходных файлах они записаны как "wpDown" и "wpUp". В HTML идентификатор
   обязан быть единственным на странице, а знак стоит и в шапке, и в подвале, и
   на экране входа. При совпадении браузер отдаёт ВСЕМ ссылкам первый найденный
   градиент: знак в подвале перекрашивается в цвета шапки, а если первый узел
   удалить из разметки, остальные теряют заливку совсем.

   useId даёт разное имя каждому появлению, и такого столкновения не будет.
   ═══════════════════════════════════════════════════════════════════════════ */

type MarkProps = {
  /** Сторона в точках. Знак квадратный. */
  size?: number;
  className?: string;
  /** На тёмном фоне лента светлее, иначе теряется. */
  onDark?: boolean;
  /** Знак декоративный, когда рядом уже написано название. */
  decorative?: boolean;
};

export function LogoMark({ size = 32, className, onDark = false, decorative = false }: MarkProps) {
  const uid = useId().replace(/:/g, "");
  const down = `wpD-${uid}`;
  const up = `wpU-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : "Warehouse Pro"}
    >
      <defs>
        <linearGradient id={down} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor={onDark ? "#14b8a6" : "#0d9488"} />
          <stop offset="1" stopColor={onDark ? "#0d9488" : "#0f766e"} />
        </linearGradient>
        <linearGradient id={up} x1="0" y1="1" x2="0.35" y2="0">
          <stop offset="0" stopColor={onDark ? "#2dd4bf" : "#14b8a6"} />
          <stop offset="1" stopColor={onDark ? "#5eead4" : "#2dd4bf"} />
        </linearGradient>
      </defs>
      <polygon points="2,24 18,24 38,80 22,80" fill={`url(#${down})`} />
      <polygon points="22,80 38,80 58,42 42,42" fill={`url(#${up})`} />
      <polygon points="42,42 58,42 78,80 62,80" fill={`url(#${down})`} />
      <polygon points="62,80 78,80 98,24 82,24" fill={`url(#${up})`} />
      {/* Точка прибытия */}
      <circle cx="90" cy="12" r="5.5" fill={onDark ? "#fbbf24" : "#d97706"} />
    </svg>
  );
}

type WordmarkProps = {
  /** Высота знака; надпись подбирается под неё. */
  size?: number;
  className?: string;
  onDark?: boolean;
};

/**
 * Знак вместе с названием.
 *
 * Надпись — настоящий текст, а не контуры: её читает поиск, её выделяют, она
 * подхватывает шрифт приложения и не мылится при увеличении.
 */
export function LogoWordmark({ size = 32, className, onDark = false }: WordmarkProps) {
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: size * 0.34 }}>
      <LogoMark size={size} onDark={onDark} decorative />
      <span
        style={{
          fontFamily: "'DM Sans', system-ui, sans-serif",
          fontWeight: 700,
          fontSize: size * 0.5,
          letterSpacing: "-0.02em",
          color: onDark ? "#f0ece6" : "#2b2a28",
          whiteSpace: "nowrap",
        }}
      >
        Warehouse <span style={{ color: onDark ? "#2dd4bf" : "#0d9488" }}>Pro</span>
      </span>
    </span>
  );
}
