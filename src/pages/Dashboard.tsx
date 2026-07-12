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
import { ProgressRing } from "@/components/ProgressRing";

type Range = "7d" | "30d" | "month";

const STATUS_COLOR: Record<string, string> = {
  new:        "var(--color-primary, #818cf8)",
  processing: "var(--color-warning, #fbbf24)",
  completed:  "var(--color-success, #4ade80)",
  cancelled:  "var(--color-danger, #f87171)",
};
const STATUS_LABEL: Record<string, { ru: string; uz: string }> = {
  new:        { ru: "Новые",       uz: "Yangi"         },
  processing: { ru: "В обработке", uz: "Jarayonda"     },
  completed:  { ru: "Выполнены",   uz: "Bajarildi"     },
  cancelled:  { ru: "Отменены",    uz: "Bekor qilindi" },
};

/* Three colored dots — signature decorative element from the reference image */
const CardDots = memo(function CardDots() {
  return (
    <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#fb7185" }} />
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#fbbf24" }} />
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#2dd4bf" }} />
    </div>
  );
});

/* Card wrapper — matches reference: white, soft shadow, 20px radius */
const Card = memo(function Card({ children, onClick, className }: { children: React.ReactNode; onClick?: () => void; className?: string }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: "var(--color-surface, #ffffff)",
        borderRadius: "20px",
        padding: "22px",
        boxShadow: "0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.03)",
        cursor: onClick ? "pointer" : "default",
        transition: "all 0.2s ease",
      }}
      className={className}
    >
      {children}
    </div>
  );
});

/* Section title */
const SectionTitle = memo(function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 600, color: "var(--color-text-primary, #111827)", margin: 0 }}>
        {title}
      </h2>
      {subtitle && (
        <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #9ca3af)", margin: "4px 0 0" }}>
          {subtitle}
        </p>
      )}
    </div>
  );
});

