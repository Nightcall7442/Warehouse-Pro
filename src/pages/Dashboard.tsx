import { memo, useCallback, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router";
import { getGreeting } from "@/lib/utils";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { ClipboardList, TrendingUp, TrendingDown, Sparkles, AlertCircle, ArrowRight, BarChart3, PieChart, Activity } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart as RePieChart, Pie, Cell, BarChart, Bar } from "recharts";
import { ProgressRing } from "@/components/ProgressRing";

type Range = "7d" | "30d" | "month";

const STATUS_COLOR: Record<string, string> = { new: "#5b6d8a", processing: "#d4973a", completed: "#34c473", cancelled: "#d45050" };
const STATUS_LABEL: Record<string, { ru: string; uz: string }> = {
  new: { ru: "Новые", uz: "Yangi" }, processing: { ru: "В обработке", uz: "Jarayonda" },
  completed: { ru: "Выполнены", uz: "Bajarildi" }, cancelled: { ru: "Отменены", uz: "Bekor qilindi" },
};

const CHART_COLORS = ["#5b6d8a", "#34c473", "#d4973a", "#d45050", "#7a6db5", "#3a9a8a", "#c06080", "#c49530"];

/* ── Decorative dots ─────────────────────────────────────────────────────── */
const CardDots = memo(function CardDots() {
  return (
    <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-pink, #c06080)", boxShadow: "var(--shadow-xs)" }} />
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-orange, #c49530)", boxShadow: "var(--shadow-xs)" }} />
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-teal, #3a9a8a)", boxShadow: "var(--shadow-xs)" }} />
    </div>
  );
});

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
  const max = Math.max(...data, 1);
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
  const { lang } = useLang();
  const { user } = useAuth();
  const navigate = useNavigate();
  const t = useCallback((ru: string, uz: string) => lang === "uz" ? uz : ru, [lang]);

  const { data: kpis, isLoading } = trpc.dashboard.kpis.useQuery() as { data: any; isLoading: boolean };
  const { data: trends } = trpc.dashboard.trends.useQuery({ range });
  const { data: statusData } = trpc.dashboard.statusBreakdown.useQuery();
  const { data: activity } = trpc.dashboard.activity.useQuery();
  const { data: alerts } = trpc.notification.smartAlerts.useQuery();

  const chartData = useMemo(() => trends?.map(tr => ({ date: format(new Date(tr.date), "dd/MM"), orders: tr.orderCount, revenue: Number(tr.revenue) })) ?? [], [trends]);
  const revenueTrend = useMemo(() => (trends ?? []).slice(-7).map(tr => Number(tr.revenue)), [trends]);
  const ordersTrend = useMemo(() => (trends ?? []).slice(-7).map(tr => tr.orderCount), [trends]);
  const prev7 = useMemo(() => (trends ?? []).slice(-14, -7), [trends]);
  const calcDelta = useCallback((curr: number[], prev: number[]): number => { const sumPrev = prev.reduce((a, b) => a + b, 0); const sumCurr = curr.reduce((a, b) => a + b, 0); if (sumPrev === 0) return sumCurr > 0 ? 100 : 0; return Math.round(((sumCurr - sumPrev) / sumPrev) * 1000) / 10; }, []);
  const revenueDelta = useMemo(() => calcDelta(revenueTrend, prev7.map(tr => Number(tr.revenue))), [calcDelta, revenueTrend, prev7]);
  const ordersDelta = useMemo(() => calcDelta(ordersTrend, prev7.map(tr => tr.orderCount)), [calcDelta, ordersTrend, prev7]);
  const statusTotal = useMemo(() => statusData?.reduce((s: number, d: any) => s + Number(d.count), 0) ?? 1, [statusData]);
  const greeting = getGreeting(t);

  // Pie chart data
  const pieData = useMemo(() =>
    statusData?.map((s: any, i: number) => ({
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
      <div className="dashboard-kpi-grid">
        {[1, 2, 3, 4].map(i => <div key={i} className="neo-card" style={{ height: "160px" }} />)}
      </div>
      <div className="dashboard-charts-grid">
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
            {t("Главная", "Bosh sahifa")}
          </h1>
          <p style={{ fontSize: "13px", color: "var(--color-text-secondary, #5a6a7f)", margin: "4px 0 0" }}>
            {greeting}, {user?.name?.split(" ")[0] ?? ""} — {format(new Date(), "EEEE, d MMMM yyyy", { locale: ru })}
          </p>
        </div>
        <button onClick={() => navigate("/orders/new")} className="neo-btn-primary">
          <Sparkles size={16} />
          <span>{t("Новый заказ", "Yangi buyurtma")}</span>
        </button>
      </div>

      {/* KPI Cards Row */}
      <div className="stagger-children dashboard-kpi-grid">
        {/* Revenue */}
        <div className="kpi-hero" style={{ cursor: "pointer" }} onClick={() => navigate("/reports")}>
          <CardDots />
          <p className="kpi-hero-label">{t("ВЫРУЧКА", "TUSHUM")}</p>
          <p className="kpi-hero-value" style={{ fontSize: "28px", marginTop: "8px" }}>{fmt(kpis.todayRevenue, true)}</p>
          {revenueDelta !== 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "8px" }}>
              {revenueDelta > 0 ? <TrendingUp size={14} color="var(--color-success, #34c473)" /> : <TrendingDown size="14" color="var(--color-danger, #d45050)" />}
              <span style={{ fontSize: "12px", fontWeight: 600, color: revenueDelta > 0 ? "var(--color-success, #34c473)" : "var(--color-danger, #d45050)" }}>{Math.abs(revenueDelta).toFixed(1)}%</span>
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
          <p className="kpi-hero-label">{t("ЗАКАЗЫ", "BUYURTMALAR")}</p>
          <p className="kpi-hero-value" style={{ fontSize: "28px", marginTop: "8px" }}>{kpis.todayOrders}</p>
          {ordersDelta !== 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "8px" }}>
              {ordersDelta > 0 ? <TrendingUp size={14} color="var(--color-success, #34c473)" /> : <TrendingDown size={14} color="var(--color-danger, #d45050)" />}
              <span style={{ fontSize: "12px", fontWeight: 600, color: ordersDelta > 0 ? "var(--color-success, #34c473)" : "var(--color-danger, #d45050)" }}>{Math.abs(ordersDelta).toFixed(1)}%</span>
            </div>
          )}
          {miniBarOrders.length > 0 && (
            <div style={{ marginTop: "12px" }}>
              <MiniBarChart data={miniBarOrders} color="var(--color-primary, #5b6d8a)" />
            </div>
          )}
        </div>

        {/* Debt */}
        <CircularKpiCard
          label={t("ДОЛГ КЛИЕНТОВ", "MIJZOZLAR QARZI")}
          value={fmt(kpis.customerDebt ?? 0, true)}
          color="var(--color-warning, #d4973a)"
          icon={<Activity size={18} color="var(--color-warning)" />}
          delay={0.1}
          onClick={() => navigate("/reports")}
        />

        {/* Gross Margin */}
        <div className="kpi-hero" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "16px" }} onClick={() => navigate("/reports")}>
          <div style={{ flex: 1 }}>
            <CardDots />
            <p className="kpi-hero-label">{t("ВАЛОВАЯ ПРИБЫЛЬ", "SOF FOYDA")}</p>
            <p className="kpi-hero-value" style={{ fontSize: "28px", marginTop: "8px" }}>{(kpis.grossMargin ?? 0).toFixed(1)}%</p>
          </div>
          <div className="neo-progress-ring" style={{ width: "80px", height: "80px" }}>
            <ProgressRing value={Math.max(0, Math.min(100, kpis.grossMargin ?? 0))} color="var(--color-primary, #5b6d8a)" size={72} strokeWidth={6} label={`${(kpis.grossMargin ?? 0).toFixed(0)}%`} />
          </div>
        </div>
      </div>

      {/* Smart Alerts */}
      {alerts && (alerts as any[]).length > 0 && (
        <div style={{ display: "flex", gap: "12px", overflowX: "auto", paddingBottom: "4px" }}>
          {(alerts as any[]).slice(0, 4).map((alert: any, i: any) => {
            const colors: Record<string, { bg: string; icon: string }> = {
              info: { bg: "var(--color-info-subtle)", icon: "var(--color-info, #4a9de8)" },
              warning: { bg: "var(--color-warning-subtle)", icon: "var(--color-warning, #d4973a)" },
              danger: { bg: "var(--color-danger-subtle)", icon: "var(--color-danger, #d45050)" },
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

      {/* Charts Row */}
      <div className="dashboard-charts-grid">
        {/* Sales Chart */}
        <div className="neo-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
            <div>
              <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary, #2d3748)", margin: 0 }}>
                {t("Динамика продаж", "Sotuvlar dinamikasi")}
              </h2>
              <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #8b9bb4)", margin: "3px 0 0" }}>
                {t("Выручка и количество заказов", "Tushum va buyurtmalar soni")}
              </p>
            </div>
            <div className="range-pills">
              {([{ key: "7d" as const, label: "7д" }, { key: "30d" as const, label: "30д" }, { key: "month" as const, label: t("Месяц", "Oy") }]).map(r => (
                <button key={r.key} onClick={() => setRange(r.key)} className={`range-pill ${range === r.key ? "active" : ""}`}>{r.label}</button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary, #5b6d8a)" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="var(--color-primary, #5b6d8a)" stopOpacity={0} />
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
              <Area yAxisId="left" type="monotone" dataKey="revenue" stroke="var(--color-primary, #5b6d8a)" strokeWidth={2.5} fill="url(#gRevenue)" name={t("Выручка", "Tushum")} dot={false} activeDot={{ r: 5, fill: "var(--color-primary, #5b6d8a)", stroke: "#fff", strokeWidth: 2 }} />
              <Area yAxisId="right" type="monotone" dataKey="orders" stroke="var(--color-success, #34c473)" strokeWidth={2.5} fill="url(#gOrders)" name={t("Заказы", "Buyurtmalar")} dot={false} activeDot={{ r: 5, fill: "var(--color-success, #34c473)", stroke: "#fff", strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Pie Chart — Status Breakdown */}
        <div className="neo-card" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ marginBottom: "16px" }}>
            <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary, #2d3748)", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
              <PieChart size={16} color="var(--color-primary)" />
              {t("Статусы заказов", "Buyurtmalar holati")}
            </h2>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            {/* Donut chart */}
            <div style={{ width: "180px", height: "180px", position: "relative" }}>
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                    animationBegin={0}
                    animationDuration={800}
                    strokeWidth={0}
                  >
                    {pieData.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                </RePieChart>
              </ResponsiveContainer>
              {/* Center label */}
              <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center", pointerEvents: "none" }}>
                <span style={{ fontSize: "28px", fontWeight: 700, color: "var(--color-text-primary, #2d3748)", lineHeight: 1 }}>{statusTotal}</span>
                <span style={{ fontSize: "11px", color: "var(--color-text-tertiary, #8b9bb4)", display: "block", marginTop: "2px" }}>{t("заказов", "buyurtma")}</span>
              </div>
            </div>
            {/* Legend */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px", marginTop: "20px", width: "100%" }}>
              {pieData.map((entry: any, i: number) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", minWidth: 0 }} onClick={() => navigate(`/orders?status=${entry.status}`)}>
                  <span style={{ width: "10px", height: "10px", borderRadius: "3px", background: entry.color, boxShadow: "var(--shadow-xs)", flexShrink: 0 }} />
                  <span style={{ fontSize: "12px", color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-primary)", marginLeft: "auto", flexShrink: 0 }}>{entry.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Orders */}
      <div className="neo-card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <div>
            <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary, #2d3748)", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
              <ClipboardList size={16} color="var(--color-primary)" />
              {t("Последние заказы", "So'nggi buyurtmalar")}
            </h2>
            <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #8b9bb4)", margin: "3px 0 0" }}>
              {activity?.length ?? 0} {t("заказов", "buyurtmalar")}
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
                {t("Заказов пока нет", "Hali buyurtma yo'q")}
              </p>
            </div>
          ) : (
            activity.slice(0, 8).map((e: any) => (
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
    </div>
  );
}
