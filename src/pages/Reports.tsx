import { memo, useCallback, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { format, subDays } from "date-fns";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from "recharts";
import { Users, MapPin, ClipboardList, TrendingUp, Activity, FileDown, Printer, LayoutDashboard, ShoppingCart, Award, Package, BarChart3 } from "lucide-react";
import { exportToExcel, formatAgentsForExport } from "@/lib/excel";
import { ProgressRing } from "@/components/ProgressRing";
import { CardDots, Card, KpiCard, PageHeader, SectionTitle, thStyle, tdStyle, btnSecondary, PeriodPicker, ChartPanel, GlassPanel } from "@/components/DashboardLayout";

type TabKey = "overview" | "sales" | "agents";

const MEDALS = ["🥇", "🥈", "🥉"];
const MEDAL_COLORS = ["var(--color-warning, #fbbf24)", "var(--color-text-tertiary, #9ca3af)", "var(--color-warning, #fbbf24)"];

const AgentCard = memo(function AgentCard({ agent: a, rank, fmt, days }: { agent: unknown; rank: number; fmt: (v: string | number) => string; days: number }) {
  const agent = a as Record<string, unknown>;
  const isTop3 = rank < 3;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "16px", padding: "18px 20px",
      borderRadius: "16px", background: isTop3 ? "var(--color-primary-subtle, rgba(129,140,248,.04))" : "var(--color-surface, #ffffff)",
      boxShadow: isTop3 ? "0 2px 8px rgba(0,0,0,.06)" : "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06))",
      border: isTop3 ? "1px solid var(--color-primary-subtle, rgba(129,140,248,.15))" : "none",
    }}>
      <div style={{ width: "40px", height: "40px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", background: isTop3 ? `${MEDAL_COLORS[rank]}15` : "var(--color-surface-light, #f8f9fb)", fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 700, color: isTop3 ? MEDAL_COLORS[rank] : "var(--color-text-tertiary, #9ca3af)" }}>
        {isTop3 ? MEDALS[rank] : rank + 1}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary, #111827)", margin: 0 }}>{String(agent.agentName ?? `Агент #${agent.agentId}`)}</p>
        <div style={{ display: "flex", gap: "16px", marginTop: "4px" }}>
          <span style={{ fontSize: "12px", color: "var(--color-text-secondary, #6b7280)" }}><span style={{ fontWeight: 600, color: "var(--color-text-primary, #111827)" }}>{Number(agent.visits)}</span> {t("визитов", "tashrif")}</span>
          <span style={{ fontSize: "12px", color: "var(--color-text-secondary, #6b7280)" }}><span style={{ fontWeight: 600, color: "var(--color-text-primary, #111827)" }}>{Number(agent.orders)}</span> {t("заказов", "buyurtma")}</span>
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--color-primary, #818cf8)", margin: 0 }}>{fmt(agent.revenue as string | number)}</p>
        <p style={{ fontSize: "11px", color: "var(--color-text-tertiary, #9ca3af)", margin: "2px 0 0" }}>{t("выручка", "tushum")}</p>
      </div>
    </div>
  );
  function t(ru: string, uz: string) { return lang === "uz" ? uz : ru; }
  const { lang } = useLang();
});

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

  const shopChartData = (byShop ?? []).map(s => ({ name: (s.shopName ?? "—").slice(0, 14), revenue: Number(s.revenue), fullName: s.shopName ?? "—" }));
  const totalRevenue = topProds?.reduce((s, p) => s + Number(p.totalRevenue), 0) ?? 0;

  const TABS = [
    { key: "overview" as const, ru: "Обзор", uz: "Umumiy", icon: <LayoutDashboard size={16} /> },
    { key: "sales" as const, ru: "Продажи", uz: "Sotuvlar", icon: <ShoppingCart size={16} /> },
    { key: "agents" as const, ru: "Агенты", uz: "Agentlar", icon: <Award size={16} /> },
  ];

  const handleExport = () => {
    if (!agents?.length) return;
    exportToExcel(formatAgentsForExport(agents, days), `report-${format(new Date(), "yyyy-MM-dd")}`, t("Отчёт", "Hisobot"));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader title={t("Отчёты", "Hisobotlar")} subtitle={format(new Date(), "dd MMMM yyyy")} actions={<button onClick={handleExport} style={btnSecondary}><FileDown size={14} /> Excel</button>} />

      {/* Tabs */}
      <div style={{ display: "inline-flex", background: "var(--color-surface-light, #f3f4f6)", borderRadius: "12px", padding: "3px", gap: "2px", alignSelf: "flex-start" }}>
        {TABS.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", fontSize: "13px", fontWeight: 600, fontFamily: "'DM Sans', sans-serif", borderRadius: "8px", border: "none", cursor: "pointer", background: tab === tb.key ? "var(--color-surface, #ffffff)" : "transparent", color: tab === tb.key ? "var(--color-text-primary, #111827)" : "var(--color-text-secondary, #6b7280)", boxShadow: tab === tb.key ? "0 1px 3px rgba(0,0,0,.08)" : "none", transition: "all 0.15s" }}>
            {tb.icon} {t(tb.ru, tb.uz)}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {summaryLoading ? <div style={{ padding: "32px", textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)" }}>...</div> : summary && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
              <KpiCard label={t("АГЕНТОВ", "AGENTLAR")} value={String(summary.totalAgents)} icon={<Users size={18} color="#a78bfa" />} gradient="rgba(167,139,250,.10)"><p style={{ fontSize: "12px", color: "var(--color-text-secondary, #6b7280)", margin: "4px 0 0" }}>{summary.activeNow} {t("онлайн", "onlayn")}</p></KpiCard>
              <KpiCard label={t("ВИЗИТЫ", "TASHRIFLAR")} value={String(summary.visitsToday)} icon={<MapPin size={18} color="#2dd4bf" />} gradient="rgba(45,212,191,.10)" />
              <KpiCard label={`${t("ЗАКАЗЫ", "BUYURTMA")} ${days}д`} value={String(summary.ordersMonth)} icon={<ClipboardList size={18} color="#fb923c" />} gradient="rgba(251,146,60,.10)" />
              <KpiCard label={`${t("ВЫРУЧКА", "TUSHUM")} ${days}д`} value={fmt(summary.revenueMonth)} icon={<TrendingUp size={18} color="#4ade80" />} gradient="rgba(74,222,128,.10)" />
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <Card>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
                <SectionTitle title={t("Визиты и заказы", "Tashriflar va buyurtmalar")} />
                <PeriodPicker days={days} onChange={setDays} />
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chart ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #f3f4f6)" />
                  <XAxis dataKey="date" tick={{ fill: "var(--color-text-tertiary, #9ca3af)", fontSize: 11, fontFamily: "'DM Sans', sans-serif" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "var(--color-text-tertiary, #9ca3af)", fontSize: 11, fontFamily: "'DM Sans', sans-serif" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "var(--color-surface, #ffffff)", border: "none", borderRadius: 12, boxShadow: "0 4px 12px rgba(0,0,0,.08)" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="visits" stroke="var(--color-primary, #818cf8)" strokeWidth={2.5} dot={false} name={t("Визиты", "Tashriflar")} />
                  <Line type="monotone" dataKey="orders" stroke="var(--color-success, #4ade80)" strokeWidth={2.5} dot={false} name={t("Заказы", "Buyurtmalar")} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
            <Card>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                <Activity size={16} style={{ color: "var(--color-primary, #818cf8)" }} />
                <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600, color: "var(--color-text-primary, #111827)", margin: 0 }}>{t("План сегодня", "Bugungi reja")}</h2>
              </div>
              {plans?.length ? (() => {
                const totalVisited = plans.reduce((s, p) => s + Number(p.visited ?? 0), 0);
                const totalPlanned = plans.reduce((s, p) => s + Number(p.total ?? 0), 0);
                const pct = totalPlanned > 0 ? Math.round((totalVisited / totalPlanned) * 100) : 0;
                const ringColor = pct >= 80 ? "var(--color-success, #4ade80)" : pct >= 50 ? "var(--color-warning, #fbbf24)" : "var(--color-danger, #f87171)";
                return (
                  <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "20px", paddingBottom: "20px", borderBottom: "1px solid var(--color-border, #f3f4f6)" }}>
                    <ProgressRing value={pct} color={ringColor} label={`${pct}%`} />
                    <div>
                      <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary, #111827)", margin: 0 }}>{totalVisited} {t("из", "dan")} {totalPlanned} {t("выполнено", "bajarildi")}</p>
                      <p style={{ fontSize: "11px", color: "var(--color-text-tertiary, #9ca3af)", margin: "4px 0 0" }}>{t("все агенты", "barcha agentlar")}</p>
                    </div>
                  </div>
                );
              })() : null}
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                {(plans ?? []).map((a) => {
                  const agent = a as Record<string, unknown>;
                  const pct = Math.min(100, Math.round(Number(agent.pct ?? 0)));
                  const color = pct >= 80 ? "var(--color-success, #4ade80)" : pct >= 50 ? "var(--color-warning, #fbbf24)" : "var(--color-danger, #f87171)";
                  return (
                    <div key={String(agent.agentId)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                        <span style={{ fontSize: "13px", color: "var(--color-text-primary, #111827)", fontFamily: "'DM Sans', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "150px" }}>{String(agent.agentName ?? `Агент #${agent.agentId}`)}</span>
                        <span style={{ fontSize: "12px", fontWeight: 600, color, fontFamily: "'DM Sans', sans-serif" }}>{String(agent.visited)}/{String(agent.total)} · {pct}%</span>
                      </div>
                      <div style={{ height: "6px", background: "var(--color-surface-light, #f3f4f6)", borderRadius: "3px", overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: "3px", width: `${pct}%`, background: color, transition: "width 0.5s ease" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Sales */}
      {tab === "sales" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <Card>
            <SectionTitle title={t("Продажи по магазинам", "Do'konlar bo'yicha sotuvlar")} />
            <ResponsiveContainer width="100%" height={280} style={{ marginTop: "16px" }}>
              <BarChart data={shopChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #f3f4f6)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "var(--color-text-tertiary, #9ca3af)", fontSize: 11, fontFamily: "'DM Sans', sans-serif" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "var(--color-text-tertiary, #9ca3af)", fontSize: 11, fontFamily: "'DM Sans', sans-serif" }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v, true)} />
                <Tooltip contentStyle={{ background: "var(--color-surface, #ffffff)", border: "none", borderRadius: 12, boxShadow: "0 4px 12px rgba(0,0,0,.08)" }} cursor={{ fill: "var(--color-surface-light, #f8f9fb)" }} />
                <Bar dataKey="revenue" name={t("Выручка", "Tushum")} radius={[6, 6, 0, 0]} maxBarSize={48}>
                  {shopChartData.map((_, i) => { const palette = ["var(--kpi-indigo, #818cf8)", "var(--kpi-teal, #2dd4bf)", "var(--kpi-coral, #fb7185)", "var(--kpi-amber, #fbbf24)", "var(--kpi-blue, #60a5fa)", "var(--kpi-purple, #a78bfa)", "var(--kpi-green, #4ade80)"]; return <Cell key={i} fill={palette[i % palette.length]} />; })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
          <Card>
            <SectionTitle title={t("Топ товаров", "Top mahsulotlar")} />
            <div style={{ overflowX: "auto", marginTop: "16px" }}>
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                <thead><tr><th style={thStyle}>{t("Товар", "Mahsulot")}</th><th style={thStyle}>{t("Код", "Kod")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("Объём", "Hajm")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("Выручка", "Tushum")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("Доля", "Ulush")}</th></tr></thead>
                <tbody>
                  {(topProds ?? []).map((p, i) => { const share = totalRevenue > 0 ? (Number(p.totalRevenue) / totalRevenue) * 100 : 0; return (
                    <tr key={i} style={{ transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-light, #f8f9fb)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <td style={tdStyle}><div style={{ display: "flex", alignItems: "center", gap: "10px" }}><Package size={14} style={{ color: "var(--color-primary, #818cf8)", flexShrink: 0 }} /><span style={{ fontSize: "13px", fontWeight: 500 }}>{p.productName}</span></div></td>
                      <td style={{ ...tdStyle, color: "var(--color-text-tertiary, #9ca3af)", fontSize: "12px" }}>{p.productCode ?? "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{Number(p.totalQty).toFixed(0)} кг</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600, color: "var(--color-primary, #818cf8)" }}>{fmt(p.totalRevenue)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}><div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px" }}><div style={{ width: "60px", height: "6px", background: "var(--color-surface-light, #f3f4f6)", borderRadius: "3px", overflow: "hidden" }}><div style={{ width: `${share}%`, height: "100%", background: "var(--color-primary, #818cf8)", borderRadius: "3px" }} /></div><span style={{ fontSize: "12px", color: "var(--color-text-tertiary, #9ca3af)", width: "40px", textAlign: "right" }}>{share.toFixed(1)}%</span></div></td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Agents */}
      {tab === "agents" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {(!agents || agents.length === 0) ? (
            <div style={{ textAlign: "center", padding: "48px 0" }}><BarChart3 size={32} style={{ color: "var(--color-text-tertiary, #9ca3af)", margin: "0 auto 12px", opacity: 0.3 }} /><p style={{ fontSize: "14px", color: "var(--color-text-secondary, #6b7280)" }}>{t("Нет данных", "Ma'lumot yo'q")}</p></div>
          ) : agents.map((agent, i) => <AgentCard key={agent.agentId} agent={agent} rank={i} fmt={fmt} days={days} />)}
        </div>
      )}
    </div>
  );
}
