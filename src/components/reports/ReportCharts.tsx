import { memo } from "react";
import { F, COLORS, SHADOW } from "./report-constants";

export const ChartPanel = memo(function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: COLORS.surface, borderRadius: "20px", padding: "24px",
      boxShadow: SHADOW, position: "relative", overflow: "hidden",
    }}>
      <h2 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 600, color: COLORS.textPrimary, margin: "0 0 20px" }}>
        {title}
      </h2>
      {children}
    </div>
  );
});

export const GlassPanel = memo(function GlassPanel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: COLORS.surface, borderRadius: "20px", padding: "24px",
      boxShadow: SHADOW, ...style,
    }}>
      {children}
    </div>
  );
});

export const PeriodPicker = memo(function PeriodPicker({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  const items = [
    { d: 7, label: "7 дней" }, { d: 30, label: "30 дней" }, { d: 90, label: "90 дней" },
  ];
  return (
    <div style={{ display: "inline-flex", background: COLORS.surfaceLight, borderRadius: "12px", padding: "3px", gap: "2px" }}>
      {items.map(r => (
        <button key={r.d} onClick={() => onChange(r.d)} style={{
          padding: "8px 16px", fontSize: "12px", fontWeight: 600, fontFamily: F.body,
          borderRadius: "10px", border: "none", cursor: "pointer", transition: "all 0.2s",
          background: days === r.d ? COLORS.surface : "transparent",
          color: days === r.d ? COLORS.textPrimary : COLORS.textSecondary,
          boxShadow: days === r.d ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
        }}>
          {r.label}
        </button>
      ))}
    </div>
  );
});

export const PlanCompletion = memo(function PlanCompletion({ data, t }: { data: unknown[]; t: (ru: string, uz: string) => string }) {
  if (!data?.length) return (
    <p style={{ color: COLORS.textSecondary, fontSize: "13px", textAlign: "center", padding: "24px 0" }}>
      {t("Нет данных за сегодня", "Bugun uchun ma'lumot yo'q")}
    </p>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {data.map((a) => {
        const agent = a as Record<string, unknown>;
        const pct = Math.min(100, Math.round(Number(agent.pct ?? 0)));
        const color = pct >= 80 ? "#34c473" : pct >= 50 ? "#d4973a" : "#d45050";
        return (
          <div key={String(agent.agentId)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <span style={{ fontSize: "13px", color: COLORS.textPrimary, fontFamily: F.body, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "150px" }}>
                {String(agent.agentName ?? `Агент #${agent.agentId}`)}
              </span>
              <span style={{ fontSize: "12px", fontWeight: 600, color, fontFamily: F.body }}>
                {String(agent.visited)}/{String(agent.total)} · {pct}%
              </span>
            </div>
            <div style={{ height: "6px", background: COLORS.surfaceLight, borderRadius: "3px", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: "3px", width: `${pct}%`, background: color, transition: "width 0.5s ease" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
});
