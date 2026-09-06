import { FileDown, FileSpreadsheet } from "lucide-react";
import { F, COLORS } from "./styles";
import type { Lang } from "@/i18n";

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
  lang: Lang;
}

const human = (iso: string) => iso.split("-").reverse().join(".");

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
        alignItems: "flex-end",
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
        <p style={{ fontSize: "13px", color: COLORS.textSecondary, margin: "4px 0 0" }}>
          {/* Даты стояли машинным «2026-08-14»: шапка отчёта, который печатают
              и показывают, читается человеком. */}
          {human(from)} — {human(to)}
        </p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <div
          role="group"
          aria-label={t("Период", "Davr")}
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
              type="button"
              className="tap"
              // Выбранный период читался только цветом фона. Программе чтения с
              // экрана и клавиатуре нужно сказать словами, какая кнопка нажата.
              aria-pressed={range === r}
              onClick={() => onRangeChange(r)}
              style={{
                padding: "0 14px",
                fontSize: "12px",
                fontWeight: 600,
                fontFamily: F.body,
                borderRadius: "10px",
                border: "none",
                cursor: "pointer",
                transition: "background 0.2s, color 0.2s",
                background: range === r ? COLORS.surface : "transparent",
                color: range === r ? COLORS.textPrimary : COLORS.textSecondary,
                boxShadow: range === r ? "var(--shadow-xs)" : "none",
              }}
            >
              {RANGES[r][lang]}
            </button>
          ))}
        </div>
        {/* Кнопки были собраны из инлайновых стилей заново — при том, что в
            index.css для них есть .neo-btn: на этой странице они выглядели
            плоскими рядом с такими же кнопками на соседних экранах. */}
        <button type="button" className="neo-btn neo-btn-sm tap" onClick={onExportExcel}>
          <FileSpreadsheet size={14} /> Excel
        </button>
        <button type="button" className="neo-btn neo-btn-sm tap" onClick={onExportPDF}>
          <FileDown size={14} /> PDF
        </button>
      </div>
    </div>
  );
}
