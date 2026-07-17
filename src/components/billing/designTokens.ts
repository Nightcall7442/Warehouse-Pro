export const COLORS = {
  primary: "#5b6d8a",
  primaryLight: "#5b6d8a",
  primaryDark: "#5b6d8a",
  gradientStart: "#5b6d8a",
  gradientEnd: "#c7c9f8",
  success: "#34c473",
  warning: "#d4973a",
  danger: "#d45050",
  surface: "var(--color-surface, #ffffff)",
  surfaceDark: "var(--color-surface-light, #f0f3f8)",
  textPrimary: "var(--color-text-primary, #2b3450)",
  textSecondary: "var(--color-text-secondary, #6a7290)",
  textTertiary: "var(--color-text-tertiary, #98a0b8)",
};

export const FONTS = {
  display: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  body: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
};

export const SHADOWS = {
  sm: "0 1px 2px rgba(0,0,0,.04)",
  md: "0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04)",
  lg: "0 10px 15px -3px rgba(0,0,0,.06)",
  xl: "0 20px 25px -5px rgba(0,0,0,.06)",
  glow: (color: string, intensity = 0.15) =>
    `0 0 30px rgba(${color === "primary" ? "99,102,241" : color === "success" ? "16,185,129" : color === "warning" ? "245,158,11" : "239,68,68"},${intensity})`,
};

export const GRADIENTS = {
  hero: `linear-gradient(135deg, color-mix(in srgb, var(--color-primary, #5b6d8a) 8%, var(--color-surface, #eff6ff)) 0%, var(--color-surface, #ffffff) 100%)`,
  heroExpired: `linear-gradient(135deg, color-mix(in srgb, var(--color-danger, #d45050) 8%, var(--color-surface, #fee2e2)) 0%, var(--color-surface, #ffffff) 100%)`,
  button: `linear-gradient(135deg, ${COLORS.gradientStart}, ${COLORS.gradientEnd})`,
  buttonHover: `linear-gradient(135deg, ${COLORS.primaryDark}, #9333ea)`,
  card: `linear-gradient(180deg, var(--color-surface, #ffffff) 0%, var(--color-surface-light, #f0f3f8) 100%)`,
};

export const ANIMATIONS = {
  fadeIn: "@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }",
  slideUp: "@keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }",
  pulse: "@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }",
  progressFill: "@keyframes progressFill { from { width: 0; } }",
  glowPulse: "@keyframes glowPulse { 0%, 100% { box-shadow: 0 0 20px rgba(75,108,246,0.1); } 50% { box-shadow: 0 0 30px rgba(75,108,246,0.2); } }",
};
