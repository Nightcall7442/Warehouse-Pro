import { COLORS, FONTS } from "./designTokens";
import { colorMix } from "@/lib/color-mix";

interface UsageBarProps {
  used: number;
  max: number | null;
  label: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
}

export function UsageBar({ used, max, label, icon: Icon }: UsageBarProps) {
  const pct = max ? Math.min((used / max) * 100, 100) : 100;
  const warn = max && used >= max * 0.85;
  const over = max && used >= max;
  const barColor = over ? COLORS.danger : warn ? COLORS.warning : COLORS.primary;

  return (
    <div style={{
      marginBottom: "20px",
      animation: "fadeIn 0.5s ease forwards",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "10px",
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}>
          <div style={{
            width: "32px",
            height: "32px",
            borderRadius: "10px",
            background: colorMix(barColor, 8),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <Icon size={16} style={{ color: barColor }} />
          </div>
          <span style={{
            fontSize: "14px",
            fontWeight: "500",
            color: COLORS.textSecondary,
          }}>{label}</span>
        </div>
        <div style={{
          fontFamily: FONTS.body,
          fontSize: "14px",
          fontWeight: over ? "700" : warn ? "600" : "500",
          color: over ? COLORS.danger : warn ? COLORS.warning : COLORS.textPrimary,
        }}>
          {used.toLocaleString()}
          <span style={{
            color: COLORS.textTertiary,
            fontWeight: "400",
            marginLeft: "4px",
          }}>
            / {max ? max.toLocaleString() : "∞"}
          </span>
        </div>
      </div>
      <div style={{
        height: "8px",
        borderRadius: "4px",
        background: colorMix(barColor, 7),
        overflow: "hidden",
        position: "relative",
      }}>
        <div style={{
          height: "100%",
          borderRadius: "4px",
          width: `${pct}%`,
          background: max
            ? `linear-gradient(90deg, ${barColor}, ${colorMix(barColor, 80)})`
            : `linear-gradient(90deg, ${COLORS.success}, #16A38A)`,
          transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
          animation: "progressFill 1s ease forwards",
          boxShadow: `0 0 10px ${colorMix(barColor, 25)}`,
        }} />
      </div>
    </div>
  );
}
