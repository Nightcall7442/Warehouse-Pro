import type React from "react";

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

export const PAYMENT_MAP: Record<string, { label: string; color: string }> = {
  cash:     { label: "Наличные",     color: "var(--color-success-text)" },
  transfer: { label: "Перечисление", color: "var(--color-primary-text)" },
  debt:     { label: "Долг",         color: "var(--color-warning-text)" },
  card:     { label: "Карта",        color: "#9b59b6" },
};

export type TabKey = "overview" | "sales" | "agents" | "agentProducts";

export const thStyle: React.CSSProperties = {
  fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.08em", color: COLORS.textTertiary, padding: "12px 16px",
  borderBottom: `1px solid ${COLORS.border}`, textAlign: "left",
};

export const tdStyle: React.CSSProperties = {
  padding: "14px 16px", borderBottom: `1px solid ${COLORS.border}`,
  fontSize: "14px", fontFamily: F.body, color: COLORS.textPrimary,
};
