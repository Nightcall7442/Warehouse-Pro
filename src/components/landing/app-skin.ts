import type { CSSProperties } from "react";

/**
 * Оформление НАСТОЯЩЕГО приложения — для демо-экранов на лендинге.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Раньше окно продукта было нарисовано палитрой самого лендинга: плоские
 * карточки со скруглением 8, тонкой рамкой и латунным акцентом. Приложение
 * при этом выглядит совсем иначе — неоморфно: скругление 24, двойная тень
 * (тёмная снизу-справа и светлая сверху-слева), поверхность #efedea и
 * сине-серый акцент #5b6d8a.
 *
 * Человек, который видел демо и потом зашёл внутрь, попадал в другую
 * программу. Хуже того — обещание «интерфейс без прикрас» рядом с рисунком,
 * не совпадающим с продуктом, работает против доверия ровно как выдуманный
 * отзыв.
 *
 * ── Откуда числа ────────────────────────────────────────────────────────────
 *
 * Скопированы из src/index.css: светлая тема (:root) и класс .neo-card /
 * .kpi-hero. Не переменными: демо стоит внутри тёмного блока лендинга, где
 * тема страницы своя, и var(--color-surface) взял бы не то значение.
 */
export const APP = {
  surface:      "#efedea",
  surfaceLight: "#f6f4f0",
  border:       "#d8d5cd",
  textPrimary:  "#2b2a28",
  textSecondary:"#5e5b54",
  textTertiary: "#6b6760",
  primary:      "#5b6d8a",
  /** Фон страницы приложения. Светлее его — карточка; на этой разнице она и
      читается. Панель демо раньше была того же цвета, что карточки, и они
      сливались с подложкой. */
  canvas:       "#e8e6e1",
  success:      "#34c473",
  danger:       "#d45050",
  /** Та же тень, что у .neo-card в приложении. */
  raised: "8px 8px 20px rgba(160,152,140,0.38), -8px -8px 20px rgba(255,255,255,0.55)",
  /** Уменьшённая — для мелких карточек внутри демо, чтобы не давила. */
  raisedSm: "4px 4px 10px rgba(160,152,140,0.30), -4px -4px 10px rgba(255,255,255,0.55)",
  /** Числа в приложении набраны DM Sans, а не моноширинным. */
  num: {
    fontFamily: "'DM Sans', system-ui, sans-serif",
    fontVariantNumeric: "tabular-nums",
  },
  /** Подписи над значениями: те же прописные, но шрифтом продукта. */
  label: {
    fontFamily: "'DM Sans', system-ui, sans-serif",
    letterSpacing: "0.1em",
  },
} as const;

/** Карточка приложения. Радиус в демо чуть меньше боевых 24: окно уменьшено. */
export function appCard(padding = 16): CSSProperties {
  return {
    background: APP.surface,
    borderRadius: 18,
    padding,
    boxShadow: APP.raisedSm,
    border: "1px solid rgba(255,255,255,0.6)",
    position: "relative",
    overflow: "hidden",
  };
}

/** Светлая полоска по верхнему краю — как ::before у .kpi-hero. */
export const appCardSheen: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: 1,
  background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)",
};
