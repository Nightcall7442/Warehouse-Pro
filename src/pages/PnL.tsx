import { useState, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { exportToExcel } from "@/lib/excel";
import { subDays, format, subMonths, startOfYear } from "date-fns";
import { FileDown, FileSpreadsheet, TrendingUp, DollarSign, Truck, Package, ShoppingCart, Minus, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { ProgressRing } from "@/components/ProgressRing";
import { Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ComposedChart, Line, ReferenceLine } from "recharts";
import { CardDots, Card, KpiCard, PageHeader, thStyle, tdStyle, btnSecondary, SectionTitle } from "@/components/DashboardLayout";

type Range = "7d" | "30d" | "90d" | "12m" | "ytd" | "custom";

const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };

function KpiCardPnL({ label, value, delta, icon, gradient }: {
  label: string; value: string; delta: number | null;
  icon: React.ReactNode; gradient: string;
}) {
  const isPositive = delta !== null && delta > 0;
  const isNegative = delta !== null && delta < 0;
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
        <CardDots />
        <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {icon}
        </div>
      </div>
      <p style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", margin: 0, fontFamily: F.body }}>
        {label}
      </p>
      <p style={{ fontSize: "28px", fontWeight: 700, color: "var(--color-text-primary, #111827)", lineHeight: 1, letterSpacing: "-0.03em", margin: "8px 0 0", fontFamily: F.display }}>
        {value}
      </p>
      {delta !== null && (
        <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "10px", fontSize: "12px", fontWeight: 600, fontFamily: F.body, color: isPositive ? "#4ade80" : isNegative ? "#f87171" : "var(--color-text-tertiary, #9ca3af)" }}>
          {isPositive ? <ArrowUpRight size={14} /> : isNegative ? <ArrowDownRight size={14} /> : <Minus size={14} />}
          {Math.abs(delta).toFixed(1)}%
        </div>
      )}
    </Card>
  );
}