/* Range pills — matches reference */
const RangePills = memo(function RangePills({ range, on7d, on30d, onMonth, t }: { range: Range; on7d: () => void; on30d: () => void; onMonth: () => void; t: (ru: string, uz: string) => string }) {
  return (
    <div style={{ display: "inline-flex", background: "var(--color-surface-light, #f3f4f6)", borderRadius: "10px", padding: "3px", gap: "2px" }}>
      {([
        { key: "7d" as const, label: "7д", onClick: on7d },
        { key: "30d" as const, label: "30д", onClick: on30d },
        { key: "month" as const, label: t("Месяц", "Oy"), onClick: onMonth },
      ]).map(r => (
        <button
          key={r.key}
          onClick={r.onClick}
          style={{
            padding: "6px 14px", fontSize: "12px", fontWeight: 600,
            borderRadius: "8px", border: "none", cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif",
            background: r.key === range ? "var(--color-surface, #ffffff)" : "transparent",
            color: r.key === range ? "var(--color-text-primary, #111827)" : "var(--color-text-secondary, #6b7280)",
            boxShadow: r.key === range ? "0 1px 3px rgba(0,0,0,.08)" : "none",
            transition: "all 0.15s",
          }}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
});

const ChartTooltip = memo(function ChartTooltip({ active, payload, label, fmt }: { active?: boolean; payload?: Array<{ dataKey: string; name: string; value: number; stroke: string }>; label?: string; fmt: (v: number, short?: boolean) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "var(--color-surface, #ffffff)", borderRadius: "12px", padding: "14px 16px",
      boxShadow: "0 4px 12px rgba(0,0,0,.08)", minWidth: "160px",
    }}>
      <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary, #9ca3af)", marginBottom: "8px", fontFamily: "'DM Sans', sans-serif", letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {label}
      </p>
      {payload.map((p: { dataKey: string; name: string; value: number; stroke: string }) => (
        <div key={p.dataKey} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", marginTop: "4px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: p.stroke }} />
            <span style={{ fontSize: "12px", color: "var(--color-text-secondary, #6b7280)" }}>{p.name}</span>
          </div>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary, #111827)", fontFamily: "'DM Sans', sans-serif" }}>
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

  if (isLoading || !kpis) return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ height: "28px", width: "240px", borderRadius: "8px", background: "var(--color-surface-light, #f3f4f6)" }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
        {[1, 2, 3, 4].map(i => <div key={i} style={{ height: "160px", borderRadius: "20px", background: "var(--color-surface-light, #f3f4f6)" }} />)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "16px" }}>
        <div style={{ height: "320px", borderRadius: "20px", background: "var(--color-surface-light, #f3f4f6)" }} />
        <div style={{ height: "320px", borderRadius: "20px", background: "var(--color-surface-light, #f3f4f6)" }} />
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <CardDots />
          <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "24px", fontWeight: 700, color: "var(--color-text-primary, #111827)", letterSpacing: "-0.025em", margin: 0 }}>
            {t("Главная", "Bosh sahifa")}
          </h1>
          <p style={{ fontSize: "13px", color: "var(--color-text-secondary, #6b7280)", margin: "4px 0 0" }}>
            {greeting}, {user?.name?.split(" ")[0] ?? ""} — {format(new Date(), "EEEE, d MMMM yyyy", { locale: ru })}
          </p>
        </div>
        <button
          onClick={navigateNewOrder}
          style={{
            display: "flex", alignItems: "center", gap: "8px", padding: "10px 20px",
            fontSize: "13px", fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
            borderRadius: "12px", border: "none", cursor: "pointer",
            background: "var(--color-primary, #818cf8)", color: "#fff",
            boxShadow: "0 2px 8px rgba(129,140,248,.25)", transition: "all 0.2s ease",
          }}
        >
          <Sparkles size={16} />
          <span>{t("Новый заказ", "Yangi buyurtma")}</span>
        </button>
      </div>

      {/* ── KPI Cards ─────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
        {/* Revenue */}
        <Card onClick={navigateReports}>
          <CardDots />
          <p style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", margin: 0, fontFamily: "'DM Sans', sans-serif" }}>
            {t("ВЫРУЧКА", "TUSHUM")}
          </p>
          <p style={{ fontSize: "28px", fontWeight: 700, color: "var(--color-text-primary, #111827)", margin: "8px 0 0", letterSpacing: "-0.03em", fontFamily: "'DM Sans', sans-serif" }}>
            {fmt(kpis.todayRevenue, true)}
          </p>
          {revenueDelta !== 0 && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", marginTop: "8px", padding: "3px 8px", borderRadius: "6px", background: revenueDelta > 0 ? "rgba(74,222,128,.10)" : "rgba(248,113,113,.10)" }}>
              {revenueDelta > 0 ? <TrendingUp size={12} color="#4ade80" /> : <TrendingDown size={12} color="#f87171" />}
              <span style={{ fontSize: "12px", fontWeight: 600, color: revenueDelta > 0 ? "#4ade80" : "#f87171" }}>
                {Math.abs(revenueDelta).toFixed(1)}%
              </span>
            </div>
          )}
          {revenueTrend.length > 0 && (
            <div style={{ marginTop: "12px", height: "40px", opacity: 0.6 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueTrend.map((v, i) => ({ i, v }))}>
                  <defs><linearGradient id="gRevKpi" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-success, #4ade80)" stopOpacity={0.3} /><stop offset="100%" stopColor="var(--color-success, #4ade80)" stopOpacity={0} /></linearGradient></defs>
                  <Area type="monotone" dataKey="v" stroke="var(--color-success, #4ade80)" strokeWidth={2} fill="url(#gRevKpi)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Orders */}
        <Card onClick={navigateOrders}>
          <CardDots />
          <p style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", margin: 0, fontFamily: "'DM Sans', sans-serif" }}>
            {t("ЗАКАЗЫ", "BUYURTMALAR")}
          </p>
          <p style={{ fontSize: "28px", fontWeight: 700, color: "var(--color-text-primary, #111827)", margin: "8px 0 0", letterSpacing: "-0.03em", fontFamily: "'DM Sans', sans-serif" }}>
            {kpis.todayOrders}
          </p>
          {ordersDelta !== 0 && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", marginTop: "8px", padding: "3px 8px", borderRadius: "6px", background: ordersDelta > 0 ? "rgba(74,222,128,.10)" : "rgba(248,113,113,.10)" }}>
              {ordersDelta > 0 ? <TrendingUp size={12} color="#4ade80" /> : <TrendingDown size={12} color="#f87171" />}
              <span style={{ fontSize: "12px", fontWeight: 600, color: ordersDelta > 0 ? "#4ade80" : "#f87171" }}>
                {Math.abs(ordersDelta).toFixed(1)}%
              </span>
            </div>
          )}
          {ordersTrend.length > 0 && (
            <div style={{ marginTop: "12px", height: "40px", opacity: 0.6 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={ordersTrend.map((v, i) => ({ i, v }))}>
                  <defs><linearGradient id="gOrdKpi" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-warning, #fb923c)" stopOpacity={0.3} /><stop offset="100%" stopColor="var(--color-warning, #fb923c)" stopOpacity={0} /></linearGradient></defs>
                  <Area type="monotone" dataKey="v" stroke="var(--color-warning, #fb923c)" strokeWidth={2} fill="url(#gOrdKpi)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Debt */}
        <Card onClick={navigateReports}>
          <CardDots />
          <p style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", margin: 0, fontFamily: "'DM Sans', sans-serif" }}>
            {t("ДОЛГ КЛИЕНТОВ", "MIJZOZLAR QARZI")}
          </p>
          <p style={{ fontSize: "28px", fontWeight: 700, color: "var(--color-text-primary, #111827)", margin: "8px 0 0", letterSpacing: "-0.03em", fontFamily: "'DM Sans', sans-serif" }}>
            {fmt(kpis.customerDebt ?? 0, true)}
          </p>
        </Card>

        {/* Gross Margin with Ring */}
        <Card onClick={navigateReports}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <CardDots />
              <p style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", margin: 0, fontFamily: "'DM Sans', sans-serif" }}>
                {t("ВАЛОВАЯ ПРИБЫЛЬ", "SOF FOYDA")}
              </p>
              <p style={{ fontSize: "28px", fontWeight: 700, color: "var(--color-text-primary, #111827)", margin: "8px 0 0", letterSpacing: "-0.03em", fontFamily: "'DM Sans', sans-serif" }}>
                {(kpis.grossMargin ?? 0).toFixed(1)}%
              </p>
            </div>
            <ProgressRing
              value={Math.max(0, Math.min(100, kpis.grossMargin ?? 0))}
              color="var(--color-primary, #818cf8)"
              size={72}
              strokeWidth={6}
              label={`${(kpis.grossMargin ?? 0).toFixed(0)}%`}
            />
          </div>
        </Card>
      </div>

      {/* ── Smart Alerts ──────────────────────────────────────────────── */}
      {alerts && (alerts as any[]).length > 0 && (
        <div style={{ display: "flex", gap: "12px", overflowX: "auto", paddingBottom: "4px" }}>
          {(alerts as any[]).slice(0, 4).map((alert: any, i: any) => {
            const colors: Record<string, { bg: string; icon: string }> = {
              info:    { bg: "rgba(96,165,250,.08)", icon: "#60a5fa" },
              warning: { bg: "rgba(251,191,36,.08)", icon: "#fbbf24" },
              danger:  { bg: "rgba(248,113,113,.08)", icon: "#f87171" },
            };
            const c = colors[alert.severity] || colors.info;
            return (
              <div key={i} style={{ flex: "0 0 auto", minWidth: "240px", padding: "14px 16px", borderRadius: "14px", background: c.bg, display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ width: "32px", height: "32px", borderRadius: "10px", background: `${c.icon}20`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {alert.severity === "danger" ? <AlertCircle size={16} style={{ color: c.icon }} /> : alert.severity === "warning" ? <TrendingDown size={16} style={{ color: c.icon }} /> : <TrendingUp size={16} style={{ color: c.icon }} />}
                </div>
                <div>
                  <p style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary, #111827)", margin: 0 }}>{alert.title}</p>
                  <p style={{ fontSize: "11px", color: "var(--color-text-secondary, #6b7280)", margin: "2px 0 0" }}>{alert.message}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Chart + Recent Orders ─────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "16px" }}>

        {/* Sales Chart */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
            <SectionTitle title={t("Динамика продаж", "Sotuvlar dinamikasi")} subtitle={t("Выручка и количество заказов", "Tushum va buyurtmalar soni")} />
            <RangePills range={range} on7d={() => setRange("7d")} on30d={() => setRange("30d")} onMonth={() => setRange("month")} t={t} />
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-primary, #818cf8)" stopOpacity={0.15} /><stop offset="100%" stopColor="var(--color-primary, #818cf8)" stopOpacity={0} /></linearGradient>
                <linearGradient id="gOrders" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-success, #4ade80)" stopOpacity={0.15} /><stop offset="100%" stopColor="var(--color-success, #4ade80)" stopOpacity={0} /></linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fill: "var(--color-text-tertiary, #9ca3af)", fontSize: 11, fontFamily: "'DM Sans', sans-serif" }} axisLine={false} tickLine={false} dy={8} />
              <YAxis yAxisId="left" tick={{ fill: "var(--color-text-tertiary, #9ca3af)", fontSize: 11, fontFamily: "'DM Sans', sans-serif" }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v, true)} dx={-4} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: "var(--color-text-tertiary, #9ca3af)", fontSize: 11, fontFamily: "'DM Sans', sans-serif" }} axisLine={false} tickLine={false} dx={4} />
              <Tooltip content={<ChartTooltip fmt={fmt} />} cursor={{ stroke: "var(--color-border, #e5e7eb)", strokeWidth: 1, strokeDasharray: "4 4" }} />
              <Area yAxisId="left" type="monotone" dataKey="revenue" stroke="var(--color-primary, #818cf8)" strokeWidth={2.5} fill="url(#gRevenue)" name={t("Выручка", "Tushum")} dot={false} activeDot={{ r: 5, fill: "var(--color-primary, #818cf8)", stroke: "#fff", strokeWidth: 2 }} />
              <Area yAxisId="right" type="monotone" dataKey="orders" stroke="var(--color-success, #4ade80)" strokeWidth={2.5} fill="url(#gOrders)" name={t("Заказы", "Buyurtmalar")} dot={false} activeDot={{ r: 5, fill: "var(--color-success, #4ade80)", stroke: "#fff", strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        {/* Recent Orders */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <SectionTitle title={t("Последние заказы", "So'nggi buyurtmalar")} subtitle={`${activity?.length ?? 0} ${t("заказов", "buyurtmalar")}`} />
            <button onClick={navigateOrders} style={{ padding: "6px", borderRadius: "8px", border: "none", cursor: "pointer", background: "transparent", color: "var(--color-text-tertiary, #9ca3af)" }}>
              <ArrowRight size={16} />
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {!activity?.length ? (
              <div style={{ textAlign: "center", padding: "32px 0" }}>
                <div style={{ width: "48px", height: "48px", margin: "0 auto 12px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-surface-light, #f3f4f6)" }}>
                  <ClipboardList size={20} color="var(--color-text-tertiary, #9ca3af)" />
                </div>
                <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-secondary, #6b7280)" }}>
                  {t("Заказов пока нет", "Hali buyurtma yo'q")}
                </p>
              </div>
            ) : (
              activity.slice(0, 8).map((e) => (
                <div key={e.id} onClick={() => navigate(`/orders/${e.id}`)} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 0", cursor: "pointer", borderBottom: "1px solid var(--color-border, #f3f4f6)" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0, background: STATUS_COLOR[e.status ?? "new"] }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary, #111827)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.agentName}</p>
                    <p style={{ fontSize: "11px", color: "var(--color-text-tertiary, #9ca3af)", margin: "2px 0 0" }}>#{e.orderNumber} · {e.createdAt ? format(new Date(e.createdAt), "HH:mm") : ""}</p>
                  </div>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary, #111827)", fontFamily: "'DM Sans', sans-serif", flexShrink: 0 }}>{fmt(e.total, true)}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* ── Status Breakdown ──────────────────────────────────────────── */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <SectionTitle title={t("Статусы заказов", "Buyurtmalar holati")} subtitle={`${statusTotal} ${t("всего", "jami")}`} />
          <button onClick={navigateOrders} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", fontSize: "12px", fontWeight: 600, fontFamily: "'DM Sans', sans-serif", borderRadius: "8px", border: "none", cursor: "pointer", background: "var(--color-primary-subtle, rgba(129,140,248,.10))", color: "var(--color-primary, #818cf8)" }}>
            {t("Все заказы", "Barcha buyurtmalar")} <ArrowRight size={12} />
          </button>
        </div>
        <div style={{ display: "flex", height: "6px", borderRadius: "3px", overflow: "hidden", gap: "2px", background: "var(--color-surface-light, #f3f4f6)", marginBottom: "16px" }}>
          {statusData?.map(s => <div key={s.status} style={{ height: "100%", borderRadius: "3px", background: STATUS_COLOR[s.status ?? ""] ?? "var(--color-border-strong, #d1d5db)", width: `${(Number(s.count) / statusTotal) * 100}%` }} />)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
          {statusData?.map(s => (
            <div key={s.status} onClick={() => navigate(`/orders?status=${s.status}`)} style={{ padding: "16px", borderRadius: "14px", cursor: "pointer", background: "var(--color-surface-light, #f8f9fb)", transition: "all 0.2s" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: STATUS_COLOR[s.status ?? ""] ?? "var(--color-border-strong, #d1d5db)" }} />
                <span style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-tertiary, #9ca3af)" }}>{STATUS_LABEL[s.status ?? ""]?.[lang] ?? s.status}</span>
              </div>
              <p style={{ fontSize: "22px", fontWeight: 700, color: "var(--color-text-primary, #111827)", fontFamily: "'DM Sans', sans-serif", letterSpacing: "-0.02em", margin: 0 }}>{s.count}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
