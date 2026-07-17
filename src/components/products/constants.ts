export const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };
export const COLORS = {
  primary: "#5b6d8a", success: "#34c473",
  warning: "#d4973a", danger: "#d45050",
  surface: "var(--color-surface, #ffffff)", surfaceLight: "var(--color-surface-light, #f0f3f8)",
  textPrimary: "var(--color-text-primary, #2b3450)", textSecondary: "var(--color-text-secondary, #6a7290)",
  textTertiary: "var(--color-text-tertiary, #98a0b8)", border: "var(--color-border, #f0f3f8)",
};
export const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

export const UNITS = [
  { value: "kg",   ru: "кг",       uz: "kg" },
  { value: "l",    ru: "литр",     uz: "litr" },
  { value: "pcs",  ru: "штук",     uz: "dona" },
  { value: "box",  ru: "ящик",     uz: "quti" },
  { value: "pack", ru: "упаковка", uz: "pachka" },
  { value: "m",    ru: "метр",     uz: "metr" },
];

export const unitLabel = (u: string | undefined, lang: string) => {
  const e = UNITS.find(x => x.value === u);
  return e ? (lang === "uz" ? e.uz : e.ru) : (u ?? "шт");
};
