export const COLORS = {
  primary: "var(--color-primary, #5b6d8a)",
  primaryLight: "var(--color-primary-muted, #94a3b8)",
  primaryDark: "var(--color-primary-hover, #4a5c78)",
  gradientStart: "var(--color-primary, #5b6d8a)",
  gradientEnd: "var(--color-primary-muted, #94a3b8)",
  success: "var(--color-success, #34c473)",
  warning: "var(--color-warning, #d4973a)",
  danger: "var(--color-danger, #d45050)",
  surface: "var(--color-surface, #f6f4f0)",
  surfaceDark: "var(--color-surface-light, #fbfaf8)",
  textPrimary: "var(--color-text-primary, #2b2a28)",
  textSecondary: "var(--color-text-secondary, #5e5b54)",
  textTertiary: "var(--color-text-tertiary, #757168)",
};

export const FONTS = {
  display: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  body: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
};

export const SHADOWS = {
  sm: "var(--shadow-xs)",
  md: "var(--shadow-sm)",
  lg: "var(--shadow-md)",
  xl: "var(--shadow-lg)",
  glow: (color: string, intensity = 0.15) =>
    `0 0 30px rgba(${color === "primary" ? "91,109,138" : color === "success" ? "52,196,115" : color === "warning" ? "212,151,58" : "212,80,80"},${intensity})`,
};

export const GRADIENTS = {
  hero: `linear-gradient(135deg, color-mix(in srgb, var(--color-primary, #5b6d8a) 6%, var(--color-surface, #f6f4f0)) 0%, var(--color-surface, #f6f4f0) 100%)`,
  heroExpired: `linear-gradient(135deg, color-mix(in srgb, var(--color-danger, #d45050) 6%, var(--color-surface, #f6f4f0)) 0%, var(--color-surface, #f6f4f0) 100%)`,
  button: `linear-gradient(135deg, var(--color-primary, #5b6d8a), var(--color-primary-hover, #4a5c78))`,
  buttonHover: `linear-gradient(135deg, var(--color-primary-hover, #4a5c78), var(--color-primary, #5b6d8a))`,
  card: "var(--color-surface, #f6f4f0)",
};

export const ANIMATIONS = {
  fadeIn: "@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }",
  slideUp: "@keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }",
  pulse: "@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }",
  progressFill: "@keyframes progressFill { from { width: 0; } }",
  glowPulse: "@keyframes glowPulse { 0%, 100% { box-shadow: var(--shadow-sm); } 50% { box-shadow: var(--shadow-md); } }",
};
