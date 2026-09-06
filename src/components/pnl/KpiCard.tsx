import React from "react";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { colorMix } from "@/lib/color-mix";
import { F, COLORS } from "./styles";

interface KpiCardProps {
  label: string;
  value: string;
  /** Изменение к прошлому периоду, %. null — сравнивать не с чем. */
  delta: number | null;
  /** Значение прошлого периода, уже отформатированное. */
  prev?: string | null;
  icon: React.ReactNode;
  /** Опознавательный оттенок метрики — переменная темы. */
  accent: string;
  /**
   * Рост этого показателя — хорошо?
   *
   * У выручки да, у себестоимости и расходов нет. Без этого поля стрелка
   * красилась по знаку числа, и «Себестоимость +38%» выходила зелёной —
   * страница поздравляла директора с тем, что деньги утекают быстрее.
   */
  higherIsBetter: boolean;
  /** Подпись «не с чем сравнивать» — на языке страницы. */
  noBaseLabel: string;
  prevLabel: string;
}

export function KpiCard({
  label,
  value,
  delta,
  prev,
  icon,
  accent,
  higherIsBetter,
  noBaseLabel,
  prevLabel,
}: KpiCardProps) {
  const grew = delta !== null && delta > 0;
  const fell = delta !== null && delta < 0;
  // Цвет стрелки — от смысла, а не от знака: рост расходов красный.
  const good = grew ? higherIsBetter : fell ? !higherIsBetter : null;
  const deltaInk =
    good === null
      ? COLORS.textTertiary
      : good
        ? "var(--color-success-text)"
        : "var(--color-danger-text)";

  return (
    <div className="kpi-hero" style={{ padding: "20px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "10px",
          marginBottom: "14px",
        }}
      >
        <span className="kpi-hero-label" style={{ lineHeight: 1.3 }}>
          {label}
        </span>
        {/* Оттенок опознаёт метрику, поэтому живёт в значке, а не в заливке:
            пять насыщенных плиток в ряд перекрикивали числа, которые они
            подписывают. Тот же приём, что на «Заказах» и «Слежении». */}
        <div
          className="kpi-tile"
          style={{ background: colorMix(accent, 14), color: accent, flexShrink: 0 }}
        >
          {icon}
        </div>
      </div>
      {/* Размер плавающий: на ноутбуке 1024 «128 400 000 сум» при 26 пикселях
          не помещалось в карточку и переносилось на вторую строку — четыре
          карточки в ряду становились разной высоты, а изменения под ними
          съезжали каждое на свой уровень. */}
      <div
        style={{
          fontFamily: F.display,
          fontSize: "clamp(19px, 1.9vw, 26px)",
          fontWeight: 700,
          color: COLORS.textPrimary,
          lineHeight: 1.05,
          letterSpacing: "-0.03em",
        }}
      >
        {value}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          marginTop: "10px",
          minHeight: "18px",
          fontSize: "12px",
          fontWeight: 600,
          fontFamily: F.body,
          fontVariantNumeric: "tabular-nums",
          color: deltaInk,
        }}
      >
        {delta === null ? (
          // Пустое место читалось как «изменений нет». Разница между «не
          // изменилось» и «сравнивать не с чем» для директора существенная.
          <span style={{ color: COLORS.textTertiary, fontWeight: 500 }}>{noBaseLabel}</span>
        ) : (
          <>
            {grew ? <ArrowUpRight size={14} /> : fell ? <ArrowDownRight size={14} /> : <Minus size={14} />}
            {grew ? "+" : fell ? "−" : ""}
            {Math.abs(delta).toFixed(1)}%
          </>
        )}
      </div>
      {prev && (
        <div
          style={{
            marginTop: "4px",
            fontSize: "11px",
            fontFamily: F.body,
            fontVariantNumeric: "tabular-nums",
            color: COLORS.textTertiary,
          }}
        >
          {prevLabel}: {prev}
        </div>
      )}
    </div>
  );
}
