import { differenceInDays } from "date-fns";

// ── Design tokens ───────────────────────────────────────────────────────────
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
  info: "#60a5fa",
};
export const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

// ── Types ───────────────────────────────────────────────────────────────────
export type TenantRow = {
  id: number; name: string; slug: string;
  plan: string; status: string; createdAt: Date;
  trialEndsAt?: Date | null; planExpiresAt?: Date | null;
  ownerEmail?: string | null;
  userCount: number; orderCount: number; orderTotal: number;
};

// ── Helpers ─────────────────────────────────────────────────────────────────
export function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

export function money(n: number): string {
  return new Intl.NumberFormat("ru").format(Math.round(n));
}

export function planStatus(t: TenantRow): { label: string; color: string } {
  if (t.trialEndsAt) {
    const d = differenceInDays(new Date(t.trialEndsAt), new Date());
    if (d < 0) return { label: "Trial истёк", color: COLORS.danger };
    return { label: `Trial ${d}д.`, color: d < 3 ? COLORS.warning : COLORS.info };
  }
  const expires = t.planExpiresAt ? new Date(t.planExpiresAt) : null;
  if (!expires) return { label: "Без лимита", color: COLORS.textSecondary };
  const d = differenceInDays(expires, new Date());
  if (d < 0) return { label: "Истёк", color: COLORS.danger };
  return { label: `${d} дн.`, color: d < 7 ? COLORS.warning : COLORS.success };
}

export const PLAN_COLORS: Record<string, { fg: string; bg: string }> = {
  trial:     { fg: "#94a3b8",    bg: "rgba(148,163,184,0.12)" },
  pro:       { fg: "var(--color-success)",    bg: "rgba(74,222,128,0.12)" },
  exclusive: { fg: "#a78bfa",    bg: "rgba(167,139,250,0.12)" },
};

export const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  active:    { fg: "var(--color-success)",    bg: "rgba(74,222,128,0.12)" },
  suspended: { fg: "var(--color-danger)",    bg: "rgba(232,80,80,0.12)" },
};
