import React from "react";
import { F, COLORS, SHADOW } from "./styles";

interface ComparisonItem {
  label: string;
  current: number;
  prev: number;
  delta: number | null | undefined;
}

interface PnLPeriodComparisonProps {
  current: {
    revenue?: number;
    cogs?: number;
    grossProfit?: number;
    operatingExpenses?: number;
    netProfit?: number;
  } | undefined;
  previous: {
    revenue: number;
    cogs: number;
    grossProfit: number;
    operatingExpenses: number;
    netProfit: number;
  };
  deltas: {
    revenue?: number | null;
    cogs?: number | null;
    grossProfit?: number | null;
    operatingExpenses?: number | null;
    netProfit?: number | null;
  } | undefined;
  fmt: (value: number) => string;
  t: (ru: string, uz: string) => string;
}

export function PnLPeriodComparison({
  current,
  previous,
  deltas,
  fmt,
  t,
}: PnLPeriodComparisonProps) {
  const items: ComparisonItem[] = [
    {
      label: t("Выручка", "Tushum"),
      current: current?.revenue ?? 0,
      prev: previous.revenue,
      delta: deltas?.revenue,
    },
    {
      label: t("COGS", "COGS"),
      current: current?.cogs ?? 0,
      prev: previous.cogs,
      delta: deltas?.cogs,
    },
    {
      label: t("Валовая прибыль", "Yalpi foyda"),
      current: current?.grossProfit ?? 0,
      prev: previous.grossProfit,
      delta: deltas?.grossProfit,
    },
    {
      label: t("Расходы", "Xarajatlar"),
      current: current?.operatingExpenses ?? 0,
      prev: previous.operatingExpenses,
      delta: deltas?.operatingExpenses,
    },
    {
      label: t("Чистая прибыль", "Toza foyda"),
      current: current?.netProfit ?? 0,
      prev: previous.netProfit,
      delta: deltas?.netProfit,
    },
  ];

  return (
    <div className="neo-card" style={{ padding: "24px" }}>
      <h2
        style={{
          fontFamily: F.display,
          fontSize: "16px",
          fontWeight: 600,
          color: COLORS.textPrimary,
          margin: "0 0 16px",
        }}
      >
        {t(
          "Сравнение с предыдущим периодом",
          "Oldingi davr bilan taqqoslash"
        )}
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
        }}
      >
        {items.map((item) => (
          <div
            key={item.label}
            style={{
              padding: "16px",
              borderRadius: "14px",
              background: COLORS.surfaceLight,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <div
              style={{
                fontSize: "10px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: COLORS.textTertiary,
                fontFamily: F.body,
                marginBottom: "8px",
              }}
            >
              {item.label}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "8px",
              }}
            >
              <span
                style={{
                  fontSize: "18px",
                  fontWeight: 700,
                  color: COLORS.textPrimary,
                  fontFamily: F.display,
                }}
              >
                {fmt(item.current)}
              </span>
              {item.delta !== null && item.delta !== undefined && (
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: item.delta >= 0 ? "#34c473" : "#d45050",
                  }}
                >
                  {item.delta >= 0 ? "+" : ""}
                  {item.delta.toFixed(1)}%
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: "11px",
                color: COLORS.textTertiary,
                marginTop: "4px",
              }}
            >
              {t("было", "oldingi")}: {fmt(item.prev)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
