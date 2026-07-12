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
  color = "#818cf8",
  invertDelta = false,
  onClick,
}: SparklineCardProps) {
  const isPositive = invertDelta ? delta < 0 : delta > 0;
  const isNegative = invertDelta ? delta > 0 : delta < 0;

  const chartData = useMemo(() => trend.map((v, i) => ({ i, v })), [trend]);

  return (
    <div
      style={{
        background: "#ffffff",
        borderRadius: "20px",
        padding: "22px",
        boxShadow: "0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04)",
        cursor: onClick ? "pointer" : "default",
        transition: "all 0.2s ease",
        position: "relative",
        overflow: "hidden",
      }}
      onClick={onClick}
    >
      {/* Three colored dots */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#fb7185" }} />
        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#fbbf24" }} />
        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#2dd4bf" }} />
      </div>

      <p style={{
        fontSize: "11px", fontWeight: 600, textTransform: "uppercase",
        letterSpacing: "0.08em", color: "#9ca3af", margin: 0,
        fontFamily: "'DM Sans', sans-serif",
      }}>
        {label}
      </p>

      <p style={{
        fontSize: "28px", fontWeight: 700, color: "#111827",
        margin: "8px 0 0", letterSpacing: "-0.03em",
        fontFamily: "'DM Sans', sans-serif",
      }}>
        {value}
      </p>

      {delta !== 0 && (
        <div style={{
          display: "inline-flex", alignItems: "center", gap: "4px",
          marginTop: "8px", padding: "3px 8px", borderRadius: "6px",
          fontSize: "12px", fontWeight: 600,
          color: isPositive ? "#4ade80" : isNegative ? "#f87171" : "#9ca3af",
          background: isPositive ? "#dcfce7" : isNegative ? "#fee2e2" : "transparent",
        }}>
          {isPositive ? <TrendingUp size={12} /> : isNegative ? <TrendingDown size={12} /> : null}
          <span>{Math.abs(delta).toFixed(1)}%</span>
        </div>
      )}

      {trend.length > 0 && (
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, height: "50px",
          opacity: 0.15, pointerEvents: "none",
        }}>
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
