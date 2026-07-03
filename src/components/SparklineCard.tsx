import { memo, useMemo } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";

export interface SparklineCardProps {
  label: string;
  value: string;
  delta: number;
  trend: number[];
  unit?: string;
  color?: string;
  invertDelta?: boolean;
  onClick?: () => void;
}

export const SparklineCard = memo(function SparklineCard({
  label,
  value,
  delta,
  trend,
  color = "var(--color-primary)",
  invertDelta = false,
  onClick,
}: SparklineCardProps) {
  const isPositive = invertDelta ? delta < 0 : delta > 0;
  const isNegative = invertDelta ? delta > 0 : delta < 0;

  const chartData = useMemo(() => trend.map((v, i) => ({ i, v })), [trend]);

  return (
    <div
      className="kpi-hero animate-count-up cursor-pointer"
      style={{ position: "relative" }}
      onClick={onClick}
    >
      <div className="kpi-hero-label">{label}</div>
      <div className="kpi-hero-value" style={{ marginTop: 4 }}>
        {value}
      </div>

      {delta !== 0 && (
        <div
          className={`kpi-hero-trend ${isPositive ? "up" : isNegative ? "down" : ""}`}
        >
          {isPositive ? (
            <TrendingUp size={12} />
          ) : isNegative ? (
            <TrendingDown size={12} />
          ) : null}
          <span>{Math.abs(delta).toFixed(1)}%</span>
        </div>
      )}

      {trend.length > 0 && (
        <div className="sparkline-container">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <Line
                type="monotone"
                dataKey="v"
                stroke={color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={true}
                animationDuration={1000}
                animationEasing="ease-out"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
});
