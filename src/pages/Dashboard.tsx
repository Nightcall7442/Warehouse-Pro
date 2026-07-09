import { memo, useCallback, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router";
import { getGreeting } from "@/lib/utils";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  ClipboardList, TrendingUp, TrendingDown, Sparkles, AlertCircle,
  ArrowRight,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { SparklineCard } from "@/components/SparklineCard";

type Range = "7d" | "30d" | "month";

const STATUS_COLOR: Record<string, string> = {
  new:        "var(--color-primary)",
  processing: "var(--color-warning)",
  completed:  "var(--color-success)",
  cancelled:  "#EF4444",
};
const STATUS_LABEL: Record<string, { ru: string; uz: string }> = {
  new:        { ru: "Новые",       uz: "Yangi"         },
  processing: { ru: "В обработке", uz: "Jarayonda"     },
  completed:  { ru: "Выполнены",   uz: "Bajarildi"     },
  cancelled:  { ru: "Отменены",    uz: "Bekor qilindi" },
};

const AppleTooltip = memo(function AppleTooltip({ active, payload, label, fmt }: { active?: boolean; payload?: Array<{ dataKey: string; name: string; value: number; stroke: string }>; label?: string; fmt: (v: number, short?: boolean) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-panel p-4 min-w-[160px]" style={{ backdropFilter: "blur(20px)" }}>
      <p className="text-[11px] font-medium mb-2" style={{ color: "var(--color-text-tertiary)", fontFamily: "'DM Sans', sans-serif" }}>
        {label}
      </p>
      {payload.map((p: { dataKey: string; name: string; value: number; stroke: string }) => (
        <div key={p.dataKey} className="flex justify-between items-center gap-6 mt-1.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ background: p.stroke }} />
            <span className="text-[12px]" style={{ color: "var(--color-text-secondary)" }}>{p.name}</span>
          </div>
          <span className="text-[13px] font-semibold" style={{ color: "var(--color-text-primary)", fontFamily: "'DM Sans', sans-serif" }}>
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

  const chartData = useMemo(() => trends?.map(tr => ({
    date: format(new Date(tr.date), "dd/MM"),
    orders: tr.orderCount,
    revenue: Number(tr.revenue),
  })) ?? [], [trends]);

  const revenueTrend = useMemo(() => (trends ?? []).slice(-7).map(tr => Number(tr.revenue)), [trends]);
  const ordersTrend = useMemo(() => (trends ?? []).slice(-7).map(tr => tr.orderCount), [trends]);
  const prev7 = useMemo(() => (trends ?? []).slice(-14, -7), [trends]);

  const calcDelta = useCallback((curr: number[], prev: number[]): number => {
    const sumPrev = prev.reduce((a, b) => a + b, 0);
    const sumCurr = curr.reduce((a, b) => a + b, 0);
    if (sumPrev === 0) return sumCurr > 0 ? 100 : 0;
    return Math.round(((sumCurr - sumPrev) / sumPrev) * 1000) / 10;
  }, []);

  const revenueDelta = useMemo(() => calcDelta(revenueTrend, prev7.map(tr => Number(tr.revenue))), [calcDelta, revenueTrend, prev7]);
  const ordersDelta = useMemo(() => calcDelta(ordersTrend, prev7.map(tr => tr.orderCount)), [calcDelta, ordersTrend, prev7]);

  const statusTotal = useMemo(() => statusData?.reduce((s, d) => s + Number(d.count), 0) ?? 1, [statusData]);

  const greeting = getGreeting(t);

  const navigateNewOrder = useCallback(() => navigate("/orders/new"), [navigate]);
  const navigateReports = useCallback(() => navigate("/reports"), [navigate]);
  const navigateOrders = useCallback(() => navigate("/orders"), [navigate]);
  const setRange7d = useCallback(() => setRange("7d"), []);
  const setRange30d = useCallback(() => setRange("30d"), []);
  const setRangeMonth = useCallback(() => setRange("month"), []);

  if (isLoading || !kpis) return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-64 rounded-xl" style={{ background: "var(--color-surface-light)" }} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-[180px] rounded-[20px]" style={{ background: "var(--color-surface-light)" }} />
        ))}
      </div>
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="h-[360px] rounded-[20px] lg:col-span-2" style={{ background: "var(--color-surface-light)" }} />
        <div className="h-[360px] rounded-[20px]" style={{ background: "var(--color-surface-light)" }} />
      </div>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-up">

      <div className="greeting-hero">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[13px] font-semibold mb-1" style={{ color: "var(--color-primary)" }}>
              {greeting}, {user?.name?.split(" ")[0] ?? ""}
            </p>
            <h1 className="text-[28px] font-bold tracking-tight" style={{ color: "var(--color-text-primary)", fontFamily: "'DM Sans', sans-serif", letterSpacing: "-0.03em" }}>
              {t("Главная", "Bosh sahifa")}
            </h1>
            <p className="text-[13px] mt-1" style={{ color: "var(--color-text-tertiary)" }}>
              {format(new Date(), "EEEE, d MMMM yyyy", { locale: ru })}
            </p>
          </div>
          <button
            onClick={navigateNewOrder}
            className="btn-primary flex items-center gap-2 text-[13px] px-5 py-2.5"
            style={{ borderRadius: "12px" }}
          >
            <Sparkles size={16} />
            <span>{t("Новый заказ", "Yangi buyurtma")}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SparklineCard
          label={t("ВЫРУЧКА", "TUSHUM")}
          value={fmt(kpis.todayRevenue, true)}
          delta={revenueDelta}
          trend={revenueTrend}
          color="var(--kpi-green)"
          onClick={navigateReports}
        />
        <SparklineCard
          label={t("ЗАКАЗЫ", "BUYURTMALAR")}
          value={String(kpis.todayOrders)}
          delta={ordersDelta}
          trend={ordersTrend}
          color="var(--kpi-orange)"
          onClick={navigateOrders}
        />
        <SparklineCard
          label={t("ДОЛГ КЛИЕНТОВ", "MIJZOZLAR QARZI")}
          value={fmt(kpis.customerDebt ?? 0, true)}
          delta={0}
          trend={[]}
          color="var(--kpi-red)"
          invertDelta={true}
          onClick={navigateReports}
        />
        <SparklineCard
          label={t("ВАЛОВАЯ ПРИБЫЛЬ", "SOF FOYDA")}
          value={`${(kpis.grossMargin ?? 0).toFixed(1)}%`}
          delta={0}
          trend={[]}
          color="var(--kpi-indigo)"
          onClick={navigateReports}
        />
      </div>

      {/* Smart Alerts */}
      {alerts && (alerts as any[]).length > 0 && (
        <div style={{
          display: "flex", gap: "12px", overflowX: "auto", paddingBottom: "4px",
        }}>
          {(alerts as any[]).slice(0, 4).map((alert: any, i: any) => {
            const colors: Record<string, { bg: string; border: string; icon: string }> = {
              info:    { bg: "rgba(59,130,246,0.08)", border: "rgba(59,130,246,0.2)", icon: "#3B82F6" },
              warning: { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.2)", icon: "var(--color-warning)" },
              danger:  { bg: "rgba(220,38,38,0.08)", border: "rgba(220,38,38,0.2)", icon: "#DC2626" },
            };
            const c = colors[alert.severity] || colors.info;
            return (
              <div key={i} style={{
                flex: "0 0 auto", minWidth: "240px", padding: "14px 16px",
                borderRadius: "14px", background: c.bg, border: `1px solid ${c.border}`,
                display: "flex", alignItems: "center", gap: "12px",
              }}>
                <div style={{
                  width: "32px", height: "32px", borderRadius: "10px",
                  background: `${c.icon}15`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  {alert.severity === "danger" ? <AlertCircle size={16} style={{ color: c.icon }} /> :
                   alert.severity === "warning" ? <TrendingDown size={16} style={{ color: c.icon }} /> :
                   <TrendingUp size={16} style={{ color: c.icon }} />}
                </div>
                <div>
                  <p style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>{alert.title}</p>
                  <p style={{ fontSize: "11px", color: "var(--color-text-secondary)", margin: "2px 0 0" }}>{alert.message}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        <div className="chart-apple lg:col-span-2">
          <div className="flex items-center justify-between mb-6 relative z-10">
            <div>
              <h2 className="text-[16px] font-semibold" style={{ color: "var(--color-text-primary)", fontFamily: "'DM Sans', sans-serif" }}>
                {t("Динамика продаж", "Sotuvlar dinamikasi")}
              </h2>
              <p className="text-[12px] mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
                {t("Выручка и количество заказов", "Tushum va buyurtmalar soni")}
              </p>
            </div>
            <div className="range-pills">
              {([
                { key: "7d" as const, label: "7д", onClick: setRange7d },
                { key: "30d" as const, label: "30д", onClick: setRange30d },
                { key: "month" as const, label: t("Месяц", "Oy"), onClick: setRangeMonth },
              ]).map(r => (
                <button
                  key={r.key}
                  onClick={r.onClick}
                  className={`range-pill ${r.key === range ? "active" : ""}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="relative z-10">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gRevenueApple" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gOrdersApple" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tick={{ fill: "var(--color-text-tertiary)", fontSize: 11, fontFamily: "'DM Sans', sans-serif" }}
                  axisLine={false}
                  tickLine={false}
                  dy={8}
                />
                <YAxis
                  tick={{ fill: "var(--color-text-tertiary)", fontSize: 11, fontFamily: "'DM Sans', sans-serif" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => fmt(v, true)}
                  yAxisId="left"
                  dx={-4}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: "var(--color-text-tertiary)", fontSize: 11, fontFamily: "'DM Sans', sans-serif" }}
                  axisLine={false}
                  tickLine={false}
                  dx={4}
                />
                <Tooltip content={<AppleTooltip fmt={fmt} />} cursor={{ stroke: "var(--color-border)", strokeWidth: 1, strokeDasharray: "4 4" }} />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="revenue"
                  stroke="var(--color-primary)"
                  strokeWidth={2.5}
                  fill="url(#gRevenueApple)"
                  name={t("Выручка", "Tushum")}
                  dot={false}
                  activeDot={{ r: 5, fill: "var(--color-primary)", stroke: "#fff", strokeWidth: 2 }}
                />
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="orders"
                  stroke="var(--color-success)"
                  strokeWidth={2.5}
                  fill="url(#gOrdersApple)"
                  name={t("Заказы", "Buyurtmalar")}
                  dot={false}
                  activeDot={{ r: 5, fill: "var(--color-success)", stroke: "#fff", strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-panel p-6 flex flex-col">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-[16px] font-semibold" style={{ color: "var(--color-text-primary)", fontFamily: "'DM Sans', sans-serif" }}>
                {t("Последние заказы", "So'nggi buyurtmalar")}
              </h2>
              <p className="text-[12px] mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
                {activity?.length ?? 0} {t("заказов", "buyurtmalar")}
              </p>
            </div>
            <button
              onClick={navigateOrders}
              className="p-2 rounded-lg transition-colors"
              style={{ color: "var(--color-text-tertiary)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-light)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <ArrowRight size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {!activity?.length ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ background: "var(--color-surface-light)" }}>
                  <ClipboardList size={24} style={{ color: "var(--color-text-tertiary)" }} />
                </div>
                <p className="text-[13px] font-medium" style={{ color: "var(--color-text-secondary)" }}>
                  {t("Заказов пока нет", "Hali buyurtma yo'q")}
                </p>
              </div>
            ) : (
              activity.slice(0, 8).map((e, i) => (
                <div
                  key={e.id}
                  className="activity-item"
                  onClick={() => navigate(`/orders/${e.id}`)}
                  style={{ animationDelay: `${i * 0.05}s` }}
                >
                  <div
                    className="activity-dot"
                    style={{ background: STATUS_COLOR[e.status ?? "new"] ?? "var(--color-border)" }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium truncate" style={{ color: "var(--color-text-primary)" }}>
                      {e.agentName}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--color-text-tertiary)", fontFamily: "'DM Sans', sans-serif" }}>
                      #{e.orderNumber} · {e.createdAt ? format(new Date(e.createdAt), "HH:mm") : ""}
                    </p>
                  </div>
                  <span className="text-[13px] font-semibold flex-shrink-0" style={{ color: "var(--color-text-primary)", fontFamily: "'DM Sans', sans-serif" }}>
                    {fmt(e.total, true)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="glass-panel p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-[16px] font-semibold" style={{ color: "var(--color-text-primary)", fontFamily: "'DM Sans', sans-serif" }}>
              {t("Статусы заказов", "Buyurtmalar holati")}
            </h2>
            <p className="text-[12px] mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
              {statusTotal} {t("всего", "jami")}
            </p>
          </div>
          <button
            onClick={navigateOrders}
            className="text-[12px] font-semibold flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors"
            style={{ color: "var(--color-primary)", background: "var(--color-primary-subtle)" }}
          >
            {t("Все заказы", "Barcha buyurtmalar")}
            <ArrowRight size={12} />
          </button>
        </div>

        <div className="status-bar mb-6">
          {statusData?.map(s => (
            <div
              key={s.status}
              className="status-bar-segment"
              style={{
                background: STATUS_COLOR[s.status ?? ""] ?? "var(--color-border)",
                width: `${(Number(s.count) / statusTotal) * 100}%`,
              }}
            />
          ))}
        </div>

        <div className="premium-table grid grid-cols-2 sm:grid-cols-4 gap-3">
          {statusData?.map(s => (
            <div
              key={s.status}
              className="p-4 rounded-2xl cursor-pointer transition-all hover:scale-[1.02]"
              style={{
                background: "var(--color-surface-light)",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
              }}
              onClick={() => navigate(`/orders?status=${s.status}`)}
              onMouseEnter={e => {
                e.currentTarget.style.boxShadow = `0 4px 16px rgba(0, 0, 0, 0.08), 0 0 0 1px ${STATUS_COLOR[s.status ?? ""] ?? "var(--color-border)"}40`;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.04)";
              }}
            >
              <div className="flex items-center gap-2.5 mb-2">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: STATUS_COLOR[s.status ?? ""] ?? "var(--color-border)" }}
                />
                <span className="text-[11px] font-medium" style={{ color: "var(--color-text-tertiary)" }}>
                  {STATUS_LABEL[s.status ?? ""]?.[lang] ?? s.status}
                </span>
              </div>
              <p className="text-[24px] font-bold" style={{ color: "var(--color-text-primary)", fontFamily: "'DM Sans', sans-serif", letterSpacing: "-0.02em" }}>
                {s.count}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
