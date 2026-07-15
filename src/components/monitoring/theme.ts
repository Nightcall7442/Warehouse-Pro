// ── Premium design tokens ─────────────────────────────────────────────────────
export const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };

export const COLORS = {
  primary: "#4b6cf6", success: "#34c473",
  warning: "#e8a830", danger: "#e85050",
  surface: "var(--color-surface, #ffffff)", surfaceLight: "var(--color-surface-light, #f0f3f8)",
  textPrimary: "var(--color-text-primary, #2b3450)", textSecondary: "var(--color-text-secondary, #6a7290)",
  textTertiary: "var(--color-text-tertiary, #98a0b8)", border: "var(--color-border, #f0f3f8)",
  info: "#60a5fa",
};

export const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

// ── Helpers ──────────────────────────────────────────────────────────────────
export function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}с назад`;
  if (sec < 3600) return `${Math.floor(sec / 60)}м назад`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}ч назад`;
  return `${Math.floor(sec / 86400)}д назад`;
}

export function statusColor(code: number): string {
  if (code >= 500) return COLORS.danger;
  if (code >= 400) return COLORS.warning;
  return COLORS.success;
}
