import { memo, useCallback, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router";
import { getGreeting } from "@/lib/utils";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { ClipboardList, TrendingUp, TrendingDown, Sparkles, AlertCircle, ArrowRight } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { ProgressRing } from "@/components/ProgressRing";

type Range = "7d" | "30d" | "month";

const STATUS_COLOR: Record<string, string> = { new: "#4b6cf6", processing: "#e8a830", completed: "#34c473", cancelled: "#e85050" };
const STATUS_LABEL: Record<string, { ru: string; uz: string }> = {
  new: { ru: "Новые", uz: "Yangi" }, processing: { ru: "В обработке", uz: "Jarayonda" },
  completed: { ru: "Выполнены", uz: "Bajarildi" }, cancelled: { ru: "Отменены", uz: "Bekor qilindi" },
};

const CardDots = memo(function CardDots() {
  return (
    <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
      <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "var(--accent-pink, #f06895)" }} />
      <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "var(--accent-orange, #f5a825)" }} />
      <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "var(--accent-teal, #2ec4b0)" }} />
    </div>
  );
});

const ChartTooltip = memo(function ChartTooltip({ active, payload, label, fmt }: { active?: boolean; payload?: Array<{ dataKey: string; name: string; value: number; stroke: string }>; label?: string; fmt: (v: number, short?: boolean) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--color-surface, #ffffff)", borderRadius: "14px", padding: "14px 18px", boxShadow: "0 8px 24px rgba(43,52,80,.12), 0 0 0 1px rgba(43,52,80,.03)", minWidth: "160px" }}>
      <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary, #98a0b8)", marginBottom: "8px", fontFamily: "'DM Sans', sans-serif", letterSpacing: "0.05em", textTransform: "uppercase", margin: 0 }}>{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", marginTop: "6px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: p.stroke }} />
            <span style={{ fontSize: "12px", color: "var(--color-text-secondary, #6a7290)" }}>{p.name}</span>
          </div>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary, #2b3450)", fontFamily: "'DM Sans', sans-serif" }}>
            {p.dataKey === "revenue" ? fmt(p.value, true) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
});

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
  const statusTotal = useMemo(() => statusData?.reduce((s, d) => s + Number(d.count), 0) ?? 1, [statusData]);
  const greeting = getGreeting(t);

  if (isLoading || !kpis) return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ height: "28px", width: "240px", borderRadius: "10px", background: "var(--color-surface-light, #f0f3f8)" }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
        {[1, 2, 3, 4].map(i => <div key={i} style={{ height: "160px", borderRadius: "20px", background: "var(--color-surface, #ffffff)", boxShadow: "var(--shadow-sm)" }} />)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "16px" }}>
        <div style={{ height: "320px", borderRadius: "20px", background: "var(--color-surface, #ffffff)", boxShadow: "var(--shadow-sm)" }} />
        <div style={{ height: "320px", borderRadius: "20px", background: "var(--color-surface, #ffffff)", boxShadow: "var(--shadow-sm)" }} />
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <CardDots />
          <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "24px", fontWeight: 700, color: "var(--color-text-primary, #2b3450)", letterSpacing: "-0.025em", margin: 0 }}>
            {t("Главная", "Bosh sahifa")}
          </h1>
          <p style={{ fontSize: "13px", color: "var(--color-text-secondary, #6a7290)", margin: "4px 0 0" }}>
            {greeting}, {user?.name?.split(" ")[0] ?? ""} — {format(new Date(), "EEEE, d MMMM yyyy", { locale: ru })}
          </p>
        </div>
        <button onClick={() => navigate("/orders/new")} className="btn-primary">
          <Sparkles size={16} />
          <span>{t("Новый заказ", "Yangi buyurtma")}</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
        {/* Revenue */}
        <div className="kpi-hero" style={{ cursor: "pointer" }} onClick={() => navigate("/reports")}>
          <CardDots />
          <p className="kpi-hero-label">{t("ВЫРУЧКА", "TUSHUM")}</p>
          <p className="kpi-hero-value" style={{ fontSize: "28px", marginTop: "8px" }}>{fmt(kpis.todayRevenue, true)}</p>
          {revenueDelta !== 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "8px" }}>
              {revenueDelta > 0 ? <TrendingUp size={14} color="var(--color-success, #34c473)" /> : <TrendingDown size={14} color="var(--color-danger, #e85050)" />}
              <span style={{ fontSize: "12px", fontWeight: 600, color: revenueDelta > 0 ? "var(--color-success, #34c473)" : "var(--color-danger, #e85050)" }}>{Math.abs(revenueDelta).toFixed(1)}%</span>
            </div>
          )}
          {revenueTrend.length > 0 && (
            <div style={{ marginTop: "12px", height: "40px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueTrend.map((v, i) => ({ i, v }))}>
                  <defs>
                    <linearGradient id="gRevKpi" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-success, #34c473)" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="var(--color-success, #34c473)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="v" stroke="var(--color-success, #34c473)" strokeWidth={2} fill="url(#gRevKpi)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
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
              {ordersDelta > 0 ? <TrendingUp size={14} color="var(--color-success, #34c473)" /> : <TrendingDown size={14} color="var(--color-danger, #e85050)" />}
              <span style={{ fontSize: "12px", fontWeight: 600, color: ordersDelta > 0 ? "var(--color-success, #34c473)" : "var(--color-danger, #e85050)" }}>{Math.abs(ordersDelta).toFixed(1)}%</span>
            </div>
          )}
          {ordersTrend.length > 0 && (
            <div style={{ marginTop: "12px", height: "40px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={ordersTrend.map((v, i) => ({ i, v }))}>
                  <defs>
                    <linearGradient id="gOrdKpi" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--kpi-orange, #f09050)" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="var(--kpi-orange, #f09050)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="v" stroke="var(--kpi-orange, #f09050)" strokeWidth={2} fill="url(#gOrdKpi)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Debt */}
        <div className="kpi-hero" style={{ cursor: "pointer" }} onClick={() => navigate("/reports")}>
          <CardDots />
          <p className="kpi-hero-label">{t("ДОЛГ КЛИЕНТОВ", "MIJZOZLAR QARZI")}</p>
          <p className="kpi-hero-value" style={{ fontSize: "28px", marginTop: "8px" }}>{fmt(kpis.customerDebt ?? 0, true)}</p>
        </div>

        {/* Gross Margin */}
        <div className="kpi-hero" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "16px" }} onClick={() => navigate("/reports")}>
          <div style={{ flex: 1 }}>
            <CardDots />
            <p className="kpi-hero-label">{t("ВАЛОВАЯ ПРИБЫЛЬ", "SOF FOYDA")}</p>
            <p className="kpi-hero-value" style={{ fontSize: "28px", marginTop: "8px" }}>{(kpis.grossMargin ?? 0).toFixed(1)}%</p>
          </div>
          <ProgressRing value={Math.max(0, Math.min(100, kpis.grossMargin ?? 0))} color="var(--color-primary, #4b6cf6)" size={72} strokeWidth={6} label={`${(kpis.grossMargin ?? 0).toFixed(0)}%`} />
        </div>
      </div>

      {/* Smart Alerts */}
      {alerts && (alerts as any[]).length > 0 && (
        <div style={{ display: "flex", gap: "12px", overflowX: "auto", paddingBottom: "4px" }}>
          {(alerts as any[]).slice(0, 4).map((alert: any, i: any) => {
            const colors: Record<string, { bg: string; icon: string }> = {
              info: { bg: "var(--color-info-subtle, #e5f1fd)", icon: "var(--color-info, #4a9de8)" },
              warning: { bg: "var(--color-warning-subtle, #fdf1d5)", icon: "var(--color-warning, #e8a830)" },
              danger: { bg: "var(--color-danger-subtle, #fde8e8)", icon: "var(--color-danger, #e85050)" },
            };
            const c = colors[alert.severity] || colors.info;
            return (
              <div key={i} style={{ flex: "0 0 auto", minWidth: "240px", padding: "14px 16px", borderRadius: "16px", background: c.bg, display: "flex", alignItems: "center", gap: "12px", boxShadow: "var(--shadow-xs)" }}>
                <div style={{ width: "32px", height: "32px", borderRadius: "10px", background: `${c.icon}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {alert.severity === "danger" ? <AlertCircle size={16} style={{ color: c.icon }} /> : alert.severity === "warning" ? <TrendingDown size={16} style={{ color: c.icon }} /> : <TrendingUp size={16} style={{ color: c.icon }} />}
                </div>
                <div>
                  <p style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary, #2b3450)", margin: 0 }}>{alert.title}</p>
                  <p style={{ fontSize: "11px", color: "var(--color-text-secondary, #6a7290)", margin: "2px 0 0" }}>{alert.message}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Chart + Activity */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "16px" }}>
        {/* Sales Chart */}
        <div className="kpi-hero" style={{ padding: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
            <div>
              <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary, #2b3450)", margin: 0 }}>
                {t("Динамика продаж", "Sotuvlar dinamikasi")}
              </h2>
              <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #98a0b8)", margin: "3px 0 0" }}>
                {t("Выручка и количество заказов", "Tushum va buyurtmalar soni")}
              </p>
            </div>
            <div className="range-pills">
              {([{ key: "7d" as const, label: "7д" }, { key: "30d" as const, label: "30д" }, { key: "month" as const, label: t("Месяц", "Oy") }]).map(r => (
                <button key={r.key} onClick={() => setRange(r.key)} className={`range-pill ${range === r.key ? "active" : ""}`}>{r.label}</button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary, #4b6cf6)" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="var(--color-primary, #4b6cf6)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gOrders" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-success, #34c473)" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="var(--color-success, #34c473)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fill: "var(--color-text-tertiary, #98a0b8)", fontSize: 11, fontFamily: "'DM Sans', sans-serif" }} axisLine={false} tickLine={false} dy={8} />
              <YAxis yAxisId="left" tick={{ fill: "var(--color-text-tertiary, #98a0b8)", fontSize: 11, fontFamily: "'DM Sans', sans-serif" }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v, true)} dx={-4} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: "var(--color-text-tertiary, #98a0b8)", fontSize: 11, fontFamily: "'DM Sans', sans-serif" }} axisLine={false} tickLine={false} dx={4} />
              <Tooltip content={<ChartTooltip fmt={fmt} />} cursor={{ stroke: "var(--color-border, #dde2ec)", strokeWidth: 1, strokeDasharray: "4 4" }} />
              <Area yAxisId="left" type="monotone" dataKey="revenue" stroke="var(--color-primary, #4b6cf6)" strokeWidth={2.5} fill="url(#gRevenue)" name={t("Выручка", "Tushum")} dot={false} activeDot={{ r: 5, fill: "var(--color-primary, #4b6cf6)", stroke: "#fff", strokeWidth: 2 }} />
              <Area yAxisId="right" type="monotone" dataKey="orders" stroke="var(--color-success, #34c473)" strokeWidth={2.5} fill="url(#gOrders)" name={t("Заказы", "Buyurtmalar")} dot={false} activeDot={{ r: 5, fill: "var(--color-success, #34c473)", stroke: "#fff", strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Recent Orders */}
        <div className="kpi-hero" style={{ padding: "24px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <div>
              <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary, #2b3450)", margin: 0 }}>
                {t("Последние заказы", "So'nggi buyurtmalar")}
              </h2>
              <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #98a0b8)", margin: "3px 0 0" }}>
                {activity?.length ?? 0} {t("заказов", "buyurtmalar")}
              </p>
            </div>
            <button onClick={() => navigate("/orders")} className="btn-ghost" style={{ padding: "6px" }}>
              <ArrowRight size={16} />
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {!activity?.length ? (
              <div style={{ textAlign: "center", padding: "32px 0" }}>
                <div style={{ width: "48px", height: "48px", margin: "0 auto 12px", borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-surface-light, #f0f3f8)" }}>
                  <ClipboardList size={20} style={{ color: "var(--color-text-tertiary, #98a0b8)" }} />
                </div>
                <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-secondary, #6a7290)" }}>
                  {t("Заказов пока нет", "Hali buyurtma yo'q")}
                </p>
              </div>
            ) : (
              activity.slice(0, 8).map((e) => (
                <div key={e.id} onClick={() => navigate(`/orders/${e.id}`)} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 4px", cursor: "pointer", borderBottom: "1px solid var(--color-border, #dde2ec)", borderRadius: "8px", transition: "background 0.15s" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0, background: STATUS_COLOR[e.status ?? "new"] ?? "var(--color-border-strong, #c8ceda)" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary, #2b3450)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.agentName}</p>
                    <p style={{ fontSize: "11px", color: "var(--color-text-tertiary, #98a0b8)", margin: "2px 0 0" }}>#{e.orderNumber} · {e.createdAt ? format(new Date(e.createdAt), "HH:mm") : ""}</p>
                  </div>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary, #2b3450)", flexShrink: 0 }}>{fmt(e.total, true)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Status Breakdown */}
      <div className="kpi-hero" style={{ padding: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <div>
            <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary, #2b3450)", margin: 0 }}>
              {t("Статусы заказов", "Buyurtmalar holati")}
            </h2>
            <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #98a0b8)", margin: "3px 0 0" }}>
              {statusTotal} {t("всего", "jami")}
            </p>
          </div>
          <button onClick={() => navigate("/orders")} className="btn-primary" style={{ padding: "8px 14px", fontSize: "12px" }}>
            {t("Все заказы", "Barcha buyurtmalar")}
            <ArrowRight size={12} />
          </button>
        </div>

        {/* Status Bar */}
        <div style={{ display: "flex", height: "8px", borderRadius: "4px", overflow: "hidden", gap: "2px", background: "var(--color-surface-light, #f0f3f8)", marginBottom: "16px" }}>
          {statusData?.map(s => (
            <div key={s.status} style={{ height: "100%", borderRadius: "4px", background: STATUS_COLOR[s.status ?? ""] ?? "var(--color-border-strong, #c8ceda)", width: `${(Number(s.count) / statusTotal) * 100}%`, transition: "width 0.5s ease" }} />
          ))}
        </div>

        {/* Status Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
          {statusData?.map(s => (
            <div key={s.status} onClick={() => navigate(`/orders?status=${s.status}`)} style={{ padding: "16px", borderRadius: "14px", cursor: "pointer", background: "var(--color-surface-light, #f0f3f8)", transition: "all 0.2s ease" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: STATUS_COLOR[s.status ?? ""] ?? "var(--color-border-strong, #c8ceda)" }} />
                <span style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-tertiary, #98a0b8)" }}>{STATUS_LABEL[s.status ?? ""]?.[lang] ?? s.status}</span>
              </div>
              <p style={{ fontSize: "22px", fontWeight: 700, color: "var(--color-text-primary, #2b3450)", fontFamily: "'DM Sans', sans-serif", letterSpacing: "-0.02em", margin: 0 }}>{s.count}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
