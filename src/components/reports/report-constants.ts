import type React from "react";

export const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };

export const COLORS = {
  primary: "var(--color-primary)",
  // Accent-coloured *text* (a price, a code, a link). The fill colour above
  // is a hair under 4.5:1 as text on a light card, so semantic text uses
  // this darker sibling instead. See --color-primary-text in index.css.
  primaryText: "var(--color-primary-text)", success: "var(--color-success)",
  warning: "var(--color-warning)", danger: "var(--color-danger)",
  successText: "var(--color-success-text)", dangerText: "var(--color-danger-text)",
  surface: "var(--color-surface, #efedea)", surfaceLight: "var(--color-surface-light, #f6f4f0)",
  textPrimary: "var(--color-text-primary, #2b2a28)", textSecondary: "var(--color-text-secondary, #5e5b54)",
  textTertiary: "var(--color-text-tertiary, #6b6760)", border: "var(--color-border, #d8d5cd)",
};

export const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

export const PAYMENT_MAP: Record<string, { label: string; color: string }> = {
  cash:     { label: "Наличные",     color: "var(--color-success-text)" },
  transfer: { label: "Перечисление", color: "var(--color-primary-text)" },
  debt:     { label: "Долг",         color: "var(--color-warning-text)" },
  // Здесь стояло «#9b59b6» — фиолетовый, которого нет ни в палитре
  // приложения, ни у арендатора. У арендатора со светлым фирменным цветом
  // соседние три метки перекрашивались, а эта оставалась чужой.
  card:     { label: "Карта",        color: "var(--kpi-purple)" },
};

export type TabKey = "overview" | "sales" | "agents" | "agentProducts" | "all";

export const thStyle: React.CSSProperties = {
  fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.08em", color: COLORS.textTertiary, padding: "12px 16px",
  borderBottom: `1px solid ${COLORS.border}`, textAlign: "left",
  // Заголовок не переносится: «Заказов на визит» в три строки растягивал шапку
  // выше самих строк таблицы. Ширину колонке даёт minWidth таблицы, а лишнее
  // уезжает в горизонтальную прокрутку.
  whiteSpace: "nowrap",
};

export const tdStyle: React.CSSProperties = {
  padding: "14px 16px", borderBottom: `1px solid ${COLORS.border}`,
  fontSize: "14px", fontFamily: F.body, color: COLORS.textPrimary,
};

/**
 * Ширина, ниже которой таблица едет вбок, а не сминается.
 *
 * Владелец работает на ноутбуке 1280. С открытым боковым меню на таблицу
 * остаётся около 950 точек, и пятиколоночная таблица там укладывалась за счёт
 * названий товаров: «Печенье овсяное клас…» в две строки и код, обрезанный до
 * неузнаваемости. Обёртка с overflowX уже стояла везде, но прокручивать было
 * нечего — без минимальной ширины таблица всегда «помещается».
 */
export const tableMinWidth = "720px";

/** Сравнение с предыдущим периодом: на сколько процентов и в какую сторону. */
export interface Delta {
  /** Проценты со знаком. */
  pct: number;
  previous: number;
}

/**
 * Изменение к прошлому периоду — или его отсутствие.
 *
 * Возвращает null там, где сравнивать не с чем: в прошлом периоде было ноль
 * (рост «на бесконечность процентов» — не ответ) или данные за него не
 * приехали. Ноль и «неизвестно» на экране должны выглядеть по-разному:
 * «0 %» читается как «не изменилось», а это неправда.
 */
export function delta(current: number, previous: number | null | undefined): Delta | null {
  if (previous === null || previous === undefined || previous === 0) return null;
  return { pct: ((current - previous) / Math.abs(previous)) * 100, previous };
}
