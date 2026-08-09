import { memo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import type { inferRouterOutputs } from "@trpc/server";
import { Users, MapPin, ClipboardList, TrendingUp, Activity } from "lucide-react";
import { ProgressRing } from "@/components/ProgressRing";
import { F, COLORS } from "./report-constants";
import { KpiCard } from "./ReportKpiCards";
import { ChartPanel, GlassPanel, PlanCompletion } from "./ReportCharts";
import type { AppRouter } from "../../../api/router";

type PlanRow = inferRouterOutputs<AppRouter>["reports"]["getPlanCompletion"][number];

interface OverviewTabProps {
  summary: {
    totalAgents: number;
    activeNow: number;
    visitsToday: number;
    ordersMonth: number;
    avgOrdersPerAgent: number;
    revenueMonth: number;
  } | undefined;
  summaryLoading: boolean;
  chart: { date: string; visits: number; orders: number }[] | undefined;
  plans: PlanRow[] | undefined;
  days: number;
  fmt: (v: string | number, short?: boolean) => string;
  t: (ru: string, uz: string) => string;
}

export const OverviewTab = memo(function OverviewTab({
  summary, summaryLoading, chart, plans, days, fmt, t,
}: OverviewTabProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* KPIs */}
      {summaryLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="kpi-hero" style={{ height: "160px" }} />)}
        </div>
      ) : summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label={t("АГЕНТОВ", "AGENTLAR")} value={String(summary.totalAgents)} sub={`${summary.activeNow} ${t("онлайн", "onlayn")}`} icon={<Users size={20} color="#fff" />} gradient="linear-gradient(135deg, var(--kpi-purple), var(--kpi-purple))" />
          <KpiCard label={t("ВИЗИТЫ", "TASHRIFLAR")} value={String(summary.visitsToday)} icon={<MapPin size={20} color="#fff" />} gradient="linear-gradient(135deg, var(--kpi-teal), var(--kpi-teal))" />
          <KpiCard label={`${t("ЗАКАЗЫ", "BUYURTMA")} ${days}д`} value={String(summary.ordersMonth)} sub={`≈${summary.avgOrdersPerAgent}/${t("агент", "agent")}`} icon={<ClipboardList size={20} color="#fff" />} gradient="linear-gradient(135deg, var(--kpi-orange), var(--kpi-orange))" />
          <KpiCard label={`${t("ВЫРУЧКА", "TUSHUM")} ${days}д`} value={fmt(summary.revenueMonth)} icon={<TrendingUp size={20} color="#fff" />} gradient="linear-gradient(135deg, var(--kpi-green), var(--kpi-green))" />
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
              <Line type="monotone" dataKey="visits" stroke="var(--color-primary)" strokeWidth={2.5} dot={false} name={t("Визиты", "Tashriflar")} />
              <Line type="monotone" dataKey="orders" stroke="var(--color-success)" strokeWidth={2.5} dot={false} name={t("Заказы", "Buyurtmalar")} />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>

        {/* Plan completion */}
        <GlassPanel>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
            <Activity size={16} style={{ color: COLORS.primaryText }} />
            <h2 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
              {t("План сегодня", "Bugungi reja")}
            </h2>
          </div>
          {!!plans?.length && (() => {
            const totalVisited = plans.reduce((s, p) => s + Number(p.visited ?? 0), 0);
            const totalPlanned = plans.reduce((s, p) => s + Number(p.total ?? 0), 0);
            const pct = totalPlanned > 0 ? Math.round((totalVisited / totalPlanned) * 100) : 0;
            const ringColor = pct >= 80 ? "var(--color-success)" : pct >= 50 ? "var(--color-warning)" : "var(--color-danger)";
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
  );
});
