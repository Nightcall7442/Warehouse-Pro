import React from "react";
import {
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  ComposedChart,
  Line,
  ReferenceLine,
} from "recharts";
import { F, COLORS } from "./styles";
import { ChartTooltip } from "./ChartTooltip";

interface TrendDataPoint {
  month: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  netProfit: number;
}

interface PnLRevenueChartProps {
  chartData: TrendDataPoint[];
  fmt: (value: number) => string;
  t: (ru: string, uz: string) => string;
  lang: string;
}

export function PnLRevenueChart({
  chartData,
  fmt,
  t,
  lang,
}: PnLRevenueChartProps) {
  if (chartData.length === 0) return null;

  return (
    <div className="neo-card" style={{ padding: "24px" }}>
      <h2
        style={{
          fontFamily: F.display,
          fontSize: "16px",
          fontWeight: 600,
          color: COLORS.textPrimary,
          margin: "0 0 20px",
        }}
      >
        {lang === "uz" ? "Oylik trend" : "Месячный тренд"}
      </h2>
      <div style={{ height: "320px" }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 5, right: 20, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
            <XAxis
              dataKey="month"
              tick={{
                fontSize: 11,
                fill: COLORS.textTertiary,
                fontFamily: F.body,
              }}
              axisLine={{ stroke: COLORS.border }}
              tickLine={false}
            />
            <YAxis
              tick={{
                fontSize: 11,
                fill: COLORS.textTertiary,
                fontFamily: F.body,
              }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) =>
                v >= 1_000_000
                  ? `${(v / 1_000_000).toFixed(0)}M`
                  : v >= 1_000
                    ? `${(v / 1_000).toFixed(0)}K`
                    : String(v)
              }
            />
            <Tooltip content={<ChartTooltip fmt={(v) => fmt(v)} />} />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{
                fontSize: "12px",
                fontFamily: F.body,
                paddingTop: "12px",
              }}
            />
            <Bar
              dataKey="revenue"
              name={t("Выручка", "Tushum")}
              fill="#4b6cf6"
              radius={[4, 4, 0, 0]}
              opacity={0.85}
            />
            <Bar
              dataKey="cogs"
              name="COGS"
              fill="#e8a830"
              radius={[4, 4, 0, 0]}
              opacity={0.85}
            />
            <Line
              dataKey="grossProfit"
              name={t("Вал. прибыль", "Yalpi foyda")}
              stroke="#34c473"
              strokeWidth={2.5}
              dot={{
                r: 4,
                fill: "#34c473",
                stroke: COLORS.surface,
                strokeWidth: 2,
              }}
              activeDot={{ r: 6 }}
            />
            <Line
              dataKey="netProfit"
              name={t("Чист. прибыль", "Toza foyda")}
              stroke="#c7c9f8"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={{
                r: 3,
                fill: "#c7c9f8",
                stroke: COLORS.surface,
                strokeWidth: 2,
              }}
            />
            <ReferenceLine y={0} stroke={COLORS.border} strokeDasharray="3 3" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
