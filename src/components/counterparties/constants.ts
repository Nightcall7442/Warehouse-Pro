/* ── Оформление раздела «Контрагенты и долги» ──────────────────────────────
 *
 * Те же значения, что в src/components/shops/constants.ts. Раздел живёт
 * вкладкой внутри страницы «Приходы» и обязан выглядеть её продолжением, а
 * не вставкой из другого продукта.
 */
export const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };

export const COLORS = {
  primary: "var(--color-primary)",
  primaryText: "var(--color-primary-text)",
  success: "var(--color-success)",
  successText: "var(--color-success-text)",
  warning: "var(--color-warning)",
  warningText: "var(--color-warning-text)",
  danger: "var(--color-danger)",
  dangerText: "var(--color-danger-text)",
  surface: "var(--color-surface, #efedea)",
  surfaceLight: "var(--color-surface-light, #f6f4f0)",
  textPrimary: "var(--color-text-primary, #2b2a28)",
  textSecondary: "var(--color-text-secondary, #5e5b54)",
  textTertiary: "var(--color-text-tertiary, #6b6760)",
  border: "var(--color-border, #d8d5cd)",
};

export const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

/**
 * Деньги печатаются с явной валютой, а не через useCurrency().
 *
 * fmt() из useCurrency подставляет валюту организации — для долга это было бы
 * враньём: счёт от завода бывает долларовым, и «120 000 сум» вместо
 * «120 000 USD» это не оформление, а неверное число в документе, который
 * везут на сверку.
 */
export function money(amount: number, currency: string): string {
  return `${Number(amount ?? 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ${currency}`;
}

/** Подписи способов оплаты — одни на весь раздел. */
export const PAYMENT_METHODS: Record<string, { ru: string; uz: string }> = {
  cash:     { ru: "Наличные", uz: "Naqd" },
  card:     { ru: "Карта",    uz: "Karta" },
  transfer: { ru: "Перевод",  uz: "O'tkazma" },
};
