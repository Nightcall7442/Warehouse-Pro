import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { F, COLORS } from "./constants";
import { useIsMobile } from "@/hooks/use-mobile";

export interface KpiCardProps {
  label: string;
  value: string;
  delta: number | null;
  icon: React.ReactNode;
  gradient: string;
  delay: number;
}

export function KpiCard({ label, value, delta, icon, gradient, delay }: KpiCardProps) {
  const isPositive = delta !== null && delta > 0;
  const isNegative = delta !== null && delta < 0;
  const isMobile = useIsMobile();
  /*
    Телефон: сетка страниц (minmax(200px, 1fr)) ставит карточки в столбик, и три
    «героя» по 150px отодвигали поиск и список за полтора экрана (прогон 390×844,
    20.09.2026). Здесь та же карточка в одну строку: значок, подпись, число.
  */
  if (isMobile) {
    return (
      <div className="kpi-hero" data-kpi-compact style={{ borderRadius: "16px", padding: "12px 14px", display: "flex", alignItems: "center", gap: "12px", animation: `slideUp ${0.5 + delay}s ease` }}>
        <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: gradient, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {icon}
        </div>
        <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary, flex: 1, minWidth: 0 }}>
          {label}
        </span>
        <span style={{ fontFamily: F.display, fontSize: "22px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>
          {value}
        </span>
        {delta !== null && (
          <span style={{ display: "flex", alignItems: "center", gap: "2px", fontSize: "11px", fontWeight: 600, fontFamily: F.body, color: isPositive ? "var(--color-success-text)" : isNegative ? "var(--color-danger-text)" : COLORS.textTertiary }}>
            {isPositive ? <ArrowUpRight size={12} /> : isNegative ? <ArrowDownRight size={12} /> : <Minus size={12} />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="kpi-hero" style={{
      borderRadius: "24px", padding: "24px",
      position: "relative", overflow: "hidden",
      animation: `slideUp ${0.5 + delay}s ease`,
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
          color: isPositive ? "var(--color-success-text)" : isNegative ? "var(--color-danger-text)" : COLORS.textTertiary,
        }}>
          {isPositive ? <ArrowUpRight size={14} /> : isNegative ? <ArrowDownRight size={14} /> : <Minus size={14} />}
          {Math.abs(delta).toFixed(1)}%
        </div>
      )}
    </div>
  );
}
