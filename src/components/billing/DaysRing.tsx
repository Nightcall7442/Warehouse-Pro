import { COLORS, FONTS } from "./designTokens";

interface DaysRingProps {
  daysLeft: number;
  total?: number;
  danger: boolean;
}

export function DaysRing({ daysLeft, total = 30, danger }: DaysRingProps) {
  const r = 30, circ = 2 * Math.PI * r;
  const isUnlimited = !danger && daysLeft > 365;
  const displayDays = isUnlimited ? total : Math.max(0, daysLeft);
  const pct = isUnlimited ? 1 : Math.max(0, Math.min(1, daysLeft / total));
  const stroke = danger ? COLORS.danger : daysLeft <= 3 ? COLORS.warning : COLORS.success;

  return (
    <div style={{
      width: "80px",
      height: "80px",
      flexShrink: 0,
      position: "relative",
      filter: `drop-shadow(0 0 8px ${stroke}30)`,
    }}>
      <svg width="80" height="80" style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx="40" cy="40" r={r}
          fill="none"
          stroke={`${stroke}20`}
          strokeWidth="6"
        />
        <circle
          cx="40" cy="40" r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          style={{
            transition: "stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)",
            filter: `drop-shadow(0 0 6px ${stroke}60)`,
          }}
        />
      </svg>
      <div style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}>
        {isUnlimited ? (
          <span style={{
            fontFamily: FONTS.body,
            fontSize: "18px",
            fontWeight: "700",
            color: COLORS.textPrimary,
            lineHeight: 1,
          }}>∞</span>
        ) : (
          <span style={{
            fontFamily: FONTS.body,
            fontSize: "22px",
            fontWeight: "700",
            color: COLORS.textPrimary,
            lineHeight: 1,
          }}>{displayDays}</span>
        )}
      </div>
    </div>
  );
}
