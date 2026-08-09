export const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };
export const COLORS = {
  primary: "var(--color-primary)",
  // Accent-coloured *text* (a price, a code, a link). The fill colour above
  // is a hair under 4.5:1 as text on a light card, so semantic text uses
  // this darker sibling instead. See --color-primary-text in index.css.
  primaryText: "var(--color-primary-text)", success: "var(--color-success)",
  warning: "var(--color-warning)", danger: "var(--color-danger)",
  surface: "var(--color-surface, #efedea)", surfaceLight: "var(--color-surface-light, #f6f4f0)",
  textPrimary: "var(--color-text-primary, #2b2a28)", textSecondary: "var(--color-text-secondary, #5e5b54)",
  textTertiary: "var(--color-text-tertiary, #6b6760)", border: "var(--color-border, #d8d5cd)",
};
export const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

export const UNITS = [
  { value: "kg",   ru: "кг",       uz: "kg" },
  { value: "l",    ru: "литр",     uz: "litr" },
  { value: "pcs",  ru: "штук",     uz: "dona" },
  { value: "box",  ru: "ящик",     uz: "quti" },
  { value: "pack", ru: "упаковка", uz: "pachka" },
  { value: "m",     ru: "метр",     uz: "metr" },
  { value: "block", ru: "блок",     uz: "blok" },
];

export const unitLabel = (u: string | undefined, lang: string) => {
  const e = UNITS.find(x => x.value === u);
  return e ? (lang === "uz" ? e.uz : e.ru) : (u ?? "шт");
};
