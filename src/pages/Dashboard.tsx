import { memo, useCallback, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router";
import { getGreeting } from "@/lib/utils";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { ClipboardList, TrendingUp, TrendingDown, Sparkles, AlertCircle, ArrowRight, PieChart, Activity, Plus, Truck, RefreshCw, Package } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart as RePieChart, Pie, Cell, BarChart, Bar } from "recharts";
import { ProgressRing } from "@/components/ProgressRing";
import { CardDots } from "@/components/DashboardLayout";
import { GamificationCard } from "@/components/GamificationCard";
import { UsageDashboard } from "@/components/UsageDashboard";

type Range = "7d" | "30d" | "month";

interface DashboardKpis {
  todayOrders: number;
  todayRevenue: number;
  activeAgents: number;
  totalStock: number;
  customerDebt: number;
  grossMargin: number;
}

interface StatusEntry {
  status: string;
  count: string | number;
}

interface ActivityEntry {
  id: number;
  orderNumber: string;
  status: string;
  total: string;
  createdAt: string;
  agentName: string;
}

interface SmartAlert {
  severity: string;
  title: string;
  message: string;
}

const STATUS_COLOR: Record<string, string> = { new: "#4b6cf6", processing: "#e8a830", completed: "#34c473", cancelled: "#e85050" };
const STATUS_LABEL: Record<string, { ru: string; uz: string }> = {
  new: { ru: "Новые", uz: "Yangi" }, processing: { ru: "В обработке", uz: "Jarayonda" },
  completed: { ru: "Выполнены", uz: "Bajarildi" }, cancelled: { ru: "Отменены", uz: "Bekor qilindi" },
};

const CHART_COLORS = ["#4b6cf6", "#34c473", "#e8a830", "#e85050", "#8b7cf6", "#2ec4b0", "#f06895", "#f5a825"];

/* ── Chart Tooltip ───────────────────────────────────────────────────────── */
const ChartTooltip = memo(function ChartTooltip({ active, payload, label, fmt }: { active?: boolean; payload?: Array<{ dataKey: string; name: string; value: number; stroke: string }>; label?: string; fmt: (v: number, short?: boolean) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="neo-card-sm" style={{ padding: "12px 16px", minWidth: "160px" }}>
      <p style={{ fontSize: "10px", fontWeight: 700, color: "var(--color-text-tertiary, #8b9bb4)", marginBottom: "8px", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", marginTop: "6px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: p.stroke, boxShadow: "var(--shadow-xs)" }} />
            <span style={{ fontSize: "12px", color: "var(--color-text-secondary, #5a6a7f)" }}>{p.name}</span>
          </div>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary, #2d3748)" }}>
            {p.dataKey === "revenue" ? fmt(p.value, true) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
});

/* ── Pie Chart Tooltip ───────────────────────────────────────────────────── */
const PieTooltip = memo(function PieTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: { color: string; status: string } }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="neo-card-sm" style={{ padding: "10px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: p.payload.color, boxShadow: "var(--shadow-xs)" }} />
        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)" }}>{p.name}</span>
        <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-primary)" }}>{p.value}</span>
      </div>
    </div>
  );
});

