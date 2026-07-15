import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { COLORS, F } from "./theme";

interface KpiCardProps {
  label: string;
  value: string | number;
  delta?: number | null;
  sub?: string;
  icon: React.ComponentType<{ size: number; color?: string }>;
  gradient: string;
  delay: number;
}

export function KpiCard({ label, value, delta, sub, icon: Icon, gradient, delay }: KpiCardProps) {
  const isPositive = delta !== null && delta !== undefined && delta > 0;
  const isNegative = delta !== null && delta !== undefined && delta < 0;
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
          <Icon size={20} color="#fff" />
        </div>
      </div>
      <div style={{ fontFamily: F.display, fontSize: "32px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, letterSpacing: "-0.03em" }}>
        {value}
      </div>
      {delta !== null && delta !== undefined && (
        <div style={{
          display: "flex", alignItems: "center", gap: "4px", marginTop: "10px",
          fontSize: "12px", fontWeight: 600, fontFamily: F.body,
          color: isPositive ? "#34c473" : isNegative ? "#e85050" : COLORS.textTertiary,
        }}>
          {isPositive ? <ArrowUpRight size={14} /> : isNegative ? <ArrowDownRight size={14} /> : <Minus size={14} />}
          {Math.abs(delta).toFixed(1)}%
        </div>
      )}
      {sub && <div style={{ fontSize: "11px", marginTop: "4px", color: COLORS.textTertiary, fontFamily: F.body }}>{sub}</div>}
    </div>
  );
}
