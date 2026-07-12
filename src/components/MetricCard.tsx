import { memo } from "react";
import { KpiIcon } from "./KpiIcon";
import type { KpiColor } from "./KpiIcon";
import type { LucideIcon } from "lucide-react";

export interface MetricCardProps {
  label: string;
  value: string;
  subtitle?: string;
  icon?: LucideIcon;
  color?: KpiColor;
  onClick?: () => void;
  className?: string;
}

export const MetricCard = memo(function MetricCard({
  label,
  value,
  subtitle,
  icon,
  color = "indigo",
  onClick,
  className,
}: MetricCardProps) {
  return (
    <div
      className={`kpi-card ${onClick ? "cursor-pointer" : ""} ${className ?? ""}`}
      onClick={onClick}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        {icon && (
          <KpiIcon icon={icon} color={color} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            className="font-label"
            style={{ color: "#9ca3af", marginBottom: 6 }}
          >
            {label}
          </p>
          <p
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1,
              color: "#111827",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {value}
          </p>
          {subtitle && (
            <p
              style={{
                fontSize: 12,
                color: "#9ca3af",
                marginTop: 6,
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
      </div>
    </div>
  );
});