/* ── Circular KPI Card ───────────────────────────────────────────────────── */
function CircularKpiCard({ label, value, subValue, color, icon, delay, onClick }: {
  label: string; value: string; subValue?: string; color: string; icon: React.ReactNode; delay: number; onClick?: () => void;
}) {
  return (
    <div className="kpi-hero stagger-children" style={{ cursor: onClick ? "pointer" : "default", animationDelay: `${delay}s` }} onClick={onClick}>
      <CardDots />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ flex: 1 }}>
          <p className="kpi-hero-label">{label}</p>
          <p className="kpi-hero-value" style={{ fontSize: "28px", marginTop: "10px" }}>{value}</p>
          {subValue && (
            <p style={{ fontSize: "12px", color: "var(--color-text-secondary, #5a6a7f)", marginTop: "4px" }}>{subValue}</p>
          )}
        </div>
        <div className="neo-progress-ring" style={{ width: "72px", height: "72px", flexShrink: 0 }}>
          <svg width="64" height="64" viewBox="0 0 64 64" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="32" cy="32" r="26" fill="none" stroke="var(--color-border, #c8d0dc)" strokeWidth="5" />
            <circle cx="32" cy="32" r="26" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 26}
              strokeDashoffset={2 * Math.PI * 26 * 0.3}
              style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.16,1,0.3,1)" }}
            />
          </svg>
          <div style={{ position: "absolute", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {icon}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Bar Chart Mini ──────────────────────────────────────────────────────── */
function MiniBarChart({ data, color }: { data: number[]; color: string }) {
  const barData = data.map((v, i) => ({ value: v, i }));
  return (
    <ResponsiveContainer width="100%" height={60}>
      <BarChart data={barData} barCategoryGap="20%">
        <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]}>
          {barData.map((_, index) => (
            <Cell key={`cell-${index}`} fill={color} fillOpacity={0.3 + (index / barData.length) * 0.7} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function Dashboard() {
  const [range, setRange] = useState<Range>("7d");
  const { fmt } = useCurrency();
  const { lang, t } = useLang();
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: kpis, isLoading } = trpc.dashboard.kpis.useQuery() as { data: DashboardKpis | undefined; isLoading: boolean };
  const { data: trends } = trpc.dashboard.trends.useQuery({ range });
  const { data: statusData } = trpc.dashboard.statusBreakdown.useQuery() as { data: StatusEntry[] | undefined };
  const { data: activity } = trpc.dashboard.activity.useQuery() as { data: ActivityEntry[] | undefined };
  const { data: alerts } = trpc.notification.smartAlerts.useQuery() as { data: SmartAlert[] | undefined };
  const { data: gamification } = trpc.agent.gamification.useQuery() as { data: any };

  const chartData = useMemo(() => trends?.map(tr => ({ date: format(new Date(tr.date), "dd/MM"), orders: tr.orderCount, revenue: Number(tr.revenue) })) ?? [], [trends]);
  const revenueTrend = useMemo(() => (trends ?? []).slice(-7).map(tr => Number(tr.revenue)), [trends]);
  const ordersTrend = useMemo(() => (trends ?? []).slice(-7).map(tr => tr.orderCount), [trends]);
  const prev7 = useMemo(() => (trends ?? []).slice(-14, -7), [trends]);
  const calcDelta = useCallback((curr: number[], prev: number[]): number => { const sumPrev = prev.reduce((a, b) => a + b, 0); const sumCurr = curr.reduce((a, b) => a + b, 0); if (sumPrev === 0) return sumCurr > 0 ? 100 : 0; return Math.round(((sumCurr - sumPrev) / sumPrev) * 1000) / 10; }, []);
  const revenueDelta = useMemo(() => calcDelta(revenueTrend, prev7.map(tr => Number(tr.revenue))), [calcDelta, revenueTrend, prev7]);
  const ordersDelta = useMemo(() => calcDelta(ordersTrend, prev7.map(tr => tr.orderCount)), [calcDelta, ordersTrend, prev7]);
  const statusTotal = useMemo(() => statusData?.reduce((s, d) => s + Number(d.count), 0) ?? 1, [statusData]);
  const greeting = getGreeting(t);

  // Pie chart data
  const pieData = useMemo(() =>
    statusData?.map((s, i) => ({
      name: STATUS_LABEL[s.status ?? ""]?.[lang] ?? s.status,
      value: Number(s.count),
      color: STATUS_COLOR[s.status ?? ""] ?? CHART_COLORS[i % CHART_COLORS.length],
      status: s.status,
    })) ?? []
  , [statusData, lang]);

  // Mini bar data for KPI cards
  const miniBarRevenue = useMemo(() => revenueTrend.slice(-7), [revenueTrend]);
  const miniBarOrders = useMemo(() => ordersTrend.slice(-7), [ordersTrend]);

  if (isLoading || !kpis) return (
    <div className="stagger-children" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ height: "28px", width: "240px", borderRadius: "12px", background: "var(--color-surface-light)" }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
        {[1, 2, 3, 4].map(i => <div key={i} className="neo-card" style={{ height: "160px" }} />)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "16px" }}>
        <div className="neo-card" style={{ height: "320px" }} />
        <div className="neo-card" style={{ height: "320px" }} />
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Header */}
      <div className="stagger-children" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <CardDots />
          <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "26px", fontWeight: 700, color: "var(--color-text-primary, #2d3748)", letterSpacing: "-0.025em", margin: 0 }}>
            {t("dashboard.title")}
          </h1>
          <p style={{ fontSize: "13px", color: "var(--color-text-secondary, #5a6a7f)", margin: "4px 0 0" }}>
            {greeting}, {user?.name?.split(" ")[0] ?? ""} — {format(new Date(), "EEEE, d MMMM yyyy", { locale: ru })}
          </p>
        </div>
        <button onClick={() => navigate("/orders/new")} className="neo-btn-primary">
          <Sparkles size={16} />
          <span>{t("orders.new")}</span>
        </button>
      </div>

      {/* Quick Actions */}
      <div className="stagger-children" style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        {[
          { label: t("orders.new"), icon: Plus, path: "/orders/new", color: "#4b6cf6" },
          { label: t("nav.deliveries", "Доставки"), icon: Truck, path: "/deliveries", color: "#34c473" },
          { label: t("nav.warehouse", "Склад"), icon: Package, path: "/warehouse", color: "#e8a830" },
          { label: t("nav.arrivals", "Приходы"), icon: RefreshCw, path: "/arrivals", color: "#8b7cf6" },
        ].map(action => (
          <button key={action.path} onClick={() => navigate(action.path)}
            className="neo-card-sm"
            style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 16px", cursor: "pointer", border: "none", transition: "all 0.2s" }}>
            <div style={{ width: "28px", height: "28px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", background: `${action.color}15` }}>
              <action.icon size={14} style={{ color: action.color }} />
            </div>
            <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)" }}>{action.label}</span>
          </button>
        ))}
      </div>

      {/* KPI Cards Row */}
      <div className="stagger-children" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
        {/* Revenue */}
        <div className="kpi-hero" style={{ cursor: "pointer" }} onClick={() => navigate("/reports")}>
          <CardDots />
          <p className="kpi-hero-label">{t("common.revenue")}</p>
          <p className="kpi-hero-value" style={{ fontSize: "28px", marginTop: "8px" }}>{fmt(kpis.todayRevenue, true)}</p>
          {revenueDelta !== 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "8px" }}>
              {revenueDelta > 0 ? <TrendingUp size={14} color="var(--color-success, #34c473)" /> : <TrendingDown size="14" color="var(--color-danger, #e85050)" />}
              <span style={{ fontSize: "12px", fontWeight: 600, color: revenueDelta > 0 ? "var(--color-success, #34c473)" : "var(--color-danger, #e85050)" }}>{Math.abs(revenueDelta).toFixed(1)}%</span>
            </div>
          )}
          {miniBarRevenue.length > 0 && (
            <div style={{ marginTop: "12px" }}>
              <MiniBarChart data={miniBarRevenue} color="var(--color-success, #34c473)" />
            </div>
          )}
        </div>

        {/* Orders */}
        <div className="kpi-hero" style={{ cursor: "pointer" }} onClick={() => navigate("/orders")}>
          <CardDots />
          <p className="kpi-hero-label">{t("orders.title")}</p>
          <p className="kpi-hero-value" style={{ fontSize: "28px", marginTop: "8px" }}>{kpis.todayOrders}</p>
          {ordersDelta !== 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "8px" }}>
              {ordersDelta > 0 ? <TrendingUp size={14} color="var(--color-success, #34c473)" /> : <TrendingDown size={14} color="var(--color-danger, #e85050)" />}
              <span style={{ fontSize: "12px", fontWeight: 600, color: ordersDelta > 0 ? "var(--color-success, #34c473)" : "var(--color-danger, #e85050)" }}>{Math.abs(ordersDelta).toFixed(1)}%</span>
            </div>
          )}
          {miniBarOrders.length > 0 && (
            <div style={{ marginTop: "12px" }}>
              <MiniBarChart data={miniBarOrders} color="var(--color-primary, #4b6cf6)" />
            </div>
          )}
        </div>

        {/* Debt */}
        <CircularKpiCard
          label={t("common.customerDebt")}
          value={fmt(kpis.customerDebt ?? 0, true)}
          color="var(--color-warning, #e8a830)"
          icon={<Activity size={18} color="var(--color-warning)" />}
          delay={0.1}
          onClick={() => navigate("/reports")}
        />

        {/* Gross Margin */}
        <div className="kpi-hero" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "16px" }} onClick={() => navigate("/reports")}>
          <div style={{ flex: 1 }}>
            <CardDots />
            <p className="kpi-hero-label">{t("common.grossMargin")}</p>
            <p className="kpi-hero-value" style={{ fontSize: "28px", marginTop: "8px" }}>{(kpis.grossMargin ?? 0).toFixed(1)}%</p>
          </div>
          <div className="neo-progress-ring" style={{ width: "80px", height: "80px" }}>
            <ProgressRing value={Math.max(0, Math.min(100, kpis.grossMargin ?? 0))} color="var(--color-primary, #4b6cf6)" size={72} strokeWidth={6} label={`${(kpis.grossMargin ?? 0).toFixed(0)}%`} />
          </div>
        </div>
      </div>

      {/* Smart Alerts */}
      {alerts && alerts.length > 0 && (
        <div style={{ display: "flex", gap: "12px", overflowX: "auto", paddingBottom: "4px" }}>
          {alerts.slice(0, 4).map((alert, i) => {
            const colors: Record<string, { bg: string; icon: string }> = {
              info: { bg: "var(--color-info-subtle)", icon: "var(--color-info, #4a9de8)" },
              warning: { bg: "var(--color-warning-subtle)", icon: "var(--color-warning, #e8a830)" },
              danger: { bg: "var(--color-danger-subtle)", icon: "var(--color-danger, #e85050)" },
            };
            const c = colors[alert.severity] || colors.info;
            return (
              <div key={i} className="neo-card-sm" style={{ flex: "0 0 auto", minWidth: "240px", padding: "14px 16px", display: "flex", alignItems: "center", gap: "12px", borderLeft: `3px solid ${c.icon}` }}>
                <div className="neo-btn-icon" style={{ width: "36px", height: "36px", color: c.icon }}>
                  {alert.severity === "danger" ? <AlertCircle size={16} /> : alert.severity === "warning" ? <TrendingDown size={16} /> : <TrendingUp size={16} />}
                </div>
                <div>
                  <p style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary, #2d3748)", margin: 0 }}>{alert.title}</p>
                  <p style={{ fontSize: "11px", color: "var(--color-text-secondary, #5a6a7f)", margin: "2px 0 0" }}>{alert.message}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Needs Attention — low stock + recent orders */}
      {(kpis.customerDebt > 0 || (activity && activity.length > 0)) && (
        <div className="neo-card" style={{ padding: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
              <AlertCircle size={16} style={{ color: "var(--color-warning)" }} />
              {t("dashboard.needsAttention", "Требует внимания")}
            </h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
            {kpis.customerDebt > 0 && (
              <div className="neo-card-sm" style={{ padding: "14px", cursor: "pointer" }} onClick={() => navigate("/reports")}>
                <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
                  {t("common.customerDebt", "Долг клиентов")}
                </p>
                <p style={{ fontSize: "20px", fontWeight: 700, color: "var(--color-warning)", margin: "6px 0 0" }}>
                  {fmt(kpis.customerDebt, true)}
                </p>
              </div>
            )}
            {activity && activity.slice(0, 3).map(order => (
              <div key={order.id} className="neo-card-sm" style={{ padding: "14px", cursor: "pointer" }} onClick={() => navigate(`/orders/${order.id}`)}>
                <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
                  {order.orderNumber}
                </p>
                <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)", margin: "4px 0 0" }}>
                  {fmt(Number(order.total), true)}
                </p>
                <p style={{ fontSize: "11px", color: "var(--color-text-secondary)", margin: "2px 0 0" }}>
                  {order.agentName} · {order.status}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts Row */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "16px" }}>
        {/* Sales Chart */}
        <div className="neo-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
            <div>
              <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary, #2d3748)", margin: 0 }}>
                {t("dashboard.salesDynamics")}
              </h2>
              <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #8b9bb4)", margin: "3px 0 0" }}>
                {t("dashboard.salesSubtitle")}
              </p>
            </div>
            <div className="range-pills">
              {([{ key: "7d" as const, label: "7д" }, { key: "30d" as const, label: "30д" }, { key: "month" as const, label: t("common.month") }]).map(r => (
                <button key={r.key} onClick={() => setRange(r.key)} className={`range-pill ${range === r.key ? "active" : ""}`}>{r.label}</button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary, #4b6cf6)" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="var(--color-primary, #4b6cf6)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gOrders" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-success, #34c473)" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="var(--color-success, #34c473)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fill: "var(--color-text-tertiary, #8b9bb4)", fontSize: 11, fontFamily: "'DM Sans', sans-serif" }} axisLine={false} tickLine={false} dy={8} />
              <YAxis yAxisId="left" tick={{ fill: "var(--color-text-tertiary, #8b9bb4)", fontSize: 11, fontFamily: "'DM Sans', sans-serif" }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v, true)} dx={-4} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: "var(--color-text-tertiary, #8b9bb4)", fontSize: 11, fontFamily: "'DM Sans', sans-serif" }} axisLine={false} tickLine={false} dx={4} />
              <Tooltip content={<ChartTooltip fmt={fmt} />} cursor={{ stroke: "var(--color-border, #c8d0dc)", strokeWidth: 1, strokeDasharray: "4 4" }} />
              <Area yAxisId="left" type="monotone" dataKey="revenue" stroke="var(--color-primary, #4b6cf6)" strokeWidth={2.5} fill="url(#gRevenue)" name={t("common.revenue")} dot={false} activeDot={{ r: 5, fill: "var(--color-primary, #4b6cf6)", stroke: "#fff", strokeWidth: 2 }} />
              <Area yAxisId="right" type="monotone" dataKey="orders" stroke="var(--color-success, #34c473)" strokeWidth={2.5} fill="url(#gOrders)" name={t("orders.title")} dot={false} activeDot={{ r: 5, fill: "var(--color-success, #34c473)", stroke: "#fff", strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Pie Chart — Status Breakdown */}
        <div className="neo-card" style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ marginBottom: "16px" }}>
            <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary, #2d3748)", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
              <PieChart size={16} color="var(--color-primary)" />
              {t("dashboard.orderStatuses")}
            </h2>
            <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #8b9bb4)", margin: "3px 0 0" }}>
              {statusTotal} {t("common.totalCount")}
            </p>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div className="neo-pie-chart" style={{ width: "160px", height: "160px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                    animationBegin={0}
                    animationDuration={800}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                </RePieChart>
              </ResponsiveContainer>
              <div className="neo-pie-chart-inner">
                <span style={{ fontSize: "20px", fontWeight: 700, color: "var(--color-text-primary)" }}>{statusTotal}</span>
                <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>{t("orders.genitive")}</span>
              </div>
            </div>
            {/* Legend */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "16px", width: "100%" }}>
              {pieData.map((entry, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }} onClick={() => navigate(`/orders?status=${entry.status}`)}>
                  <span style={{ width: "10px", height: "10px", borderRadius: "3px", background: entry.color, boxShadow: "var(--shadow-xs)", flexShrink: 0 }} />
                  <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>{entry.name}</span>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-primary)", marginLeft: "auto" }}>{entry.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Gamification */}
      {gamification && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" }}>
          <GamificationCard data={gamification} />
        </div>
      )}

      {/* Recent Orders */}
      <div className="neo-card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <div>
            <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary, #2d3748)", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
              <ClipboardList size={16} color="var(--color-primary)" />
              {t("dashboard.recentOrders")}
            </h2>
            <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #8b9bb4)", margin: "3px 0 0" }}>
              {activity?.length ?? 0} {t("orders.genitive")}
            </p>
          </div>
          <button onClick={() => navigate("/orders")} className="neo-btn-icon">
            <ArrowRight size={16} />
          </button>
        </div>
        <div style={{ maxHeight: "320px", overflowY: "auto" }} className="premium-scrollbar">
          {!activity?.length ? (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <div className="neo-btn-icon" style={{ width: "48px", height: "48px", margin: "0 auto 12px" }}>
                <ClipboardList size={20} style={{ color: "var(--color-text-tertiary, #8b9bb4)" }} />
              </div>
              <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-secondary, #5a6a7f)" }}>
                {t("orders.noOrders")}
              </p>
            </div>
          ) : (
            activity.slice(0, 8).map((e) => (
              <div key={e.id} onClick={() => navigate(`/orders/${e.id}`)} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 8px", cursor: "pointer", borderRadius: "12px", transition: "all 0.15s", marginBottom: "2px" }}
                onMouseEnter={ev => { ev.currentTarget.style.background = "rgba(75,108,246,.04)"; }}
                onMouseLeave={ev => { ev.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ width: "10px", height: "10px", borderRadius: "50%", flexShrink: 0, background: STATUS_COLOR[e.status ?? "new"] ?? "var(--color-border, #c8d0dc)", boxShadow: "var(--shadow-xs)" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary, #2d3748)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.agentName}</p>
                  <p style={{ fontSize: "11px", color: "var(--color-text-tertiary, #8b9bb4)", margin: "2px 0 0" }}>#{e.orderNumber} · {e.createdAt ? format(new Date(e.createdAt), "HH:mm") : ""}</p>
                </div>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary, #2d3748)", flexShrink: 0 }}>{fmt(e.total, true)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Usage Dashboard */}
      <UsageDashboard />
    </div>
  );
}
