import { memo } from "react";
import { Award, FileDown, Printer, BarChart3 } from "lucide-react";
import { F, COLORS } from "./report-constants";
import { GlassPanel } from "./ReportCharts";

const MEDALS = ["🥇", "🥈", "🥉"];
const MEDAL_COLORS = ["#d4973a", "var(--color-text-tertiary, #98a0b8)", "#d4973a"];

const AgentCard = memo(function AgentCard({ agent: a, rank, fmt, days }: { agent: unknown; rank: number; fmt: (v: string | number) => string; days: number }) {
  const agent = a as Record<string, unknown>;
  const isTop3 = rank < 3;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "16px", padding: "18px 20px",
      borderRadius: "16px", background: isTop3 ? "var(--color-primary-subtle, rgba(75,108,246,.10))" : COLORS.surface,
      boxShadow: isTop3 ? "0 2px 8px rgba(0,0,0,0.06)" : "0 1px 3px rgba(0,0,0,0.03)",
      border: isTop3 ? "1px solid rgba(75,108,246,.15)" : "none",
    }}>
      <div style={{
        width: "40px", height: "40px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center",
        background: isTop3 ? `${MEDAL_COLORS[rank]}15` : COLORS.surfaceLight,
        fontFamily: F.body, fontSize: "16px", fontWeight: 700,
        color: isTop3 ? MEDAL_COLORS[rank] : COLORS.textTertiary,
      }}>
        {isTop3 ? MEDALS[rank] : rank + 1}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontFamily: F.body, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
          {String(agent.agentName ?? `Агент #${agent.agentId}`)}
        </p>
        <div style={{ display: "flex", gap: "16px", marginTop: "4px" }}>
          <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>
            <span style={{ fontWeight: 600, color: COLORS.textPrimary }}>{Number(agent.visits)}</span> визитов
          </span>
          <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>
            <span style={{ fontWeight: 600, color: COLORS.textPrimary }}>{Number(agent.orders)}</span> заказов
          </span>
        </div>
      </div>

      <div style={{ textAlign: "right" }}>
        <p style={{ fontFamily: F.body, fontSize: "16px", fontWeight: 700, color: "#5b6d8a", margin: 0 }}>
          {fmt(agent.revenue as string | number)}
        </p>
        <p style={{ fontSize: "11px", color: COLORS.textTertiary, margin: "2px 0 0" }}>выручка</p>
      </div>
    </div>
  );
});

const PODIUM_GRADIENTS = [
  "linear-gradient(135deg, #d4973a 0%, #e8b86d 100%)",
  "linear-gradient(135deg, #7a8ba8 0%, #a0aec0 100%)",
  "linear-gradient(135deg, #c47a3a 0%, #d9955a 100%)",
];

const AgentPodium = memo(function AgentPodium({ agents, fmt }: { agents: unknown[]; fmt: (v: string | number) => string }) {
  if (agents.length === 0) return null;
  const top3 = agents.slice(0, 3);
  return (
    <div>
      <h2 style={{
        fontFamily: F.display, fontSize: "16px", fontWeight: 700, color: COLORS.textPrimary,
        margin: "0 0 16px", letterSpacing: "-0.02em",
      }}>
        🏆 Рейтинг агентов
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
        {top3.map((a, i) => {
          const agent = a as Record<string, unknown>;
          return (
            <div key={String(agent.agentId)} style={{
              padding: "24px",
              borderRadius: "20px",
              background: PODIUM_GRADIENTS[i],
              color: "#fff",
              boxShadow: i === 0
                ? "0 8px 32px rgba(212,151,58,0.25)"
                : "0 4px 16px rgba(0,0,0,0.08)",
              position: "relative",
              overflow: "hidden",
            }}>
              <div style={{
                position: "absolute", top: "-10px", right: "-10px",
                fontSize: "80px", opacity: 0.12, lineHeight: 1,
              }}>
                {MEDALS[i]}
              </div>
              <div style={{ fontSize: "32px", marginBottom: "12px" }}>{MEDALS[i]}</div>
              <p style={{
                fontFamily: F.display, fontSize: "16px", fontWeight: 700,
                margin: "0 0 4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>
                {String(agent.agentName ?? `Агент #${agent.agentId}`)}
              </p>
              <p style={{
                fontFamily: F.display, fontSize: "24px", fontWeight: 800,
                margin: "0 0 12px", letterSpacing: "-0.03em",
              }}>
                {fmt(agent.revenue as string | number)}
              </p>
              <div style={{
                display: "flex", gap: "12px",
                borderTop: "1px solid rgba(255,255,255,0.2)", paddingTop: "12px",
              }}>
                <span style={{ fontSize: "12px", opacity: 0.9 }}>
                  <strong>{Number(agent.orders)}</strong> заказов
                </span>
                <span style={{ fontSize: "12px", opacity: 0.9 }}>
                  <strong>{Number(agent.visits)}</strong> визитов
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

interface AgentsTabProps {
  agents: { agentId: number; agentName: string; revenue: number; orders: number; visits: number }[] | undefined;
  days: number;
  fmt: (v: string | number) => string;
  t: (ru: string, uz: string) => string;
  onExport: () => void;
  onExportPDF: () => void;
}

export const AgentsTab = memo(function AgentsTab({
  agents, days, fmt, t, onExport, onExportPDF,
}: AgentsTabProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Summary */}
      <GlassPanel style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: "var(--kpi-purple)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Award size={18} color="#fff" />
          </div>
          <div>
            <p style={{ fontFamily: F.body, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
              {t(`Топ агентов за ${days} дней`, `Top agentlar (${days} kun)`)}
            </p>
            <p style={{ fontSize: "12px", color: COLORS.textTertiary, margin: "2px 0 0" }}>
              {agents?.length ?? 0} {t("агентов", "ta agent")}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={onExport} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
            fontSize: "12px", fontWeight: 600, fontFamily: F.body, borderRadius: "8px",
            border: "none", cursor: "pointer", background: COLORS.surfaceLight, color: COLORS.textSecondary,
          }}>
            <FileDown size={13} /> Excel
          </button>
          <button onClick={onExportPDF} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
            fontSize: "12px", fontWeight: 600, fontFamily: F.body, borderRadius: "8px",
            border: "none", cursor: "pointer", background: COLORS.surfaceLight, color: COLORS.textSecondary,
          }}>
            <FileDown size={13} /> PDF
          </button>
          <button onClick={() => window.print()} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
            fontSize: "12px", fontWeight: 600, fontFamily: F.body, borderRadius: "8px",
            border: "none", cursor: "pointer", background: COLORS.surfaceLight, color: COLORS.textSecondary,
          }}>
            <Printer size={13} />
          </button>
        </div>
      </GlassPanel>

      {/* Agent ranking podium */}
      {agents && agents.length > 0 && (
        <AgentPodium agents={agents} fmt={fmt} />
      )}

      {/* Agent cards */}
      {(!agents || agents.length === 0) ? (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          <BarChart3 size={32} style={{ color: COLORS.textTertiary, margin: "0 auto 12px", opacity: 0.3 }} />
          <p style={{ fontSize: "14px", color: COLORS.textSecondary }}>{t("Нет данных", "Ma'lumot yo'q")}</p>
        </div>
      ) : (
        agents.map((agent, i) => (
          <AgentCard key={agent.agentId} agent={agent} rank={i} fmt={fmt} days={days} />
        ))
      )}
    </div>
  );
});
