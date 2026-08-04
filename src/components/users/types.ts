/* ── Premium design tokens ─────────────────────────────────────────────────── */
export const F = {
  display: "'DM Sans', -apple-system, sans-serif",
  body: "'DM Sans', -apple-system, sans-serif",
};

export const COLORS = {
  primary: "var(--color-primary)",
  // Accent-coloured *text* (a price, a code, a link). The fill colour above
  // is a hair under 4.5:1 as text on a light card, so semantic text uses
  // this darker sibling instead. See --color-primary-text in index.css.
  primaryText: "var(--color-primary-text)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
  surface: "var(--color-surface, #efedea)",
  surfaceLight: "var(--color-surface-light, #f6f4f0)",
  textPrimary: "var(--color-text-primary, #2b2a28)",
  textSecondary: "var(--color-text-secondary, #5e5b54)",
  textTertiary: "var(--color-text-tertiary, #6b6760)",
  border: "var(--color-border, #d8d5cd)",
};

export const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

/* ── Role config ───────────────────────────────────────────────────────────── */
export const ROLE_COLORS: Record<string, string> = {
  ceo:          "bg-primary/15 text-primary border-primary/30",
  operator:     "bg-info/15 text-info border-info/30",
  agent:        "bg-success/15 text-success border-success/30",
  supervisor:   "bg-warning/15 text-warning border-warning/30",
  merchandiser: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  courier:      "bg-orange-500/15 text-orange-400 border-orange-500/30",
};

export const ROLE_LABELS: Record<string, { ru: string; uz: string }> = {
  ceo:          { ru: "CEO",            uz: "CEO"            },
  operator:     { ru: "Оператор",       uz: "Operator"       },
  agent:        { ru: "Агент",          uz: "Agent"          },
  supervisor:   { ru: "Супервайзер",    uz: "Supervisor"     },
  merchandiser: { ru: "Мерчандайзер",   uz: "Merchandayzer"  },
  courier:      { ru: "Доставщик",      uz: "Yetkazib beruvchi" },
};

/* ── Table styles ──────────────────────────────────────────────────────────── */
export const thStyle: React.CSSProperties = {
  fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.08em", color: COLORS.textTertiary, padding: "12px 16px",
  borderBottom: `1px solid ${COLORS.border}`, textAlign: "left",
};

export const tdStyle: React.CSSProperties = {
  padding: "14px 16px", borderBottom: `1px solid ${COLORS.border}`,
  fontSize: "14px", fontFamily: F.body, color: COLORS.textPrimary,
};

/* ── User type ─────────────────────────────────────────────────────────────── */
export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
  lastSignInAt?: string | null;
}

export type Lang = "ru" | "uz";
