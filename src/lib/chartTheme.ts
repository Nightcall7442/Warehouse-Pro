/**
 * Shared recharts theme — pastel neumorphic palette.
 * Import this and spread into chart props for consistent look.
 */

export const CHART_COLORS = {
  primary:   "var(--kpi-indigo)",
  success:   "var(--kpi-green)",
  warning:   "var(--kpi-amber)",
  danger:    "var(--kpi-red)",
  info:      "var(--kpi-blue)",
  teal:      "var(--kpi-teal)",
  purple:    "var(--kpi-purple)",
  orange:    "var(--kpi-orange)",
  pink:      "var(--kpi-pink)",
  coral:     "var(--kpi-coral)",
} as const;

/** Ordered palette for categorical charts (pie, multi-bar) */
export const CHART_PALETTE = [
  CHART_COLORS.primary,
  CHART_COLORS.teal,
  CHART_COLORS.coral,
  CHART_COLORS.amber,
  CHART_COLORS.info,
  CHART_COLORS.purple,
  CHART_COLORS.success,
  CHART_COLORS.orange,
  CHART_COLORS.pink,
  CHART_COLORS.danger,
];

/** Soft pastel fills with reduced opacity for area charts */
export const CHART_AREA_FILLS = {
  primary: "var(--kpi-indigo-track)",
  success: "var(--kpi-green-track)",
  warning: "var(--kpi-amber-track)",
  danger:  "var(--kpi-red-track)",
  info:    "var(--kpi-blue-track)",
  teal:    "var(--kpi-teal-track)",
} as const;

/** Default props for <Line> / <Bar> for consistent neumorphic look */
export const CHART_LINE_DEFAULTS = {
  strokeWidth: 2,
  dot: false as const,
  activeDot: { r: 4, strokeWidth: 2, stroke: "#fff" },
};

export const CHART_BAR_DEFAULTS = {
  radius: [6, 6, 0, 0] as [number, number, number, number],
  maxBarSize: 48,
};

/** Tooltip style for cream background */
export const CHART_TOOLTIP_STYLE = {
  background: "var(--color-surface)",
  border: "none",
  borderRadius: 12,
  boxShadow: "0 8px 24px -6px rgba(180,175,165,.30)",
  padding: "12px 16px",
};

/** Legend style for cream background */
export const CHART_LEGEND_STYLE = {
  fontSize: 12,
  fontFamily: "'DM Sans', sans-serif",
};
