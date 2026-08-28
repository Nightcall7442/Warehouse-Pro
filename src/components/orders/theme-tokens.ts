/**
 * Оформление экрана заказов: цвета, тени, подписи статусов и способов оплаты.
 *
 * Вынесено из theme.tsx, где лежало вперемешку с компонентами. Пока в одном
 * файле и то и другое, горячая перезагрузка при правке не может обновить
 * экран без полной перезагрузки страницы — а с ней теряются открытые окна и
 * наполовину заполненные формы.
 */
/**
 * Shared design tokens for the Orders surface (page, slide-over, modals,
 * kanban). Lifted from the original "Premium Design" pass on Orders.tsx
 * (pre-dates the Mimo-era components) so every order-related screen speaks
 * the same visual language instead of each new component inventing its own.
 */
export const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };

export const COLORS = {
  // Reads the themed accent so the dark palette isn't stuck with the light one.
  primary: "var(--color-primary)",
  // Accent-coloured *text* (a price, a code, a link). The fill colour above
  // is a hair under 4.5:1 as text on a light card, so semantic text uses
  // this darker sibling instead. See --color-primary-text in index.css.
  primaryText: "var(--color-primary-text)",
  onPrimary: "var(--color-text-inverse, #ffffff)",
  primarySubtle: "var(--color-primary-subtle)",
  success: "var(--color-success)",
  warning: "var(--color-warning)", danger: "var(--color-danger)",
  // Same fill-vs-text split as primary above: the fill colours are too pale
  // to read as text on a light card.
  successText: "var(--color-success-text)",
  warningText: "var(--color-warning-text)",
  dangerText: "var(--color-danger-text)",
  surface: "var(--color-surface, #efedea)", surfaceLight: "var(--color-surface-light, #f6f4f0)",
  textPrimary: "var(--color-text-primary, #2b2a28)", textSecondary: "var(--color-text-secondary, #5e5b54)",
  textTertiary: "var(--color-text-tertiary, #6b6760)", border: "var(--color-border, #d8d5cd)",
};

export const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

/** Statuses where the goods have not been handed over yet — these can still be completed. */
export const OPEN_STATUSES = ["new", "processing", "shipped", "pending"];

export const PAYMENT: Record<string, { ru: string; uz: string; color: string }> = {
  cash:     { ru: "Наличные",     uz: "Naqd",      color: "var(--color-success-text)" },
  transfer: { ru: "Перечисление", uz: "O'tkazma",  color: "var(--color-primary-text)" },
  debt:     { ru: "Долг",         uz: "Qarz",      color: "var(--color-warning-text)" },
  card:     { ru: "Карта",        uz: "Plastik",   color: "#9b59b6" },
};

export const STATUS: Record<string, { ru: string; uz: string; dot: string; bg: string; text: string; border: string }> = {
  new:                  { ru: "Новый",            uz: "Yangi",                   dot: "var(--color-primary)", bg: "bg-info/10",    text: "text-info",    border: "border-info/25" },
  processing:           { ru: "В обработке",      uz: "Jarayonda",               dot: "var(--color-warning)", bg: "bg-warning/10", text: "text-warning", border: "border-warning/25" },
  shipped:              { ru: "Отгружён",         uz: "Yuklandi",                dot: "#9b59b6", bg: "bg-purple-100", text: "text-purple-600", border: "border-purple-200" },
  pending:              { ru: "В ожидании",       uz: "Kutishda",                dot: "#f09050", bg: "bg-orange-100", text: "text-orange-600", border: "border-orange-200" },
  delivered:            { ru: "Доставлен",        uz: "Yetkazildi",              dot: "var(--color-success)", bg: "bg-success/10", text: "text-success", border: "border-success/25" },
  cancelled:            { ru: "Отменён",          uz: "Bekor qilindi",           dot: "var(--color-danger)", bg: "bg-danger/10",  text: "text-danger",  border: "border-danger/25" },
  returned:             { ru: "Возврат",          uz: "Qaytarildi",              dot: "#e85050", bg: "bg-red-100",    text: "text-red-600", border: "border-red-200" },
};
