import { memo } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { colorMix } from "@/lib/color-mix";
import { F, COLORS } from "./report-constants";

/**
 * Цвет плитки — имя из палитры темы, а не готовая строка стиля.
 *
 * Раньше сюда передавали `linear-gradient(135deg, var(--kpi-purple), …)`, а
 * значок рисовали белым по этой заливке: `color="#fff"`. У арендатора со
 * светлым фирменным цветом это ещё сходило (заливка-то из палитры KPI), но
 * приём тот же, что уже подводил в бренде, — надпись на заливке жёстко белая.
 * Здесь заливки не стало вовсе: значок красится самим цветом на его же
 * бледной подложке (--kpi-*-track уже объявлены в теме для обеих тем), и
 * вопрос читаемости надписи на цветном фоне просто не возникает.
 */
export type KpiTone = "indigo" | "blue" | "teal" | "green" | "amber" | "orange" | "red" | "purple";

/** Точка отсчёта для числа. */
export interface KpiComparison {
  /**
   * Изменение в процентах. null — сравнивать не с чем: в прошлом периоде был
   * ноль либо данные не приехали. Тогда показывается только подпись.
   */
  pct: number | null;
  /** Готовая строка: «было 10,9 млн за прошлые 30 дней». Форматирует вызывающий — он знает валюту и язык. */
  label: string;
}

/**
 * Плитка сводки: число и то, с чем его сравнивать.
 *
 * ── Зачем переделана ────────────────────────────────────────────────────────
 *
 * Плитка показывала одно число и подпись вроде «≈4/агент». Владелец на такое
 * смотреть не может: «выручка 12 млн» — это много или мало? Без точки отсчёта
 * решения из плитки не следует никакого, а именно за решением на страницу и
 * приходят.
 *
 * Отсутствие сравнения показывается словами, а не нулём: «0 %» человек читает
 * как «не изменилось», хотя на деле сравнивать не с чем.
 */
export const KpiCard = memo(function KpiCard({ label, value, icon, tone, comparison, note }: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: KpiTone;
  comparison?: KpiComparison;
  /** Пояснение под числом там, где сравнение невозможно по существу (остаток, а не поток). */
  note?: string;
}) {
  const accent = `var(--kpi-${tone})`;
  const pct = comparison?.pct ?? null;
  const dir = pct === null ? "flat" : pct > 0.5 ? "up" : pct < -0.5 ? "down" : "flat";
  const dirColor = dir === "up" ? COLORS.successText : dir === "down" ? COLORS.dangerText : COLORS.textTertiary;
  const DirIcon = dir === "up" ? TrendingUp : dir === "down" ? TrendingDown : Minus;

  return (
    <div className="kpi-hero" style={{ padding: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginBottom: "14px" }}>
        <span style={{
          fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase",
          letterSpacing: "0.08em", color: COLORS.textTertiary,
        }}>
          {label}
        </span>
        <div style={{
          width: "34px", height: "34px", borderRadius: "10px", flexShrink: 0,
          background: `var(--kpi-${tone}-track, ${colorMix(accent, 12)})`, color: accent,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {icon}
        </div>
      </div>

      <div style={{
        fontFamily: F.display, fontSize: "26px", fontWeight: 700, color: COLORS.textPrimary,
        lineHeight: 1.1, letterSpacing: "-0.03em",
        // Цифры в колонку: без этого разряды пляшут от плитки к плитке.
        fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </div>

      {comparison && (
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", margin: "10px 0 0" }}>
          {pct !== null && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "4px",
              padding: "2px 7px", borderRadius: "999px",
              background: colorMix(dirColor, 12), color: dirColor,
              fontSize: "12px", fontWeight: 700, fontVariantNumeric: "tabular-nums",
            }}>
              <DirIcon size={12} aria-hidden />
              {pct > 0 ? "+" : ""}{pct.toFixed(pct > -10 && pct < 10 ? 1 : 0)}%
            </span>
          )}
          <span style={{ fontSize: "12px", color: COLORS.textSecondary, fontFamily: F.body }}>
            {comparison.label}
          </span>
        </div>
      )}

      {!comparison && note && (
        <p style={{ fontSize: "12px", color: COLORS.textSecondary, margin: "10px 0 0", fontFamily: F.body }}>
          {note}
        </p>
      )}
    </div>
  );
});
