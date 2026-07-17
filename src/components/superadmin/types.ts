import { differenceInDays } from "date-fns";

// ── Design tokens ───────────────────────────────────────────────────────────
export const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };
export const COLORS = {
  primary: "#5b6d8a", success: "#34c473",
  warning: "#d4973a", danger: "#d45050",
  surface: "var(--color-surface, #ffffff)", surfaceLight: "var(--color-surface-light, #f0f3f8)",
  textPrimary: "var(--color-text-primary, #2b3450)", textSecondary: "var(--color-text-secondary, #6a7290)",
  textTertiary: "var(--color-text-tertiary, #98a0b8)", border: "var(--color-border, #f0f3f8)",
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
  basic:     { fg: "#60a5fa",    bg: "rgba(96,165,250,0.12)" },
  pro:       { fg: "#34c473",    bg: "rgba(74,222,128,0.12)" },
  exclusive: { fg: "#a78bfa",    bg: "rgba(167,139,250,0.12)" },
};

export const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  active:    { fg: "#34c473",    bg: "rgba(74,222,128,0.12)" },
  suspended: { fg: "#d45050",    bg: "rgba(232,80,80,0.12)" },
};
