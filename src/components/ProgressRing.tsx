import { memo } from "react";

export interface ProgressRingProps {
  /** 0–100 */
  value: number;
  /** Track color (the lighter circle behind) */
  trackColor?: string;
  /** Stroke color */
  color?: string;
  /** Diameter in px */
  size?: number;
  /** Stroke width */
  strokeWidth?: number;
  /** Center label */
  label?: string;
  className?: string;
}

export const ProgressRing = memo(function ProgressRing({
  value,
  trackColor = "#f3f4f6",
  color = "#818cf8",
  size = 88,
  strokeWidth = 7,
  label,
  className,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div
      className={className}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        filter: "drop-shadow(0 2px 4px rgba(0,0,0,.06))",
        width: size,
        height: size,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: "rotate(-90deg)" }}
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        {/* Value arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.16,1,0.3,1)" }}
        />
      </svg>
      {label != null && (
        <span style={{
          position: "absolute",
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 700,
          fontSize: size > 80 ? "18px" : "14px",
          color: "#111827",
          pointerEvents: "none",
        }}>
          {label}
        </span>
      )}
    </div>
  );
});
