import { memo } from "react";
import { F, COLORS } from "./report-constants";

export const KpiCard = memo(function KpiCard({ label, value, sub, icon, gradient }: {
  label: string; value: string; sub?: string;
  icon: React.ReactNode; gradient: string;
}) {
  return (
    <div className="kpi-hero" style={{
      padding: "22px",
      position: "relative", overflow: "hidden",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>
          {label}
        </span>
        <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {icon}
        </div>
      </div>
      <div style={{ fontFamily: F.display, fontSize: "28px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, letterSpacing: "-0.03em" }}>
        {value}
      </div>
      {sub && (
        <p style={{ fontSize: "12px", color: COLORS.textSecondary, margin: "8px 0 0", fontFamily: F.body }}>
          {sub}
        </p>
      )}
    </div>
  );
});