export default function PnL() {
  const [range, setRange] = useState<Range>("30d");
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { from, to } = useMemo(() => {
    const now = new Date();
    switch (range) {
      case "7d": return { from: format(subDays(now, 7), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") };
      case "30d": return { from: format(subDays(now, 30), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") };
      case "90d": return { from: format(subDays(now, 90), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") };
      case "12m": return { from: format(subMonths(now, 12), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") };
      case "ytd": return { from: format(startOfYear(now), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") };
      default: return { from: format(subDays(now, 30), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") };
    }
  }, [range]);

  const { data, isLoading } = trpc.analytics.pnl.useQuery({ from, to, compareWithPrev: true });
  const current = data?.current;
  const deltas = data?.deltas;
  const trend = data?.trend ?? [];

  const chartData = useMemo(() => trend.map(r => ({
    month: r.month, revenue: r.revenue, cogs: r.cogs, grossProfit: r.grossProfit, operatingExpenses: r.operatingExpenses, netProfit: r.netProfit,
  })), [trend]);

  const RANGES: Record<Range, { ru: string; uz: string }> = {
    "7d": { ru: "7 дней", uz: "7 kun" }, "30d": { ru: "30 дней", uz: "30 kun" },
    "90d": { ru: "90 дней", uz: "90 kun" }, "12m": { ru: "12 мес.", uz: "12 oy" },
    "ytd": { ru: "Год", uz: "Yil" }, "custom": { ru: "Период", uz: "Davr" },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader
        title={t("Доходы и расходы", "Foyda va zarar")}
        subtitle={`${t("Реальная себестоимость и маржинальность", "Haqiqiy COGS va marjalar")} · ${from} — ${to}`}
        actions={<button onClick={() => exportToExcel([], `pnl-${from}-${to}`)} style={btnSecondary}><FileSpreadsheet size={14} /> Excel</button>}
      />

      {/* Range pills */}
      <div style={{ display: "inline-flex", background: "var(--color-surface-light, #f3f4f6)", borderRadius: "10px", padding: "3px", gap: "2px", alignSelf: "flex-start" }}>
        {(["7d", "30d", "90d", "12m", "ytd"] as Range[]).map(r => (
          <button key={r} onClick={() => setRange(r)} style={{ padding: "6px 14px", fontSize: "12px", fontWeight: 600, fontFamily: F.body, borderRadius: "8px", border: "none", cursor: "pointer", background: range === r ? "var(--color-surface, #ffffff)" : "transparent", color: range === r ? "var(--color-text-primary, #111827)" : "var(--color-text-secondary, #6b7280)", boxShadow: range === r ? "0 1px 3px rgba(0,0,0,.08)" : "none", transition: "all 0.15s" }}>
            {RANGES[r][lang]}
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
        <KpiCardPnL label={t("ВЫРУЧКА", "TUSHUM")} value={fmt(current?.revenue ?? 0)} delta={deltas?.revenue ?? null} icon={<TrendingUp size={18} color="#fff" />} gradient="rgba(74,222,128,.15)" />
        <KpiCardPnL label={t("СЕБЕСТОИМОСТЬ", "TANNARX")} value={fmt(current?.cogs ?? 0)} delta={deltas?.cogs ?? null} icon={<Package size={18} color="#fff" />} gradient="rgba(251,146,60,.15)" />
        <KpiCardPnL label={t("ВАЛОВАЯ ПРИБЫЛЬ", "YALPI FOYDA")} value={fmt(current?.grossProfit ?? 0)} delta={deltas?.grossProfit ?? null} icon={<DollarSign size={18} color="#fff" />} gradient="rgba(129,140,248,.15)" />
        <KpiCardPnL label={t("РАСХОДЫ ДОСТАВКА", "YETKAZISH XARAJAT")} value={fmt(current?.operatingExpenses ?? 0)} delta={deltas?.operatingExpenses ?? null} icon={<Truck size={18} color="#fff" />} gradient="rgba(248,113,113,.15)" />
        <KpiCardPnL label={t("ЧИСТАЯ ПРИБЫЛЬ", "TOZA FOYDA")} value={fmt(current?.netProfit ?? 0)} delta={deltas?.netProfit ?? null} icon={<ShoppingCart size={18} color="#fff" />} gradient="rgba(45,212,191,.15)" />
      </div>

      {/* Margin Rings */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
        {[
          { label: t("ВАЛОВАЯ МАРЖА", "YALPI MARJA"), pct: current?.grossMarginPct ?? 0, delta: deltas?.grossMarginPct },
          { label: t("ЧИСТАЯ МАРЖА", "TOZA MARJA"), pct: current?.netMarginPct ?? 0, delta: deltas?.netMarginPct },
          { label: t("ДОЛЯ СЕБЕСТОИМОСТИ", "COGS %"), pct: (current?.revenue ?? 0) > 0 ? ((current?.cogs ?? 0) / (current?.revenue ?? 1)) * 100 : 0, delta: null },
        ].map((item, i) => (
          <Card key={i}>
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <ProgressRing value={Math.max(0, Math.min(100, item.pct))} color={item.pct >= 20 ? "var(--color-success, #4ade80)" : item.pct >= 10 ? "var(--color-warning, #fbbf24)" : "var(--color-danger, #f87171)"} size={72} strokeWidth={6} label={`${item.pct.toFixed(0)}%`} />
              <div>
                <p style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", margin: 0 }}>{item.label}</p>
                {item.delta !== null && item.delta !== undefined && (
                  <p style={{ fontSize: "11px", color: item.delta >= 0 ? "#4ade80" : "#f87171", margin: "4px 0 0", fontWeight: 600 }}>{item.delta >= 0 ? "+" : ""}{item.delta.toFixed(1)}pp</p>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Monthly Trend Chart */}
      {chartData.length > 0 && (
        <Card>
          <SectionTitle title={t("Месячный тренд", "Oylik trend")} />
          <div style={{ height: "320px", marginTop: "16px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #f3f4f6)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--color-text-tertiary, #9ca3af)", fontFamily: F.body }} axisLine={{ stroke: "var(--color-border, #f3f4f6)" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--color-text-tertiary, #9ca3af)", fontFamily: F.body }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(0)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}K` : String(v)} />
                <Tooltip contentStyle={{ background: "var(--color-surface, #ffffff)", border: "none", borderRadius: 12, boxShadow: "0 4px 12px rgba(0,0,0,.08)" }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "12px", fontFamily: F.body, paddingTop: "12px" }} />
                <Bar dataKey="revenue" name={t("Выручка", "Tushum")} fill="var(--color-primary, #818cf8)" radius={[4, 4, 0, 0]} opacity={0.85} />
                <Bar dataKey="cogs" name="COGS" fill="var(--color-warning, #fbbf24)" radius={[4, 4, 0, 0]} opacity={0.85} />
                <Line dataKey="grossProfit" name={t("Вал. прибыль", "Yalpi foyda")} stroke="var(--color-success, #4ade80)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--color-success, #4ade80)", stroke: "var(--color-surface, #ffffff)", strokeWidth: 2 }} />
                <Line dataKey="netProfit" name={t("Чист. прибыль", "Toza foyda")} stroke="var(--color-primary-muted, #c7c9f8)" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3, fill: "var(--color-primary-muted, #c7c9f8)", stroke: "var(--color-surface, #ffffff)", strokeWidth: 2 }} />
                <ReferenceLine y={0} stroke="var(--color-border, #f3f4f6)" strokeDasharray="3 3" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </div>
  );
}
