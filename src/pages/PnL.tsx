import { useState, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { exportToExcel } from "@/lib/excel";
import { subDays, format, subMonths, startOfYear } from "date-fns";
import {
  FileDown, FileSpreadsheet, TrendingUp, DollarSign,
  Truck, Package, ShoppingCart, Minus, ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import { ProgressRing } from "@/components/ProgressRing";
import {
  Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, ComposedChart, Line, ReferenceLine, BarChart, Cell,
} from "recharts";

type Range = "7d" | "30d" | "90d" | "12m" | "ytd" | "custom";

const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };
const COLORS = {
  primary: "#4b6cf6", success: "#34c473",
  warning: "#e8a830", danger: "#e85050",
  surface: "var(--color-surface, #ffffff)", surfaceLight: "var(--color-surface-light, #f0f3f8)",
  textPrimary: "var(--color-text-primary, #2b3450)", textSecondary: "var(--color-text-secondary, #6a7290)",
  textTertiary: "var(--color-text-tertiary, #98a0b8)", border: "var(--color-border, #f0f3f8)",
};
const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

const PAYMENT_COLORS: Record<string, string> = {
  cash: "#34c473", transfer: "#4b6cf6", debt: "#e8a830", card: "#9b59b6",
};
const PAYMENT_LABELS: Record<string, { ru: string; uz: string }> = {
  cash:     { ru: "Наличные",     uz: "Naqd" },
  transfer: { ru: "Перечисление", uz: "O'tkazma" },
  debt:     { ru: "Долг",         uz: "Qarz" },
  card:     { ru: "Карта",        uz: "Plastik karta" },
};

function DateInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <span style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary, fontFamily: F.body }}>
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          padding: "7px 10px", fontSize: "13px", fontFamily: F.body,
          borderRadius: "8px", border: `1px solid ${COLORS.border}`,
          background: COLORS.surfaceLight, color: COLORS.textPrimary,
          outline: "none", width: "140px",
        }}
      />
    </label>
  );
}

