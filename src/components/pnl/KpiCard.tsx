import React from "react";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { F, COLORS } from "./styles";

interface KpiCardProps {
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

  return (
    <div
      className="kpi-hero"
      style={{ padding: "22px", position: "relative", overflow: "hidden" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "16px",
        }}
      >
        <span
          style={{
            fontFamily: F.display,
            fontSize: "10px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: COLORS.textTertiary,
          }}
        >
          {label}
        </span>
        <div
          style={{
            width: "40px",
            height: "40px",
            borderRadius: "12px",
            background: gradient,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </div>
      </div>
      <div
        style={{
          fontFamily: F.display,
          fontSize: "28px",
          fontWeight: 700,
          color: COLORS.textPrimary,
          lineHeight: 1,
          letterSpacing: "-0.03em",
        }}
      >
        {value}
      </div>
      {delta !== null && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            marginTop: "10px",
            fontSize: "12px",
            fontWeight: 600,
            fontFamily: F.body,
            color: isPositive
              ? "#34c473"
              : isNegative
                ? "#d45050"
                : COLORS.textTertiary,
          }}
        >
          {isPositive ? (
            <ArrowUpRight size={14} />
          ) : isNegative ? (
            <ArrowDownRight size={14} />
          ) : (
            <Minus size={14} />
          )}
          {Math.abs(delta).toFixed(1)}%
        </div>
      )}
    </div>
  );
}
