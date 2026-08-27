import { COLORS, F } from "./theme";

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ color?: string; name: string; value: string | number }>;
  label?: string;
}

/**
 * Значение в подсказке.
 *
 * Деньги и количества приходят из MySQL строкой — DECIMAL сериализуется как
 * "64852100.0000". Прежняя проверка typeof === "number" такую строку не
 * ловила и выводила её как есть: четыре знака после запятой у суммы в сумах и
 * ни одного разделителя разрядов.
 */
function formatValue(v: number | string | undefined): string {
  if (v === undefined || v === null) return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  // Два знака — потолок, а не обязанность: у целых чисел хвост не рисуется.
  return n.toLocaleString("ru", { maximumFractionDigits: 2 });
}

export function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: COLORS.surface, border: `1px solid ${COLORS.border}`,
      borderRadius: "var(--radius-md, 12px)", padding: "14px 16px", boxShadow: "var(--shadow-popover, 0 8px 24px rgba(0,0,0,0.12))",
      minWidth: "160px",
    }}>
      <p style={{ fontSize: "11px", fontWeight: 600, color: COLORS.textTertiary, marginBottom: "8px", fontFamily: F.body, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {label}
      </p>
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", marginTop: "4px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: p.color ?? "var(--kpi-indigo)" }} />
            <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{p.name}</span>
          </div>
          <span style={{ fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary, fontFamily: F.display }}>
            {formatValue(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
