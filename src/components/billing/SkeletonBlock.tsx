import { COLORS } from "./designTokens";

interface SkeletonBlockProps {
  height: number;
  style?: React.CSSProperties;
}

export function SkeletonBlock({ height, style = {} }: SkeletonBlockProps) {
  return (
    <div style={{
      height: `${height}px`,
      borderRadius: "16px",
      background: `linear-gradient(90deg, ${COLORS.surfaceDark} 25%, ${COLORS.surface} 50%, ${COLORS.surfaceDark} 75%)`,
      backgroundSize: "200% 100%",
      animation: "pulse 1.5s ease-in-out infinite",
      ...style,
    }} />
  );
}
