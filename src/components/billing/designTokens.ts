export const COLORS = {
  primary: "var(--color-primary)",
  // Accent-coloured *text* (a price, a code, a link). The fill colour above
  // is a hair under 4.5:1 as text on a light card, so semantic text uses
  // this darker sibling instead. See --color-primary-text in index.css.
  primaryText: "var(--color-primary-text)",
  primaryLight: "var(--color-primary-muted, #94a3b8)",
  primaryDark: "var(--color-primary-hover, #4a5c78)",
  gradientStart: "var(--color-primary)",
  gradientEnd: "var(--color-primary-muted, #94a3b8)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
  surface: "var(--color-surface, #efedea)",
  surfaceDark: "var(--color-surface-light, #f6f4f0)",
  textPrimary: "var(--color-text-primary, #2b2a28)",
  textSecondary: "var(--color-text-secondary, #5e5b54)",
  textTertiary: "var(--color-text-tertiary, #6b6760)",
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
  hero: `linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 6%, var(--color-surface, #efedea)) 0%, var(--color-surface, #efedea) 100%)`,
  heroExpired: `linear-gradient(135deg, color-mix(in srgb, var(--color-danger) 6%, var(--color-surface, #efedea)) 0%, var(--color-surface, #efedea) 100%)`,
  button: `linear-gradient(135deg, var(--color-primary), var(--color-primary-hover, #4a5c78))`,
  buttonHover: `linear-gradient(135deg, var(--color-primary-hover, #4a5c78), var(--color-primary))`,
  card: "var(--color-surface, #efedea)",
};

export const ANIMATIONS = {
  fadeIn: "@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }",
  slideUp: "@keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }",
  pulse: "@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }",
  progressFill: "@keyframes progressFill { from { width: 0; } }",
  glowPulse: "@keyframes glowPulse { 0%, 100% { box-shadow: var(--shadow-sm); } 50% { box-shadow: var(--shadow-md); } }",
};