function KpiCard({ label, value, delta, icon, gradient, delay }: {
  label: string; value: string; delta: number | null;
  icon: React.ReactNode; gradient: string; delay: number;
}) {
  const isPositive = delta !== null && delta > 0;
  const isNegative = delta !== null && delta < 0;
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
      {delta !== null && (
        <div style={{
          display: "flex", alignItems: "center", gap: "4px", marginTop: "10px",
          fontSize: "12px", fontWeight: 600, fontFamily: F.body,
          color: isPositive ? "#34c473" : isNegative ? "#e85050" : COLORS.textTertiary,
        }}>
          {isPositive ? <ArrowUpRight size={14} /> : isNegative ? <ArrowDownRight size={14} /> : <Minus size={14} />}
          {Math.abs(delta).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.08em", color: COLORS.textTertiary, padding: "12px 16px",
  borderBottom: `1px solid ${COLORS.border}`, textAlign: "left",
};
const tdStyle: React.CSSProperties = {
  padding: "14px 16px", borderBottom: `1px solid ${COLORS.border}`,
  fontSize: "14px", fontFamily: F.body, color: COLORS.textPrimary,
};

function ChartTooltip({ active, payload, label, fmt }: {
  active?: boolean; payload?: Array<{ dataKey: string; name: string; value: number; fill?: string; stroke?: string }>;
  label?: string; fmt: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: COLORS.surface, border: `1px solid ${COLORS.border}`,
      borderRadius: "12px", padding: "14px 16px", boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
      minWidth: "160px",
    }}>
      <p style={{ fontSize: "11px", fontWeight: 600, color: COLORS.textTertiary, marginBottom: "8px", fontFamily: F.body, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {label}
      </p>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", marginTop: "4px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: p.fill ?? p.stroke ?? "#4b6cf6" }} />
            <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{p.name}</span>
          </div>
          <span style={{ fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary, fontFamily: F.display }}>
            {fmt(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function PnL() {
  const [range, setRange] = useState<Range>("30d");
  const [customFrom, setCustomFrom] = useState(() => format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [customTo, setCustomTo] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [showCustom, setShowCustom] = useState(false);
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { from, to } = useMemo(() => {
    const now = new Date();
    switch (range) {
      case "7d":   return { from: format(subDays(now, 7), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") };
      case "30d":  return { from: format(subDays(now, 30), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") };
      case "90d":  return { from: format(subDays(now, 90), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") };
      case "12m":  return { from: format(subMonths(now, 12), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") };
      case "ytd":  return { from: format(startOfYear(now), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") };
      case "custom": return { from: customFrom, to: customTo };
      default:     return { from: format(subDays(now, 30), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") };
    }
  }, [range, customFrom, customTo]);

  const { data, isLoading } = trpc.analytics.pnl.useQuery({ from, to, compareWithPrev: true });

  const cogsByProduct = trpc.analytics.cogsByProduct.useQuery({ dateFrom: from, dateTo: to });
  const arrivals = trpc.arrival.list.useQuery({ page: 1, pageSize: 1000 });
  const paymentBreakdown = trpc.analytics.pnlByPaymentMethod.useQuery({ from, to });
  const paymentTrend = trpc.analytics.paymentMethodTrend.useQuery({ from, to });

  const current = data?.current;
  const deltas = data?.deltas;
  const trend = data?.trend ?? [];

  const chartData = useMemo(() => {
    return trend.map(r => ({
      month: r.month,
      revenue: r.revenue,
      cogs: r.cogs,
      grossProfit: r.grossProfit,
      operatingExpenses: r.operatingExpenses,
      netProfit: r.netProfit,
    }));
  }, [trend]);

  const RANGES: Record<Range, { ru: string; uz: string }> = {
    "7d":    { ru: "7 дней",  uz: "7 kun" },
    "30d":   { ru: "30 дней", uz: "30 kun" },
    "90d":   { ru: "90 дней", uz: "90 kun" },
    "12m":   { ru: "12 мес.", uz: "12 oy" },
    "ytd":   { ru: "Год",     uz: "Yil" },
    "custom": { ru: "Период", uz: "Davr" },
  };

  const handleExportExcel = () => {
    const rows: any[] = [
      { Показатель: "Период", Значение: `${from} — ${to}` },
      { Показатель: "Выручка", Сумма: (current?.revenue ?? 0).toFixed(0) },
      { Показатель: "Скидки", Сумма: (current?.discount ?? 0).toFixed(0) },
      { Показатель: "Себестоимость (COGS)", Сумма: (current?.cogs ?? 0).toFixed(0) },
      { Показатель: "Валовая прибыль", Сумма: (current?.grossProfit ?? 0).toFixed(0) },
      { Показатель: "Валовая маржа", Сумма: `${(current?.grossMarginPct ?? 0).toFixed(1)}%` },
      { Показатель: "Расходы на доставку", Сумма: (current?.operatingExpenses ?? 0).toFixed(0) },
      { Показатель: "Чистая прибыль", Сумма: (current?.netProfit ?? 0).toFixed(0) },
      { Показатель: "Чистая маржа", Сумма: `${(current?.netMarginPct ?? 0).toFixed(1)}%` },
      { Показатель: "Заказов", Сумма: current?.orderCount ?? 0 },
    ];
    if (data?.previous) {
      rows.push(
        { Показатель: "" },
        { Показатель: "--- ПРЕДЫДУЩИЙ ПЕРИОД ---" },
        { Показатель: "Выручка (прошл.)", Сумма: data.previous.revenue.toFixed(0) },
        { Показатель: "COGS (прошл.)", Сумма: data.previous.cogs.toFixed(0) },
        { Показатель: "Валовая прибыль (прошл.)", Сумма: data.previous.grossProfit.toFixed(0) },
        { Показатель: "Чистая прибыль (прошл.)", Сумма: data.previous.netProfit.toFixed(0) },
      );
    }
    if (cogsByProduct.data && cogsByProduct.data.length > 0) {
      rows.push({ Показатель: "" }, { Показатель: "--- ПО ТОВАРАМ ---" });
      cogsByProduct.data.forEach(p => {
        const rev = Number(p.totalRevenue);
        const cost = Number(p.totalCost);
        const profit = rev - cost;
        const margin = rev > 0 ? (profit / rev) * 100 : 0;
        rows.push({
          Показатель: p.productName,
          "Объём": Number(p.totalQty).toFixed(0),
          Выручка: rev.toFixed(0),
          "Себестоимость": cost.toFixed(0),
          Прибыль: profit.toFixed(0),
          "Маржа %": `${margin.toFixed(0)}%`,
        });
      });
    }
    if (paymentBreakdown.data && paymentBreakdown.data.length > 0) {
      rows.push({ Показатель: "" }, { Показатель: "--- ПО МЕТОДАМ ОПЛАТЫ ---" });
      paymentBreakdown.data.forEach(row => {
        const label = PAYMENT_LABELS[row.paymentMethod]?.ru ?? row.paymentMethod;
        rows.push({
          Показатель: label,
          Выручка: row.revenue.toFixed(0),
          "Себестоимость": row.cogs.toFixed(0),
          Прибыль: row.grossProfit.toFixed(0),
          "Маржа %": `${row.grossMarginPct.toFixed(0)}%`,
          "Заказов": row.orderCount,
        });
      });
    }
    exportToExcel(rows, `pnl-${from}-${to}`);
  };

  const handleExportPDF = () => {
    const content = [
      `P&L Report: ${from} — ${to}`,
      `${"═".repeat(50)}`,
      ``,
      `Revenue:           ${fmt(current?.revenue ?? 0)}`,
      `Discounts:         ${fmt(current?.discount ?? 0)}`,
      `COGS:              ${fmt(current?.cogs ?? 0)}`,
      `Gross Profit:      ${fmt(current?.grossProfit ?? 0)}`,
      `Gross Margin:      ${(current?.grossMarginPct ?? 0).toFixed(1)}%`,
      `Operating Expenses:${fmt(current?.operatingExpenses ?? 0)}`,
      `Net Profit:        ${fmt(current?.netProfit ?? 0)}`,
      `Net Margin:        ${(current?.netMarginPct ?? 0).toFixed(1)}%`,
      `Orders:            ${current?.orderCount ?? 0}`,
    ];
    if (data?.previous) {
      content.push(
        ``,
        `--- Previous Period (${data.prevPeriod?.from} — ${data.prevPeriod?.to}) ---`,
        `Revenue:           ${fmt(data.previous.revenue)}`,
        `COGS:              ${fmt(data.previous.cogs)}`,
        `Gross Profit:      ${fmt(data.previous.grossProfit)}`,
        `Net Profit:        ${fmt(data.previous.netProfit)}`,
      );
    }
    const blob = new Blob([content.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pnl-${from}-${to}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ height: "28px", width: "240px", borderRadius: "8px", background: COLORS.surfaceLight, marginBottom: "8px" }} />
            <div style={{ height: "16px", width: "300px", borderRadius: "6px", background: COLORS.surfaceLight }} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} style={{ height: "140px", borderRadius: "20px", background: COLORS.surfaceLight, animation: `slideUp ${0.4 + i * 0.05}s ease forwards` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.025em", margin: 0 }}>
            {t("Доходы и расходы", "Foyda va zarar")}
          </h1>
          <p style={{ fontSize: "13px", color: COLORS.textSecondary, margin: "4px 0 0" }}>
            {t("Реальная себестоимость и маржинальность", "Haqiqiy COGS va marjalar")}
            <span style={{ marginLeft: "8px", fontSize: "12px", color: COLORS.textTertiary }}>
              {from} — {to}
            </span>
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ display: "inline-flex", background: COLORS.surfaceLight, borderRadius: "12px", padding: "3px", gap: "2px" }}>
            {(["7d", "30d", "90d", "12m", "ytd", "custom"] as Range[]).map(r => (
              <button key={r} onClick={() => { setRange(r); setShowCustom(r === "custom"); }}
                style={{
                  padding: "8px 12px", fontSize: "11px", fontWeight: 600, fontFamily: F.body,
                  borderRadius: "10px", border: "none", cursor: "pointer", transition: "all 0.2s",
                  background: range === r ? COLORS.surface : "transparent",
                  color: range === r ? COLORS.textPrimary : COLORS.textSecondary,
                  boxShadow: range === r ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                }}>
                {RANGES[r][lang]}
              </button>
            ))}
          </div>
          <button onClick={handleExportExcel} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
            fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
            border: `1px solid ${COLORS.border}`, cursor: "pointer",
            background: COLORS.surface, color: COLORS.textSecondary,
          }}>
            <FileSpreadsheet size={14} /> Excel
          </button>
          <button onClick={handleExportPDF} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
            fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
            border: `1px solid ${COLORS.border}`, cursor: "pointer",
            background: COLORS.surface, color: COLORS.textSecondary,
          }}>
            <FileDown size={14} /> PDF
          </button>
        </div>
      </div>

      {/* Custom Date Range */}
      {showCustom && (
        <div style={{
          background: COLORS.surface, borderRadius: "16px", padding: "16px 20px",
          boxShadow: SHADOW, display: "flex", alignItems: "flex-end", gap: "16px", flexWrap: "wrap",
        }}>
          <DateInput value={customFrom} onChange={setCustomFrom} label={t("От", "Dan")} />
          <DateInput value={customTo} onChange={setCustomTo} label={t("До", "Gacha")} />
          <div style={{ fontSize: "12px", color: COLORS.textTertiary, fontFamily: F.body, paddingBottom: "6px" }}>
            {t("Выберите период для анализа", "Tahlil uchun davrni tanlang")}
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
        <KpiCard
          label={t("ВЫРУЧКА", "TUSHUM")}
          value={fmt(current?.revenue ?? 0)}
          delta={deltas?.revenue ?? null}
          icon={<TrendingUp size={20} color="#fff" />}
          gradient="linear-gradient(135deg, var(--kpi-green), var(--kpi-green))"
          delay={0}
        />
        <KpiCard
          label={t("СЕБЕСТОИМОСТЬ", "TANNARX")}
          value={fmt(current?.cogs ?? 0)}
          delta={deltas?.cogs ?? null}
          icon={<Package size={20} color="#fff" />}
          gradient="linear-gradient(135deg, var(--kpi-orange), var(--kpi-orange))"
          delay={0.05}
        />
        <KpiCard
          label={t("ВАЛОВАЯ ПРИБЫЛЬ", "YALPI FOYDA")}
          value={fmt(current?.grossProfit ?? 0)}
          delta={deltas?.grossProfit ?? null}
          icon={<DollarSign size={20} color="#fff" />}
          gradient={(current?.grossProfit ?? 0) >= 0 ? "linear-gradient(135deg, var(--kpi-indigo), var(--kpi-indigo))" : "linear-gradient(135deg, var(--kpi-red), var(--kpi-red))"}
          delay={0.1}
        />
        <KpiCard
          label={t("РАСХОДЫ ДОСТАВКА", "YETKAZISH XARAJAT")}
          value={fmt(current?.operatingExpenses ?? 0)}
          delta={deltas?.operatingExpenses ?? null}
          icon={<Truck size={20} color="#fff" />}
          gradient="linear-gradient(135deg, var(--kpi-red), var(--kpi-red))"
          delay={0.15}
        />
        <KpiCard
          label={t("ЧИСТАЯ ПРИБЫЛЬ", "TOZA FOYDA")}
          value={fmt(current?.netProfit ?? 0)}
          delta={deltas?.netProfit ?? null}
          icon={<ShoppingCart size={20} color="#fff" />}
          gradient={(current?.netProfit ?? 0) >= 0 ? "linear-gradient(135deg, var(--kpi-teal), var(--kpi-teal))" : "linear-gradient(135deg, var(--kpi-red), var(--kpi-red))"}
          delay={0.2}
        />
      </div>

      {/* Margin Rings + Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px" }}>
        {/* Gross Margin Ring */}
        <div style={{
          background: COLORS.surface, borderRadius: "24px", padding: "24px",
          boxShadow: SHADOW, display: "flex", alignItems: "center", gap: "16px",
        }}>
          {(() => {
            const pct = current?.grossMarginPct ?? 0;
            const ringColor = pct >= 20 ? "#34c473" : pct >= 10 ? "#e8a830" : "#e85050";
            const ringPct = Math.max(0, Math.min(100, pct));
            return (
              <ProgressRing value={ringPct} color={ringColor} size={80} strokeWidth={6} label={`${pct.toFixed(0)}%`} />
            );
          })()}
          <div>
            <div style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary, fontFamily: F.body }}>
              {lang === "uz" ? "YALPI MARJA" : "ВАЛОВАЯ МАРЖА"}
            </div>
            {deltas?.grossMarginPct !== null && deltas?.grossMarginPct !== undefined && (
              <p style={{ fontSize: "11px", color: deltas.grossMarginPct >= 0 ? "#34c473" : "#e85050", margin: "4px 0 0", fontWeight: 600 }}>
                {deltas.grossMarginPct >= 0 ? "+" : ""}{deltas.grossMarginPct.toFixed(1)}pp
              </p>
            )}
          </div>
        </div>

        {/* Net Margin Ring */}
        <div style={{
          background: COLORS.surface, borderRadius: "24px", padding: "24px",
          boxShadow: SHADOW, display: "flex", alignItems: "center", gap: "16px",
        }}>
          {(() => {
            const pct = current?.netMarginPct ?? 0;
            const ringColor = pct >= 15 ? "#34c473" : pct >= 5 ? "#e8a830" : "#e85050";
            const ringPct = Math.max(0, Math.min(100, pct));
            return (
              <ProgressRing value={ringPct} color={ringColor} size={80} strokeWidth={6} label={`${pct.toFixed(0)}%`} />
            );
          })()}
          <div>
            <div style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary, fontFamily: F.body }}>
              {lang === "uz" ? "TOZA MARJA" : "ЧИСТАЯ МАРЖА"}
            </div>
            {deltas?.netMarginPct !== null && deltas?.netMarginPct !== undefined && (
              <p style={{ fontSize: "11px", color: deltas.netMarginPct >= 0 ? "#34c473" : "#e85050", margin: "4px 0 0", fontWeight: 600 }}>
                {deltas.netMarginPct >= 0 ? "+" : ""}{deltas.netMarginPct.toFixed(1)}pp
              </p>
            )}
          </div>
        </div>

        {/* COGS % Ring */}
        <div style={{
          background: COLORS.surface, borderRadius: "24px", padding: "24px",
          boxShadow: SHADOW, display: "flex", alignItems: "center", gap: "16px",
        }}>
          {(() => {
            const pct = (current?.revenue ?? 0) > 0 ? ((current?.cogs ?? 0) / (current?.revenue ?? 1)) * 100 : 0;
            const ringColor = pct <= 60 ? "#34c473" : pct <= 80 ? "#e8a830" : "#e85050";
            const ringPct = Math.max(0, Math.min(100, pct));
            return (
              <ProgressRing value={ringPct} color={ringColor} size={80} strokeWidth={6} label={`${pct.toFixed(0)}%`} />
            );
          })()}
          <div>
            <div style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary, fontFamily: F.body }}>
              {lang === "uz" ? "COGS %" : "ДОЛЯ СЕБЕСТОИМОСТИ"}
            </div>
            <p style={{ fontSize: "11px", color: COLORS.textSecondary, margin: "4px 0 0" }}>
              {lang === "uz" ? "COGS / Daromad" : "COGS / Выручка"}
            </p>
          </div>
        </div>
      </div>

      {/* Payment Method Breakdown */}
      {paymentBreakdown.data && paymentBreakdown.data.length > 0 && (
        <div className="neo-card" style={{ padding: "24px" }}>
          <h2 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 600, color: COLORS.textPrimary, margin: "0 0 20px" }}>
            {t("Разбивка по методам оплаты", "To'lov usullari bo'yicha")}
          </h2>

          {/* Table */}
          <div style={{ overflowX: "auto", marginBottom: "24px" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("Метод оплаты", "To'lov usuli")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Выручка", "Tushum")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Себестоимость", "Tannarx")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Прибыль", "Foyda")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Маржа", "Marja")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Заказов", "Buyurtma")}</th>
                </tr>
              </thead>
              <tbody>
                {paymentBreakdown.data.map((row) => (
                  <tr key={row.paymentMethod} style={{ transition: "background 0.15s" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(75,108,246,0.02)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{
                          width: "8px", height: "8px", borderRadius: "50%",
                          background: PAYMENT_COLORS[row.paymentMethod] ?? COLORS.primary,
                        }} />
                        <span style={{ fontSize: "13px", fontWeight: 500 }}>
                          {PAYMENT_LABELS[row.paymentMethod]?.[lang] ?? row.paymentMethod}
                        </span>
                      </div>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>{fmt(row.revenue.toFixed(0))}</td>
                    <td style={{ ...tdStyle, textAlign: "right", color: "#e85050" }}>{fmt(row.cogs.toFixed(0))}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: row.grossProfit >= 0 ? "#34c473" : "#e85050" }}>
                      {fmt(row.grossProfit.toFixed(0))}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <span style={{
                        display: "inline-block", padding: "2px 8px", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
                        background: row.grossMarginPct >= 20 ? "rgba(74,222,128,0.1)" : row.grossMarginPct >= 10 ? "rgba(251,191,36,0.1)" : "rgba(232,80,80,0.1)",
                        color: row.grossMarginPct >= 20 ? "#34c473" : row.grossMarginPct >= 10 ? "#e8a830" : "#e85050",
                      }}>
                        {row.grossMarginPct.toFixed(0)}%
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{row.orderCount}</td>
                  </tr>
                ))}
                {/* Total row */}
                <tr style={{ borderTop: `2px solid ${COLORS.border}`, background: COLORS.surfaceLight }}>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{t("ИТОГО", "JAMI")}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                    {fmt(paymentBreakdown.data.reduce((s, r) => s + r.revenue, 0).toFixed(0))}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#e85050" }}>
                    {fmt(paymentBreakdown.data.reduce((s, r) => s + r.cogs, 0).toFixed(0))}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#34c473" }}>
                    {fmt(paymentBreakdown.data.reduce((s, r) => s + r.grossProfit, 0).toFixed(0))}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                    {(() => {
                      const totalRev = paymentBreakdown.data.reduce((s, r) => s + r.revenue, 0);
                      const totalCost = paymentBreakdown.data.reduce((s, r) => s + r.cogs, 0);
                      const margin = totalRev > 0 ? ((totalRev - totalCost) / totalRev) * 100 : 0;
                      return `${margin.toFixed(0)}%`;
                    })()}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                    {paymentBreakdown.data.reduce((s, r) => s + r.orderCount, 0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Stacked Bar Chart */}
          {paymentTrend.data && paymentTrend.data.length > 0 && (
            <div style={{ height: "300px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={paymentTrend.data} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: COLORS.textTertiary, fontFamily: F.body }}
                    axisLine={{ stroke: COLORS.border }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: COLORS.textTertiary, fontFamily: F.body }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(0)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}K` : String(v)}
                  />
                  <Tooltip content={<ChartTooltip fmt={(v) => fmt(v)} />} />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: "12px", fontFamily: F.body, paddingTop: "12px" }}
                  />
                  <Bar dataKey="cash" name={t("Наличные", "Naqd")} stackId="payment" fill="#34c473" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="transfer" name={t("Перечисление", "O'tkazma")} stackId="payment" fill="#4b6cf6" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="debt" name={t("Долг", "Qarz")} stackId="payment" fill="#e8a830" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="card" name={t("Карта", "Plastik")} stackId="payment" fill="#9b59b6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Period Comparison */}
      {data?.previous && (
        <div className="neo-card" style={{ padding: "24px" }}>
          <h2 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 600, color: COLORS.textPrimary, margin: "0 0 16px" }}>
            {t("Сравнение с предыдущим периодом", "Oldingi davr bilan taqqoslash")}
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
            {[
              { label: t("Выручка", "Tushum"), current: current?.revenue ?? 0, prev: data.previous.revenue, delta: deltas?.revenue },
              { label: t("COGS", "COGS"), current: current?.cogs ?? 0, prev: data.previous.cogs, delta: deltas?.cogs },
              { label: t("Валовая прибыль", "Yalpi foyda"), current: current?.grossProfit ?? 0, prev: data.previous.grossProfit, delta: deltas?.grossProfit },
              { label: t("Расходы", "Xarajatlar"), current: current?.operatingExpenses ?? 0, prev: data.previous.operatingExpenses, delta: deltas?.operatingExpenses },
              { label: t("Чистая прибыль", "Toza foyda"), current: current?.netProfit ?? 0, prev: data.previous.netProfit, delta: deltas?.netProfit },
            ].map((item) => (
              <div key={item.label} style={{
                padding: "16px", borderRadius: "14px",
                background: COLORS.surfaceLight, border: `1px solid ${COLORS.border}`,
              }}>
                <div style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary, fontFamily: F.body, marginBottom: "8px" }}>
                  {item.label}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                  <span style={{ fontSize: "18px", fontWeight: 700, color: COLORS.textPrimary, fontFamily: F.display }}>
                    {fmt(item.current)}
                  </span>
                  {item.delta !== null && item.delta !== undefined && (
                    <span style={{
                      fontSize: "12px", fontWeight: 600,
                      color: item.delta >= 0 ? "#34c473" : "#e85050",
                    }}>
                      {item.delta >= 0 ? "+" : ""}{item.delta.toFixed(1)}%
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "11px", color: COLORS.textTertiary, marginTop: "4px" }}>
                  {t("было", "oldingi")}: {fmt(item.prev)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Monthly Trend Chart */}
      {chartData.length > 0 && (
        <div className="neo-card" style={{ padding: "24px" }}>
          <h2 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 600, color: COLORS.textPrimary, margin: "0 0 20px" }}>
            {lang === "uz" ? "Oylik trend" : "Месячный тренд"}
          </h2>
          <div style={{ height: "320px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: COLORS.textTertiary, fontFamily: F.body }}
                  axisLine={{ stroke: COLORS.border }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: COLORS.textTertiary, fontFamily: F.body }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(0)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}K` : String(v)}
                />
                <Tooltip content={<ChartTooltip fmt={(v) => fmt(v)} />} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: "12px", fontFamily: F.body, paddingTop: "12px" }}
                />
                <Bar dataKey="revenue" name={t("Выручка", "Tushum")} fill="#4b6cf6" radius={[4, 4, 0, 0]} opacity={0.85} />
                <Bar dataKey="cogs" name="COGS" fill="#e8a830" radius={[4, 4, 0, 0]} opacity={0.85} />
                <Line
                  dataKey="grossProfit"
                  name={t("Вал. прибыль", "Yalpi foyda")}
                  stroke="#34c473"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: "#34c473", stroke: COLORS.surface, strokeWidth: 2 }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  dataKey="netProfit"
                  name={t("Чист. прибыль", "Toza foyda")}
                  stroke="#c7c9f8"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={{ r: 3, fill: "#c7c9f8", stroke: COLORS.surface, strokeWidth: 2 }}
                />
                <ReferenceLine y={0} stroke={COLORS.border} strokeDasharray="3 3" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Products with COGS */}
      <div className="neo-card" style={{ padding: "24px" }}>
        <h2 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 600, color: COLORS.textPrimary, margin: "0 0 16px" }}>
          {lang === "uz" ? "Mahsulotlar bo'yicha foyda" : "Прибыль по товарам"}
        </h2>
        {!cogsByProduct.data || cogsByProduct.data.length === 0 ? (
          <p style={{ color: COLORS.textSecondary, fontSize: "13px", textAlign: "center", padding: "32px 0" }}>
            {lang === "uz" ? "Ma'lumot yo'q" : "Нет данных за период"}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{lang === "uz" ? "Mahsulot" : "Товар"}</th>
                  <th style={thStyle}>{lang === "uz" ? "Hajm" : "Объём"}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{lang === "uz" ? "Daromad" : "Выручка"}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{lang === "uz" ? "COGS" : "Себестоимость"}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{lang === "uz" ? "Foyda" : "Прибыль"}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{lang === "uz" ? "Marja" : "Маржа"}</th>
                </tr>
              </thead>
              <tbody>
                {cogsByProduct.data.map((p, i) => {
                  const revenue = Number(p.totalRevenue);
                  const cost = Number(p.totalCost);
                  const profit = revenue - cost;
                  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
                  return (
                    <tr key={i} style={{ transition: "background 0.15s" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(75,108,246,0.02)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <td style={tdStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <Package size={14} style={{ color: COLORS.primary, flexShrink: 0 }} />
                          <span style={{ fontSize: "13px", fontWeight: 500 }}>{p.productName}</span>
                        </div>
                      </td>
                      <td style={{ ...tdStyle, color: COLORS.textSecondary }}>{Number(p.totalQty).toFixed(0)} кг</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>{fmt(revenue.toFixed(0))}</td>
                      <td style={{ ...tdStyle, textAlign: "right", color: "#e85050" }}>{fmt(cost.toFixed(0))}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: profit >= 0 ? "#34c473" : "#e85050" }}>
                        {fmt(profit.toFixed(0))}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <span style={{
                          display: "inline-block", padding: "2px 8px", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
                          background: margin >= 20 ? "rgba(74,222,128,0.1)" : margin >= 10 ? "rgba(251,191,36,0.1)" : "rgba(232,80,80,0.1)",
                          color: margin >= 20 ? "#34c473" : margin >= 10 ? "#e8a830" : "#e85050",
                        }}>
                          {margin.toFixed(0)}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Transport Expenses */}
      <div className="neo-card" style={{ padding: "24px" }}>
        <h2 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 600, color: COLORS.textPrimary, margin: "0 0 16px" }}>
          {lang === "uz" ? "Transport xarajatlari" : "Расходы на транспорт"}
        </h2>
        {(Array.isArray(arrivals?.data) ? arrivals.data : []).filter(a => a.status === "completed").length === 0 ? (
          <p style={{ color: COLORS.textSecondary, fontSize: "13px", textAlign: "center", padding: "32px 0" }}>
            {lang === "uz" ? "Ma'lumot yo'q" : "Нет завершённых приходов за период"}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{lang === "uz" ? "Kirim" : "Приход"}</th>
                  <th style={thStyle}>{lang === "uz" ? "Sana" : "Дата"}</th>
                  <th style={thStyle}>{lang === "uz" ? "Mashina" : "Машина"}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{lang === "uz" ? "Yoqilg'i" : "Топливо"}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{lang === "uz" ? "Yo'l" : "Дорога"}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{lang === "uz" ? "Jami" : "Итого"}</th>
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(arrivals?.data) ? arrivals.data : [])
                  .filter(a => a.status === "completed")
                  .slice(0, 20)
                  .map(a => (
                    <tr key={a.id} style={{ transition: "background 0.15s" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(75,108,246,0.02)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <td style={{ ...tdStyle, fontWeight: 500 }}>{a.arrivalNumber}</td>
                      <td style={{ ...tdStyle, color: COLORS.textSecondary }}>
                        {a.arrivalDate ? format(new Date(a.arrivalDate), "dd.MM.yyyy") : "—"}
                      </td>
                      <td style={{ ...tdStyle, color: COLORS.textSecondary }}>{a.truckId ?? "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmt(a.fuelCost)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmt(a.tollCost)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#e85050" }}>{fmt(a.totalExpense)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
