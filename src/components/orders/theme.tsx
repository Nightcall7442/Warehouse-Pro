import { memo } from "react";
import { F, COLORS, STATUS } from "./theme-tokens";
import { kpiTint, kpiAccent } from "@/lib/kpi-tint";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { colorMix } from "@/lib/color-mix";

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
