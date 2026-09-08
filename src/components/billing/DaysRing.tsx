import { colorMix } from "@/lib/color-mix";

interface DaysRingProps {
  daysLeft: number;
  total?: number;
  danger: boolean;
}

/**
 * Кольцо оставшихся дней.
 *
 * Цвета брались из своего словаря designTokens; здесь они прямо из токенов
 * приложения, поэтому кольцо меняется вместе с темой.
 */
export function DaysRing({ daysLeft, total = 30, danger }: DaysRingProps) {
  const r = 30, circ = 2 * Math.PI * r;
  const isUnlimited = !danger && daysLeft > 365;
  const displayDays = isUnlimited ? total : Math.max(0, daysLeft);
  const pct = isUnlimited ? 1 : Math.max(0, Math.min(1, daysLeft / total));
  const stroke = danger
    ? "var(--color-danger)"
    : daysLeft <= 3
      ? "var(--color-warning)"
      : "var(--color-success)";

  return (
    <div style={{ width: "80px", height: "80px", flexShrink: 0, position: "relative" }}>
      <svg width="80" height="80" style={{ transform: "rotate(-90deg)" }} aria-hidden>
        <circle cx="40" cy="40" r={r} fill="none" stroke={colorMix(stroke, 14)} strokeWidth="6" />
        <circle
          cx="40" cy="40" r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{
          fontSize: isUnlimited ? "20px" : "22px",
          fontWeight: 700,
          color: "var(--color-text-primary)",
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
        }}>
          {isUnlimited ? "∞" : displayDays}
        </span>
      </div>
    </div>
  );
}
