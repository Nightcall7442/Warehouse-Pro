import React from "react";
import { ProgressRing } from "@/components/ProgressRing";
import { F, COLORS, SHADOW } from "./styles";

interface PnLMarginRingsProps {
  current: {
    revenue?: number;
    cogs?: number;
    grossMarginPct?: number;
    netMarginPct?: number;
  } | undefined;
  deltas: {
    grossMarginPct?: number | null;
    netMarginPct?: number | null;
  } | undefined;
  lang: string;
}

function MarginRing({
  pct,
  label,
  delta,
}: {
  pct: number;
  label: string;
  delta?: number | null;
}) {
  const ringColor =
    pct >= 20 ? "var(--color-success)" : pct >= 10 ? "var(--color-warning)" : "var(--color-danger)";
  const ringPct = Math.max(0, Math.min(100, pct));

  return (
    <div
      style={{
        background: COLORS.surface,
        borderRadius: "24px",
        padding: "24px",
        boxShadow: SHADOW,
        display: "flex",
        alignItems: "center",
        gap: "16px",
      }}
    >
      <ProgressRing
        value={ringPct}
        color={ringColor}
        size={80}
        strokeWidth={6}
        label={`${pct.toFixed(0)}%`}
      />
      <div>
        <div
          style={{
            fontSize: "10px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: COLORS.textTertiary,
            fontFamily: F.body,
          }}
        >
          {label}
        </div>
        {delta !== null && delta !== undefined && (
          <p
            style={{
              fontSize: "11px",
              color: delta >= 0 ? "var(--color-success-text)" : "var(--color-danger-text)",
              margin: "4px 0 0",
              fontWeight: 600,
            }}
          >
            {delta >= 0 ? "+" : ""}
            {delta.toFixed(1)}pp
          </p>
        )}
      </div>
    </div>
  );
}

export function PnLMarginRings({ current, deltas, lang }: PnLMarginRingsProps) {
  const grossPct = current?.grossMarginPct ?? 0;
  const netPct = current?.netMarginPct ?? 0;
  const cogsPct =
    (current?.revenue ?? 0) > 0
      ? ((current?.cogs ?? 0) / (current?.revenue ?? 1)) * 100
      : 0;

  const cogsRingColor =
    cogsPct <= 60 ? "var(--color-success)" : cogsPct <= 80 ? "var(--color-warning)" : "var(--color-danger)";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: "16px",
      }}
    >
      <MarginRing
        pct={grossPct}
        label={lang === "uz" ? "YALPI MARJA" : "ВАЛОВАЯ МАРЖА"}
        delta={deltas?.grossMarginPct}
      />
      <MarginRing
        pct={netPct}
        label={lang === "uz" ? "TOZA MARJA" : "ЧИСТАЯ МАРЖА"}
        delta={deltas?.netMarginPct}
      />
      <div
        style={{
          background: COLORS.surface,
          borderRadius: "24px",
          padding: "24px",
          boxShadow: SHADOW,
          display: "flex",
          alignItems: "center",
          gap: "16px",
        }}
      >
        <ProgressRing
          value={Math.max(0, Math.min(100, cogsPct))}
          color={cogsRingColor}
          size={80}
          strokeWidth={6}
          label={`${cogsPct.toFixed(0)}%`}
        />
        <div>
          <div
            style={{
              fontSize: "10px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: COLORS.textTertiary,
              fontFamily: F.body,
            }}
          >
            {lang === "uz" ? "COGS %" : "ДОЛЯ СЕБЕСТОИМОСТИ"}
          </div>
          <p
            style={{
              fontSize: "11px",
              color: COLORS.textSecondary,
              margin: "4px 0 0",
            }}
          >
            {lang === "uz" ? "COGS / Daromad" : "COGS / Выручка"}
          </p>
        </div>
      </div>
    </div>
  );
}
