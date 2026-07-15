import React from "react";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { F, COLORS } from "./styles";

export type Range = "7d" | "30d" | "90d" | "12m" | "ytd" | "custom";

const RANGES: Record<Range, { ru: string; uz: string }> = {
  "7d": { ru: "7 дней", uz: "7 kun" },
  "30d": { ru: "30 дней", uz: "30 kun" },
  "90d": { ru: "90 дней", uz: "90 kun" },
  "12m": { ru: "12 мес.", uz: "12 oy" },
  ytd: { ru: "Год", uz: "Yil" },
  custom: { ru: "Период", uz: "Davr" },
};

interface PnLPeriodSelectorProps {
  range: Range;
  onRangeChange: (range: Range) => void;
  onExportExcel: () => void;
  onExportPDF: () => void;
  from: string;
  to: string;
  t: (ru: string, uz: string) => string;
  lang: string;
}

export function PnLPeriodSelector({
  range,
  onRangeChange,
  onExportExcel,
  onExportPDF,
  from,
  to,
  t,
  lang,
}: PnLPeriodSelectorProps) {
  const ranges: Range[] = ["7d", "30d", "90d", "12m", "ytd", "custom"];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "12px",
      }}
    >
      <div>
        <h1
          style={{
            fontFamily: F.display,
            fontSize: "24px",
            fontWeight: 700,
            color: COLORS.textPrimary,
            letterSpacing: "-0.025em",
            margin: 0,
          }}
        >
          {t("Доходы и расходы", "Foyda va zarar")}
        </h1>
        <p
          style={{
            fontSize: "13px",
            color: COLORS.textSecondary,
            margin: "4px 0 0",
          }}
        >
          {t(
            "Реальная себестоимость и маржинальность",
            "Haqiqiy COGS va marjalar"
          )}
          <span
            style={{
              marginLeft: "8px",
              fontSize: "12px",
              color: COLORS.textTertiary,
            }}
          >
            {from} — {to}
          </span>
        </p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div
          style={{
            display: "inline-flex",
            background: COLORS.surfaceLight,
            borderRadius: "12px",
            padding: "3px",
            gap: "2px",
          }}
        >
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => onRangeChange(r)}
              style={{
                padding: "8px 12px",
                fontSize: "11px",
                fontWeight: 600,
                fontFamily: F.body,
                borderRadius: "10px",
                border: "none",
                cursor: "pointer",
                transition: "all 0.2s",
                background: range === r ? COLORS.surface : "transparent",
                color:
                  range === r ? COLORS.textPrimary : COLORS.textSecondary,
                boxShadow:
                  range === r
                    ? "0 1px 3px rgba(0,0,0,0.08)"
                    : "none",
              }}
            >
              {RANGES[r][lang]}
            </button>
          ))}
        </div>
        <button
          onClick={onExportExcel}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "8px 14px",
            fontSize: "13px",
            fontWeight: 500,
            fontFamily: F.body,
            borderRadius: "10px",
            border: `1px solid ${COLORS.border}`,
            cursor: "pointer",
            background: COLORS.surface,
            color: COLORS.textSecondary,
          }}
        >
          <FileSpreadsheet size={14} /> Excel
        </button>
        <button
          onClick={onExportPDF}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "8px 14px",
            fontSize: "13px",
            fontWeight: 500,
            fontFamily: F.body,
            borderRadius: "10px",
            border: `1px solid ${COLORS.border}`,
            cursor: "pointer",
            background: COLORS.surface,
            color: COLORS.textSecondary,
          }}
        >
          <FileDown size={14} /> PDF
        </button>
      </div>
    </div>
  );
}
