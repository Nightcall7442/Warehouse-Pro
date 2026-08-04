import { memo } from "react";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

/**
 * Shared design tokens for the Orders surface (page, slide-over, modals,
 * kanban). Lifted from the original "Premium Design" pass on Orders.tsx
 * (pre-dates the Mimo-era components) so every order-related screen speaks
 * the same visual language instead of each new component inventing its own.
 */
export const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };

export const COLORS = {
  primary: "#5b6d8a", success: "#34c473",
  warning: "#d4973a", danger: "#d45050",
  surface: "var(--color-surface, #ffffff)", surfaceLight: "var(--color-surface-light, #f0f3f8)",
  textPrimary: "var(--color-text-primary, #2b3450)", textSecondary: "var(--color-text-secondary, #6a7290)",
  textTertiary: "var(--color-text-tertiary, #98a0b8)", border: "var(--color-border, #f0f3f8)",
};

export const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

/** Statuses where the goods have not been handed over yet — these can still be completed. */
export const OPEN_STATUSES = ["new", "processing", "shipped", "pending"];

export const PAYMENT: Record<string, { ru: string; uz: string; color: string }> = {
  cash:     { ru: "Наличные",     uz: "Naqd",      color: "#34c473" },
  transfer: { ru: "Перечисление", uz: "O'tkazma",  color: "#5b6d8a" },
  debt:     { ru: "Долг",         uz: "Qarz",      color: "#d4973a" },
  card:     { ru: "Карта",        uz: "Plastik",   color: "#9b59b6" },
};

export const STATUS: Record<string, { ru: string; uz: string; dot: string; bg: string; text: string; border: string }> = {
  new:                  { ru: "Новый",            uz: "Yangi",                   dot: "#5b6d8a", bg: "bg-info/10",    text: "text-info",    border: "border-info/25" },
  processing:           { ru: "В обработке",      uz: "Jarayonda",               dot: "#d4973a", bg: "bg-warning/10", text: "text-warning", border: "border-warning/25" },
  shipped:              { ru: "Отгружён",         uz: "Yuklandi",                dot: "#9b59b6", bg: "bg-purple-100", text: "text-purple-600", border: "border-purple-200" },
  pending:              { ru: "В ожидании",       uz: "Kutishda",                dot: "#f09050", bg: "bg-orange-100", text: "text-orange-600", border: "border-orange-200" },
  delivered:            { ru: "Доставлен",        uz: "Yetkazildi",              dot: "#34c473", bg: "bg-success/10", text: "text-success", border: "border-success/25" },
  cancelled:            { ru: "Отменён",          uz: "Bekor qilindi",           dot: "#d45050", bg: "bg-danger/10",  text: "text-danger",  border: "border-danger/25" },
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
        <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
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
          color: isPositive ? "#34c473" : isNegative ? "#d45050" : COLORS.textTertiary,
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
      fontFamily: F.body, border: `1px solid ${s.dot}25`,
      background: `${s.dot}15`, color: s.dot,
    }}>
      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: s.dot, flexShrink: 0 }} />
      {lang === "uz" ? s.uz : s.ru}
    </span>
  );
});

/** Small labeled card — the standard container for a block of related fields. */
export function InfoCard({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ padding: "12px", borderRadius: "12px", background: COLORS.surfaceLight }}>
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

/** Pill button — the standard action button across order screens. */
export function PillButton({ onClick, disabled, tone = "neutral", type, children }: {
  onClick?: () => void; disabled?: boolean; tone?: "primary" | "success" | "neutral" | "ghost" | "danger";
  type?: "button" | "submit"; children: React.ReactNode;
}) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: `linear-gradient(135deg, ${COLORS.primary}, #7b94f8)`, color: "#fff", border: "none" },
    success: { background: "linear-gradient(135deg, #34c473, #28a862)", color: "#fff", border: "none" },
    danger:  { background: `${COLORS.danger}12`, color: COLORS.danger, border: `1px solid ${COLORS.danger}30` },
    neutral: { background: COLORS.surface, color: COLORS.textSecondary, border: `1px solid ${COLORS.border}` },
    ghost:   { background: "transparent", color: COLORS.textSecondary, border: "none" },
  };
  return (
    <button
      type={type ?? "button"}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px",
        padding: "8px 16px", borderRadius: "10px",
        fontFamily: F.body, fontSize: "13px", fontWeight: 600,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1,
        transition: "opacity 0.15s",
        ...styles[tone],
      }}
    >
      {children}
    </button>
  );
}
