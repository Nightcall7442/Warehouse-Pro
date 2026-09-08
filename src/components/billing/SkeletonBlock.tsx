interface SkeletonBlockProps {
  height: number;
  style?: React.CSSProperties;
}

/**
 * Заглушка на время загрузки.
 *
 * Цвета брались из своего словаря designTokens, где `surfaceDark` на деле был
 * СВЕТЛЕЕ обычной поверхности — переливание шло в обратную сторону.
 */
export function SkeletonBlock({ height, style = {} }: SkeletonBlockProps) {
  return (
    <div style={{
      height: `${height}px`,
      borderRadius: "24px",
      background: "linear-gradient(90deg, var(--color-surface) 25%, var(--color-surface-light) 50%, var(--color-surface) 75%)",
      backgroundSize: "200% 100%",
      animation: "shimmer 1.6s linear infinite",
      ...style,
    }} />
  );
}
