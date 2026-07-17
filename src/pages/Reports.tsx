import { memo, useCallback, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { format, subDays } from "date-fns";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell,
} from "recharts";
import {
  Users, MapPin, ClipboardList, TrendingUp, Activity, FileDown, Printer,
  LayoutDashboard, ShoppingCart, Award, Package, BarChart3,
} from "lucide-react";
import { exportToExcel, formatAgentsForExport } from "@/lib/excel";
import { ProgressRing } from "@/components/ProgressRing";

const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };
const COLORS = {
  primary: "#5b6d8a", success: "#34c473",
  warning: "#d4973a", danger: "#d45050",
  surface: "var(--color-surface, #ffffff)", surfaceLight: "var(--color-surface-light, #f0f3f8)",
  textPrimary: "var(--color-text-primary, #2b3450)", textSecondary: "var(--color-text-secondary, #6a7290)",
  textTertiary: "var(--color-text-tertiary, #98a0b8)", border: "var(--color-border, #f0f3f8)",
};
const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

type TabKey = "overview" | "sales" | "agents";

// ── Premium KPI Card ──────────────────────────────────────────────────────────
const KpiCard = memo(function KpiCard({ label, value, sub, icon, gradient, delay }: {
  label: string; value: string; sub?: string;
  icon: React.ReactNode; gradient: string; delay: number;
}) {
  return (
    <div className="kpi-hero" style={{
      padding: "22px",
      position: "relative", overflow: "hidden",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>
          {label}
        </span>
        <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {icon}
        </div>
      </div>
      <div style={{ fontFamily: F.display, fontSize: "28px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, letterSpacing: "-0.03em" }}>
        {value}
      </div>
      {sub && (
        <p style={{ fontSize: "12px", color: COLORS.textSecondary, margin: "8px 0 0", fontFamily: F.body }}>
          {sub}
        </p>
      )}
    </div>
  );
});

// ── Premium Chart Container ───────────────────────────────────────────────────
const ChartPanel = memo(function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
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

// ── Glass Panel ───────────────────────────────────────────────────────────────
const GlassPanel = memo(function GlassPanel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: COLORS.surface, borderRadius: "20px", padding: "24px",
      boxShadow: SHADOW, ...style,
    }}>
      {children}
    </div>
  );
});

// ── Table row style ───────────────────────────────────────────────────────────
const thStyle: React.CSSProperties = {
  fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.08em", color: COLORS.textTertiary, padding: "12px 16px",
  borderBottom: `1px solid ${COLORS.border}`, textAlign: "left",
};
const tdStyle: React.CSSProperties = {
  padding: "14px 16px", borderBottom: `1px solid ${COLORS.border}`,
  fontSize: "14px", fontFamily: F.body, color: COLORS.textPrimary,
};

// ── Period Picker ─────────────────────────────────────────────────────────────
const PeriodPicker = memo(function PeriodPicker({ days, onChange }: { days: number; onChange: (d: number) => void }) {
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

// ── Plan Completion ───────────────────────────────────────────────────────────
const PlanCompletion = memo(function PlanCompletion({ data, t }: { data: unknown[]; t: (ru: string, uz: string) => string }) {
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

// ── Agent Card (for Agents tab) ───────────────────────────────────────────────
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
      {/* Rank */}
      <div style={{
        width: "40px", height: "40px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center",
        background: isTop3 ? `${MEDAL_COLORS[rank]}15` : COLORS.surfaceLight,
        fontFamily: F.body, fontSize: "16px", fontWeight: 700,
        color: isTop3 ? MEDAL_COLORS[rank] : COLORS.textTertiary,
      }}>
        {isTop3 ? MEDALS[rank] : rank + 1}
      </div>

      {/* Name + stats */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontFamily: F.body, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
          {String(agent.agentName ?? `Агент #${agent.agentId}`)}
        </p>
        <div style={{ display: "flex", gap: "16px", marginTop: "4px" }}>
          <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>
            <span style={{ fontWeight: 600, color: COLORS.textPrimary }}>{Number(agent.visits)}</span> {days <= 7 ? "визитов" : "визитов"}
          </span>
          <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>
            <span style={{ fontWeight: 600, color: COLORS.textPrimary }}>{Number(agent.orders)}</span> заказов
          </span>
        </div>
      </div>

      {/* Revenue */}
      <div style={{ textAlign: "right" }}>
        <p style={{ fontFamily: F.body, fontSize: "16px", fontWeight: 700, color: "#5b6d8a", margin: 0 }}>
          {fmt(agent.revenue as string | number)}
        </p>
        <p style={{ fontSize: "11px", color: COLORS.textTertiary, margin: "2px 0 0" }}>выручка</p>
      </div>
    </div>
  );
});

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Reports() {
  const [tab, setTab] = useState<TabKey>("overview");
  const [days, setDays] = useState(30);
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const t = useCallback((ru: string, uz: string) => lang === "uz" ? uz : ru, [lang]);

  const from = format(subDays(new Date(), days), "yyyy-MM-dd");
  const to = format(new Date(), "yyyy-MM-dd");

  const { data: summary, isLoading: summaryLoading } = trpc.reports.getDashboardSummary.useQuery();
  const { data: chart } = trpc.reports.getVisitChart.useQuery({ days });
  const { data: plans } = trpc.reports.getPlanCompletion.useQuery();
  const { data: byShop } = trpc.analytics.salesByShop.useQuery({ dateFrom: from, dateTo: to });
  const { data: topProds } = trpc.analytics.topProducts.useQuery({ dateFrom: from, dateTo: to });
  const { data: agents } = trpc.reports.getAgentPerformance.useQuery({ days });

  const shopChartData = (byShop ?? []).map(s => ({
    name: (s.shopName ?? "—").slice(0, 14), revenue: Number(s.revenue), fullName: s.shopName ?? "—",
  }));

  const totalRevenue = topProds?.reduce((s, p) => s + Number(p.totalRevenue), 0) ?? 0;

  const TABS = [
    { key: "overview" as const, ru: "Обзор", uz: "Umumiy", icon: <LayoutDashboard size={16} /> },
    { key: "sales" as const, ru: "Продажи", uz: "Sotuvlar", icon: <ShoppingCart size={16} /> },
    { key: "agents" as const, ru: "Агенты", uz: "Agentlar", icon: <Award size={16} /> },
  ];

  const handleExport = () => {
    if (!agents?.length) return;
    exportToExcel(formatAgentsForExport(agents, days), `report-${format(new Date(), "yyyy-MM-dd")}`, t("Отчёт", "Hisobot"), `${t("Сводный отчёт", "Yig'ma hisobot")} — ${format(new Date(), "dd.MM.yyyy")}`);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.025em", margin: 0 }}>
            {t("Отчёты", "Hisobotlar")}
          </h1>
          <p style={{ fontSize: "13px", color: COLORS.textSecondary, margin: "4px 0 0" }}>
            {format(new Date(), "dd MMMM yyyy")}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <PeriodPicker days={days} onChange={setDays} />
          <button onClick={handleExport} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
            fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
            border: "none", cursor: "pointer", background: COLORS.surfaceLight, color: COLORS.textSecondary,
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}>
            <FileDown size={14} /> Excel
          </button>
          <button onClick={() => window.print()} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
            fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
            border: "none", cursor: "pointer", background: COLORS.surfaceLight, color: COLORS.textSecondary,
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}>
            <Printer size={14} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "inline-flex", background: COLORS.surfaceLight, borderRadius: "14px", padding: "4px", gap: "4px", alignSelf: "flex-start" }}>
        {TABS.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)} style={{
            display: "flex", alignItems: "center", gap: "8px", padding: "10px 20px",
            fontSize: "13px", fontWeight: 600, fontFamily: F.body, borderRadius: "10px",
            border: "none", cursor: "pointer", transition: "all 0.2s",
            background: tab === tb.key ? COLORS.surface : "transparent",
            color: tab === tb.key ? COLORS.textPrimary : COLORS.textSecondary,
            boxShadow: tab === tb.key ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
          }}>
            {tb.icon}
            {t(tb.ru, tb.uz)}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
      {tab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* KPIs */}
          {summaryLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => <div key={i} className="kpi-hero" style={{ height: "160px" }} />)}
            </div>
          ) : summary && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard label={t("АГЕНТОВ", "AGENTLAR")} value={String(summary.totalAgents)} sub={`${summary.activeNow} ${t("онлайн", "onlayn")}`} icon={<Users size={20} color="#fff" />} gradient="linear-gradient(135deg, var(--kpi-purple), var(--kpi-purple))" delay={0} />
              <KpiCard label={t("ВИЗИТЫ", "TASHRIFLAR")} value={String(summary.visitsToday)} icon={<MapPin size={20} color="#fff" />} gradient="linear-gradient(135deg, var(--kpi-teal), var(--kpi-teal))" delay={0.05} />
              <KpiCard label={`${t("ЗАКАЗЫ", "BUYURTMA")} ${days}д`} value={String(summary.ordersMonth)} sub={`≈${summary.avgOrdersPerAgent}/${t("агент", "agent")}`} icon={<ClipboardList size={20} color="#fff" />} gradient="linear-gradient(135deg, var(--kpi-orange), var(--kpi-orange))" delay={0.1} />
              <KpiCard label={`${t("ВЫРУЧКА", "TUSHUM")} ${days}д`} value={fmt(summary.revenueMonth)} icon={<TrendingUp size={20} color="#fff" />} gradient="linear-gradient(135deg, var(--kpi-green), var(--kpi-green))" delay={0.15} />
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Chart */}
            <ChartPanel title={t("Визиты и заказы", "Tashriflar va buyurtmalar")}>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chart ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                  <XAxis dataKey="date" tick={{ fill: COLORS.textTertiary, fontSize: 11, fontFamily: F.body }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
                  <YAxis tick={{ fill: COLORS.textTertiary, fontSize: 11, fontFamily: F.body }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: COLORS.surface, border: "none", borderRadius: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="visits" stroke="#5b6d8a" strokeWidth={2.5} dot={false} name={t("Визиты", "Tashriflar")} />
                  <Line type="monotone" dataKey="orders" stroke="#34c473" strokeWidth={2.5} dot={false} name={t("Заказы", "Buyurtmalar")} />
                </LineChart>
              </ResponsiveContainer>
            </ChartPanel>

            {/* Plan completion */}
            <GlassPanel>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                <Activity size={16} style={{ color: COLORS.primary }} />
                <h2 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
                  {t("План сегодня", "Bugungi reja")}
                </h2>
              </div>
              {!!plans?.length && (() => {
                const totalVisited = plans.reduce((s, p) => s + Number(p.visited ?? 0), 0);
                const totalPlanned = plans.reduce((s, p) => s + Number(p.total ?? 0), 0);
                const pct = totalPlanned > 0 ? Math.round((totalVisited / totalPlanned) * 100) : 0;
                const ringColor = pct >= 80 ? "#34c473" : pct >= 50 ? "#d4973a" : "#d45050";
                return (
                  <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "20px", paddingBottom: "20px", borderBottom: `1px solid ${COLORS.border}` }}>
                    <ProgressRing value={pct} color={ringColor} label={`${pct}%`} />
                    <div>
                      <p style={{ fontSize: "13px", fontWeight: 500, color: COLORS.textPrimary, margin: 0 }}>{totalVisited} {t("из", "dan")} {totalPlanned} {t("выполнено", "bajarildi")}</p>
                      <p style={{ fontSize: "11px", color: COLORS.textTertiary, margin: "4px 0 0" }}>{t("все агенты", "barcha agentlar")}</p>
                    </div>
                  </div>
                );
              })()}
              <PlanCompletion data={plans ?? []} t={t} />
            </GlassPanel>
          </div>
        </div>
      )}

      {/* ── SALES ────────────────────────────────────────────────────── */}
      {tab === "sales" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Chart */}
          <ChartPanel title={t("Продажи по магазинам", "Do'konlar bo'yicha sotuvlar")}>
            {!shopChartData.length ? (
              <p style={{ color: COLORS.textSecondary, fontSize: "13px", textAlign: "center", padding: "40px 0" }}>
                {t("Нет данных за период", "Davr uchun ma'lumot yo'q")}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={shopChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: COLORS.textTertiary, fontSize: 11, fontFamily: F.body }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: COLORS.textTertiary, fontSize: 11, fontFamily: F.body }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v, true)} />
                  <Tooltip contentStyle={{ background: COLORS.surface, border: "none", borderRadius: 12, boxShadow: "0 4px 12px rgba(0,0,0,.08)" }} cursor={{ fill: COLORS.surfaceLight }} />
                  <Bar dataKey="revenue" name={t("Выручка", "Tushum")} radius={[6, 6, 0, 0]} maxBarSize={48}>
                    {shopChartData.map((_, i) => {
                      const palette = ["var(--kpi-indigo)", "var(--kpi-teal)", "var(--kpi-coral)", "var(--kpi-amber)", "var(--kpi-blue)", "var(--kpi-purple)", "var(--kpi-green)"];
                      return <Cell key={i} fill={palette[i % palette.length]} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartPanel>

          {/* Top products table */}
          <GlassPanel>
            <h2 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 600, color: COLORS.textPrimary, margin: "0 0 16px" }}>
              {t("Топ товаров", "Top mahsulotlar")}
            </h2>
            {!topProds?.length ? (
              <p style={{ color: COLORS.textSecondary, fontSize: "13px", textAlign: "center", padding: "32px 0" }}>
                {t("Нет данных", "Ma'lumot yo'q")}
              </p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>{t("Товар", "Mahsulot")}</th>
                      <th style={thStyle}>{t("Код", "Kod")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("Объём", "Hajm")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("Выручка", "Tushum")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("Доля", "Ulush")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProds.map((p, i) => {
                      const share = totalRevenue > 0 ? (Number(p.totalRevenue) / totalRevenue) * 100 : 0;
                      return (
                        <tr key={i} style={{ transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(75,108,246,0.02)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                          <td style={tdStyle}>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                              <Package size={14} style={{ color: COLORS.primary, flexShrink: 0 }} />
                              <span style={{ fontSize: "13px", fontWeight: 500 }}>{p.productName}</span>
                            </div>
                          </td>
                          <td style={{ ...tdStyle, color: COLORS.textTertiary, fontSize: "12px" }}>{p.productCode ?? "—"}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{Number(p.totalQty).toFixed(0)} кг</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600, color: COLORS.primary }}>{fmt(p.totalRevenue)}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px" }}>
                              <div style={{ width: "60px", height: "6px", background: COLORS.surfaceLight, borderRadius: "3px", overflow: "hidden" }}>
                                <div style={{ width: `${share}%`, height: "100%", background: COLORS.primary, borderRadius: "3px" }} />
                              </div>
                              <span style={{ fontSize: "12px", color: COLORS.textTertiary, width: "40px", textAlign: "right" }}>{share.toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </GlassPanel>
        </div>
      )}

      {/* ── AGENTS ───────────────────────────────────────────────────── */}
      {tab === "agents" && (
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
              <button onClick={handleExport} style={{
                display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
                fontSize: "12px", fontWeight: 600, fontFamily: F.body, borderRadius: "8px",
                border: "none", cursor: "pointer", background: COLORS.surfaceLight, color: COLORS.textSecondary,
              }}>
                <FileDown size={13} /> Excel
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
      )}
    </div>
  );
}
