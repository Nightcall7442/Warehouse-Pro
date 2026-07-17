import React from "react";

export const F = {
  display: "'DM Sans', -apple-system, sans-serif",
  body: "'DM Sans', -apple-system, sans-serif",
};

export const COLORS = {
  primary: "#5b6d8a",
  success: "#34c473",
  warning: "#d4973a",
  danger: "#d45050",
  surface: "var(--color-surface, #ffffff)",
  surfaceLight: "var(--color-surface-light, #f0f3f8)",
  textPrimary: "var(--color-text-primary, #2b3450)",
  textSecondary: "var(--color-text-secondary, #6a7290)",
  textTertiary: "var(--color-text-tertiary, #98a0b8)",
  border: "var(--color-border, #f0f3f8)",
};

export const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

export const thStyle: React.CSSProperties = {
  fontFamily: F.display,
  fontSize: "10px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: COLORS.textTertiary,
  padding: "12px 16px",
  borderBottom: `1px solid ${COLORS.border}`,
  textAlign: "left",
};

export const tdStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderBottom: `1px solid ${COLORS.border}`,
  fontSize: "14px",
  fontFamily: F.body,
  color: COLORS.textPrimary,
};

export const PAYMENT_COLORS: Record<string, string> = {
  cash: "#34c473",
  transfer: "#5b6d8a",
  debt: "#d4973a",
  card: "#9b59b6",
};

export const PAYMENT_LABELS: Record<string, { ru: string; uz: string }> = {
  cash: { ru: "Наличные", uz: "Naqd" },
  transfer: { ru: "Перечисление", uz: "O'tkazma" },
  debt: { ru: "Долг", uz: "Qarz" },
  card: { ru: "Карта", uz: "Plastik karta" },
};
