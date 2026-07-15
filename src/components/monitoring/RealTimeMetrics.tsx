import { BarChart3 } from "lucide-react";
import { COLORS, F } from "./theme";
import { Section } from "./Section";

interface MetricEntry {
  count: number;
  lastValue: number | string;
  lastTimestamp: number;
}

interface RealTimeMetricsProps {
  metrics: Record<string, MetricEntry>;
}

export function RealTimeMetrics({ metrics }: RealTimeMetricsProps) {
  if (Object.keys(metrics).length === 0) return null;

  return (
    <Section title="Метрики" icon={BarChart3} delay={0.5}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: "13px", fontFamily: F.body }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
              {["Метрика", "Записей", "Значение", "Время"].map((h) => (
                <th key={h} style={{
                  fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase",
                  letterSpacing: "0.08em", padding: "12px 16px",
                  textAlign: h === "Метрика" ? "left" : "right",
                  color: COLORS.textTertiary,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(metrics).map(([name, m]) => (
              <tr key={name} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                <td style={{ padding: "10px 16px", fontFamily: "monospace", fontSize: "12px", color: COLORS.primary }}>{name}</td>
                <td style={{ padding: "10px 16px", textAlign: "right", color: COLORS.textSecondary }}>{m.count}</td>
                <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600, color: COLORS.textPrimary }}>{m.lastValue}</td>
                <td style={{ padding: "10px 16px", textAlign: "right", fontSize: "12px", color: COLORS.textTertiary }}>{new Date(m.lastTimestamp).toLocaleTimeString("ru")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
