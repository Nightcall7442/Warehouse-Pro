import { memo } from "react";
import { useNavigate } from "react-router";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { Trophy, Flame, Target, Award, Star, TrendingUp } from "lucide-react";

interface LeaderboardEntry {
  rank: number;
  agentId: number;
  agentName: string;
  orderCount: number;
  revenue: number;
  visitCount: number;
}

interface Achievement {
  id: string;
  title: string;
  titleUz?: string;
  icon: string;
  unlocked: boolean;
}

interface GamificationData {
  leaderboard: LeaderboardEntry[];
  myStats: {
    weeklyOrders: number;
    weeklyRevenue: number;
    monthlyOrders: number;
    streak: number;
  };
  achievements: Achievement[];
  topAgent?: { name: string; revenue: number } | null;
}

const RANK_COLORS = ["#e8a830", "#9ca3af", "#cd7f32"];
const RANK_ICONS = ["🥇", "🥈", "🥉"];

export const GamificationCard = memo(function GamificationCard({ data }: { data: GamificationData }) {
  const navigate = useNavigate();
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  return (
    <div className="neo-card" style={{ padding: "20px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
        <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
          <Trophy size={16} style={{ color: "#e8a830" }} />
          {t("Достижения", "Yutuqlar")}
        </h2>
        <button onClick={() => navigate("/agent")} style={{ fontSize: "12px", color: "var(--color-primary)", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
          {t("Все", "Barchasi")} →
        </button>
      </div>

      {/* My Stats Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "16px" }}>
        <div className="neo-card-sm" style={{ padding: "12px", textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", marginBottom: "4px" }}>
            <Flame size={14} style={{ color: "#e85050" }} />
            <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {t("Серия", "Seriya")}
            </span>
          </div>
          <p style={{ fontSize: "22px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>
            {data.myStats.streak}
          </p>
          <p style={{ fontSize: "10px", color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>
            {t("дн.", "kun")}
          </p>
        </div>

        <div className="neo-card-sm" style={{ padding: "12px", textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", marginBottom: "4px" }}>
            <Target size={14} style={{ color: "#4b6cf6" }} />
            <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {t("Заказы", "Buyurtmalar")}
            </span>
          </div>
          <p style={{ fontSize: "22px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>
            {data.myStats.weeklyOrders}
          </p>
          <p style={{ fontSize: "10px", color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>
            {t("за неделю", "haftada")}
          </p>
        </div>

        <div className="neo-card-sm" style={{ padding: "12px", textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", marginBottom: "4px" }}>
            <TrendingUp size={14} style={{ color: "#34c473" }} />
            <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {t("Выручка", "Tushum")}
            </span>
          </div>
          <p style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>
            {fmt(data.myStats.weeklyRevenue, true)}
          </p>
          <p style={{ fontSize: "10px", color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>
            {t("за неделю", "haftada")}
          </p>
        </div>
      </div>

      {/* Achievements */}
      {data.achievements.length > 0 && (
        <div style={{ marginBottom: "16px" }}>
          <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
            {t("Разблокированные", "Ochildi")}
          </p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {data.achievements.map(a => (
              <div key={a.id} style={{
                display: "flex", alignItems: "center", gap: "6px", padding: "6px 10px",
                borderRadius: "8px", background: "rgba(232,168,48,0.08)", border: "1px solid rgba(232,168,48,0.15)",
              }}>
                <span style={{ fontSize: "14px" }}>{a.icon}</span>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "#e8a830" }}>
                  {lang === "uz" && a.titleUz ? a.titleUz : a.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Leaderboard */}
      {data.leaderboard.length > 0 && (
        <div>
          <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
            {t("Топ агентов за неделю", "Haftalik top agentlar")}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {data.leaderboard.slice(0, 5).map((entry, i) => (
              <div key={entry.agentId} style={{
                display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px",
                borderRadius: "10px", background: i < 3 ? `${RANK_COLORS[i]}08` : "transparent",
                border: i < 3 ? `1px solid ${RANK_COLORS[i]}20` : "1px solid transparent",
              }}>
                <div style={{
                  width: "24px", height: "24px", borderRadius: "6px", display: "flex",
                  alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 700,
                  background: i < 3 ? `${RANK_COLORS[i]}15` : "var(--color-surface-light)",
                  color: i < 3 ? RANK_COLORS[i] : "var(--color-text-tertiary)",
                }}>
                  {i < 3 ? RANK_ICONS[i] : entry.rank}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {entry.agentName}
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-primary)", margin: 0 }}>
                    {entry.orderCount}
                  </p>
                  <p style={{ fontSize: "10px", color: "var(--color-text-tertiary)", margin: 0 }}>
                    {t("заказов", "buyurtma")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Agent of Month */}
      {data.topAgent && (
        <div style={{
          marginTop: "12px", padding: "12px", borderRadius: "12px",
          background: "linear-gradient(135deg, rgba(232,168,48,0.08), rgba(232,168,48,0.02))",
          border: "1px solid rgba(232,168,48,0.15)", display: "flex", alignItems: "center", gap: "10px",
        }}>
          <Award size={18} style={{ color: "#e8a830" }} />
          <div>
            <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: 0 }}>
              {t("Лучший агент месяца", "Oyning eng yaxshi agenti")}
            </p>
            <p style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)", margin: "2px 0 0" }}>
              {data.topAgent.name} — {fmt(data.topAgent.revenue, true)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
});
