import { memo } from "react";
import type { LucideIcon } from "lucide-react";

export type KpiColor =
  | "indigo" | "blue" | "teal" | "green"
  | "amber" | "orange" | "red" | "pink"
  | "purple" | "coral";

export interface KpiIconProps {
  icon: LucideIcon;
  color: KpiColor;
  /** Icon size in px (default 20) */
  iconSize?: number;
  /** Container size in px (default 44) */
  size?: number;
  className?: string;
}

const COLOR_MAP: Record<KpiColor, { bg: string; fg: string }> = {
  indigo: { bg: "var(--kpi-indigo-track)", fg: "var(--kpi-indigo)" },
  blue:   { bg: "var(--kpi-blue-track)",   fg: "var(--kpi-blue)" },
  teal:   { bg: "var(--kpi-teal-track)",   fg: "var(--kpi-teal)" },
  green:  { bg: "var(--kpi-green-track)",  fg: "var(--kpi-green)" },
  amber:  { bg: "var(--kpi-amber-track)",  fg: "var(--kpi-amber)" },
  orange: { bg: "var(--kpi-orange-track)", fg: "var(--kpi-orange)" },
  red:    { bg: "var(--kpi-red-track)",    fg: "var(--kpi-red)" },
  pink:   { bg: "var(--kpi-pink-track)",   fg: "var(--kpi-pink)" },
  purple: { bg: "var(--kpi-purple-track)", fg: "var(--kpi-purple)" },
  coral:  { bg: "var(--kpi-coral-track)",  fg: "var(--kpi-coral)" },
};

export const KpiIcon = memo(function KpiIcon({
  icon: Icon,
  color,
  iconSize = 20,
  size = 44,
  className,
}: KpiIconProps) {
  const palette = COLOR_MAP[color] ?? COLOR_MAP.indigo;

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: palette.bg,
        flexShrink: 0,
      }}
    >
      <Icon size={iconSize} strokeWidth={1.75} style={{ color: palette.fg }} />
    </div>
  );
});
