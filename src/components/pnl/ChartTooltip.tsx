import React from "react";
import { F, COLORS } from "./styles";

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{
    dataKey: string;
    name: string;
    value: number;
    fill?: string;
    stroke?: string;
  }>;
  label?: string;
  fmt: (value: number) => string;
}

export function ChartTooltip({ active, payload, label, fmt }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
        borderRadius: "12px",
        padding: "14px 16px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
        minWidth: "160px",
      }}
    >
      <p
        style={{
          fontSize: "11px",
          fontWeight: 600,
          color: COLORS.textTertiary,
          marginBottom: "8px",
          fontFamily: F.body,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </p>
      {payload.map((p) => (
        <div
          key={p.dataKey}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "16px",
            marginTop: "4px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: p.fill ?? p.stroke ?? "#4b6cf6",
              }}
            />
            <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>
              {p.name}
            </span>
          </div>
          <span
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: COLORS.textPrimary,
              fontFamily: F.display,
            }}
          >
            {fmt(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
