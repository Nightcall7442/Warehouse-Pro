import { memo } from "react";
import { kpiTint, kpiAccent } from "@/lib/kpi-tint";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { colorMix } from "@/lib/color-mix";

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

/* ─── Premium KpiCard ─── */
export function KpiCard({ label, value, delta, icon, gradient, delay }: {
  label: string; value: string; delta: number | null;
  icon: React.ReactNode; gradient: string; delay: number;
}) {
  const isPositive = delta !== null && delta > 0;
  const isNegative = delta !== null && delta < 0;
  return (
    <div className="kpi-hero" style={{
      borderRadius: "24px", padding: "24px",
      position: "relative", overflow: "hidden",
      animation: `slideUp ${0.5 + delay}s ease forwards`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>
          {label}
        </span>
        <div className="kpi-tile" style={{ background: kpiTint(gradient), color: kpiAccent(gradient) }}>
          {icon}
        </div>
      </div>
      <div style={{ fontFamily: F.display, fontSize: "32px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, letterSpacing: "-0.03em" }}>
        {value}
      </div>
      {delta !== null && (
        <div style={{
          display: "flex", alignItems: "center", gap: "4px", marginTop: "10px",
          fontSize: "12px", fontWeight: 600, fontFamily: F.body,
          color: isPositive ? "var(--color-success-text)" : isNegative ? "var(--color-danger-text)" : COLORS.textTertiary,
        }}>
          {isPositive ? <ArrowUpRight size={14} /> : isNegative ? <ArrowDownRight size={14} /> : <Minus size={14} />}
          {Math.abs(delta).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

/* ─── Status Badge — pill with a colored dot, per the status color table above ─── */
export const StatusBadge = memo(function StatusBadge({ status, lang }: { status: string; lang: "ru" | "uz" }) {
  const s = STATUS[status] ?? STATUS.new;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "6px",
      padding: "4px 10px", borderRadius: "9999px", fontSize: "11px", fontWeight: 500,
      fontFamily: F.body, border: `1px solid ${colorMix(s.dot, 15)}`,
      background: colorMix(s.dot, 8), color: s.dot,
    }}>
      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: s.dot, flexShrink: 0 }} />
      {lang === "uz" ? s.uz : s.ru}
    </span>
  );
});

/**
 * Small labeled card — the standard container for a block of related fields.
 *
 * Uses `neo-card-sm` so an Orders panel reads as the same product as the
 * Arrivals and Products screens, which have used the neumorphic system all
 * along. This component and PillButton below are shared by every Orders
 * surface, so styling them here is what carries the change across the feature
 * rather than each screen restyling itself.
 */
export function InfoCard({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="neo-card-sm" style={{ padding: "14px", borderRadius: "16px" }}>
      {label && (
        <p style={{
          display: "flex", alignItems: "center", gap: "4px", marginBottom: "4px",
          fontFamily: F.body, fontSize: "10px", fontWeight: 600, letterSpacing: "0.06em",
          textTransform: "uppercase", color: COLORS.textTertiary,
        }}>
          {icon} {label}
        </p>
      )}
      {children}
    </div>
  );
}

/**
 * The standard action button across order screens.
 *
 * Built on `neo-btn` / `neo-btn-primary` so it carries the same shape, shadow
 * and press response as buttons on every other page. Only the tones that need
 * a colour the base classes don't provide (success, danger) add anything on
 * top; "primary" is the base class untouched, which is what keeps the brass
 * accent consistent when the theme changes it.
 */
export function PillButton({ onClick, disabled, tone = "neutral", type, children }: {
  onClick?: () => void; disabled?: boolean; tone?: "primary" | "success" | "neutral" | "ghost" | "danger";
  type?: "button" | "submit"; children: React.ReactNode;
}) {
  const className = tone === "primary" || tone === "success" ? "neo-btn-primary" : "neo-btn";
  const tint: Record<string, React.CSSProperties> = {
    primary: {},
    success: { background: "linear-gradient(135deg, var(--color-success), #28a862)", color: "#fff" },
    danger:  { color: COLORS.dangerText },
    neutral: {},
    ghost:   { background: "transparent", boxShadow: "none", color: COLORS.textSecondary },
  };
  return (
    <button
      type={type ?? "button"}
      onClick={onClick}
      disabled={disabled}
      className={className}
      style={{ height: "40px", ...tint[tone] }}
    >
      {children}
    </button>
  );
}
