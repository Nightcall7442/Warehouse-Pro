import { useState, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { exportToExcel } from "@/lib/excel";
import { subDays, format, subMonths, startOfYear } from "date-fns";
import { PAYMENT_LABELS } from "@/components/pnl/styles";
import {
  PnLPeriodSelector,
  PnLSummaryCards,
  PnLMarginRings,
  DateInput,
  PnLPaymentBreakdown,
  PnLPeriodComparison,
  PnLRevenueChart,
  PnLExpenseBreakdown,
  PnLTransportExpenses,
} from "@/components/pnl";
import type { Range } from "@/components/pnl";

const COLORS = {
  surface: "var(--color-surface, #ffffff)",
  surfaceLight: "var(--color-surface-light, #f0f3f8)",
  textTertiary: "var(--color-text-tertiary, #98a0b8)",
};
const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

export default function PnL() {
  const [range, setRange] = useState<Range>("30d");
  const [customFrom, setCustomFrom] = useState(() =>
    format(subDays(new Date(), 30), "yyyy-MM-dd")
  );
  const [customTo, setCustomTo] = useState(() =>
    format(new Date(), "yyyy-MM-dd")
  );
  const [showCustom, setShowCustom] = useState(false);
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);

  const { from, to } = useMemo(() => {
    const now = new Date();
    switch (range) {
      case "7d":
        return {
          from: format(subDays(now, 7), "yyyy-MM-dd"),
          to: format(now, "yyyy-MM-dd"),
        };
      case "30d":
        return {
          from: format(subDays(now, 30), "yyyy-MM-dd"),
          to: format(now, "yyyy-MM-dd"),
        };
      case "90d":
        return {
          from: format(subDays(now, 90), "yyyy-MM-dd"),
          to: format(now, "yyyy-MM-dd"),
        };
      case "12m":
        return {
          from: format(subMonths(now, 12), "yyyy-MM-dd"),
          to: format(now, "yyyy-MM-dd"),
        };
      case "ytd":
        return {
          from: format(startOfYear(now), "yyyy-MM-dd"),
          to: format(now, "yyyy-MM-dd"),
        };
      case "custom":
        return { from: customFrom, to: customTo };
      default:
        return {
          from: format(subDays(now, 30), "yyyy-MM-dd"),
          to: format(now, "yyyy-MM-dd"),
        };
    }
  }, [range, customFrom, customTo]);

  const { data, isLoading } = trpc.analytics.pnl.useQuery({
    from,
    to,
    compareWithPrev: true,
  });

  const cogsByProduct = trpc.analytics.cogsByProduct.useQuery({
    dateFrom: from,
    dateTo: to,
  });
  const arrivals = trpc.arrival.list.useQuery({ page: 1, pageSize: 1000 });
  const paymentBreakdown = trpc.analytics.pnlByPaymentMethod.useQuery({
    from,
    to,
  });
  const paymentTrend = trpc.analytics.paymentMethodTrend.useQuery({ from, to });

  const current = data?.current;
  const deltas = data?.deltas;
  const trend = data?.trend ?? [];

  const chartData = useMemo(() => {
    return trend.map((r) => ({
      month: r.month,
      revenue: r.revenue,
      cogs: r.cogs,
      grossProfit: r.grossProfit,
      netProfit: r.netProfit,
    }));
  }, [trend]);

  const handleRangeChange = (newRange: Range) => {
    setRange(newRange);
    setShowCustom(newRange === "custom");
  };

  const handleExportExcel = async () => {
    const rows: Record<string, unknown>[] = [
      { Показатель: "Период", Значение: `${from} — ${to}` },
      { Показатель: "Выручка", Сумма: (current?.revenue ?? 0).toFixed(0) },
      { Показатель: "Скидки", Сумма: (current?.discount ?? 0).toFixed(0) },
      {
        Показатель: "Себестоимость (COGS)",
        Сумма: (current?.cogs ?? 0).toFixed(0),
      },
      {
        Показатель: "Валовая прибыль",
        Сумма: (current?.grossProfit ?? 0).toFixed(0),
      },
      {
        Показатель: "Валовая маржа",
        Сумма: `${(current?.grossMarginPct ?? 0).toFixed(1)}%`,
      },
      {
        Показатель: "Расходы на доставку",
        Сумма: (current?.operatingExpenses ?? 0).toFixed(0),
      },
      {
        Показатель: "Чистая прибыль",
        Сумма: (current?.netProfit ?? 0).toFixed(0),
      },
      {
        Показатель: "Чистая маржа",
        Сумма: `${(current?.netMarginPct ?? 0).toFixed(1)}%`,
      },
      { Показатель: "Заказов", Сумма: current?.orderCount ?? 0 },
    ];
    if (data?.previous) {
      rows.push(
        { Показатель: "" },
        { Показатель: "--- ПРЕДЫДУЩИЙ ПЕРИОД ---" },
        {
          Показатель: "Выручка (прошл.)",
          Сумма: data.previous.revenue.toFixed(0),
        },
        {
          Показатель: "COGS (прошл.)",
          Сумма: data.previous.cogs.toFixed(0),
        },
        {
          Показатель: "Валовая прибыль (прошл.)",
          Сумма: data.previous.grossProfit.toFixed(0),
        },
        {
          Показатель: "Чистая прибыль (прошл.)",
          Сумма: data.previous.netProfit.toFixed(0),
        }
      );
    }
    if (cogsByProduct.data && cogsByProduct.data.length > 0) {
      rows.push(
        { Показатель: "" },
        { Показатель: "--- ПО ТОВАРАМ ---" }
      );
      cogsByProduct.data.forEach((p) => {
        const rev = Number(p.totalRevenue);
        const cost = Number(p.totalCost);
        const profit = rev - cost;
        const margin = rev > 0 ? (profit / rev) * 100 : 0;
        rows.push({
          Показатель: p.productName,
          Объём: Number(p.totalQty).toFixed(0),
          Выручка: rev.toFixed(0),
          Себестоимость: cost.toFixed(0),
          Прибыль: profit.toFixed(0),
          "Маржа %": `${margin.toFixed(0)}%`,
        });
      });
    }
    if (paymentBreakdown.data && paymentBreakdown.data.length > 0) {
      rows.push(
        { Показатель: "" },
        { Показатель: "--- ПО МЕТОДАМ ОПЛАТЫ ---" }
      );
      paymentBreakdown.data.forEach((row) => {
        const label = PAYMENT_LABELS[row.paymentMethod]?.ru ?? row.paymentMethod;
        rows.push({
          Показатель: label,
          Выручка: row.revenue.toFixed(0),
          Себестоимость: row.cogs.toFixed(0),
          Прибыль: row.grossProfit.toFixed(0),
          "Маржа %": `${row.grossMarginPct.toFixed(0)}%`,
          Заказов: row.orderCount,
        });
      });
    }
    await exportToExcel(rows, `pnl-${from}-${to}`);
  };

  const handleExportPDF = async () => {
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
        `Net Profit:        ${fmt(data.previous.netProfit)}`
      );
    }
    const blob = new Blob([content.join("\n")], {
      type: "text/plain;charset=utf-8",
    });
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                height: "28px",
                width: "240px",
                borderRadius: "8px",
                background: COLORS.surfaceLight,
                marginBottom: "8px",
              }}
            />
            <div
              style={{
                height: "16px",
                width: "300px",
                borderRadius: "6px",
                background: COLORS.surfaceLight,
              }}
            />
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "16px",
          }}
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{
                height: "140px",
                borderRadius: "20px",
                background: COLORS.surfaceLight,
                animation: `slideUp ${0.4 + i * 0.05}s ease forwards`,
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Header + Period Selector */}
      <PnLPeriodSelector
        range={range}
        onRangeChange={handleRangeChange}
        onExportExcel={handleExportExcel}
        onExportPDF={handleExportPDF}
        from={from}
        to={to}
        t={t}
        lang={lang}
      />

      {/* Custom Date Range */}
      {showCustom && (
        <div
          style={{
            background: COLORS.surface,
            borderRadius: "16px",
            padding: "16px 20px",
            boxShadow: SHADOW,
            display: "flex",
            alignItems: "flex-end",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          <DateInput
            value={customFrom}
            onChange={setCustomFrom}
            label={t("От", "Dan")}
          />
          <DateInput
            value={customTo}
            onChange={setCustomTo}
            label={t("До", "Gacha")}
          />
          <div
            style={{
              fontSize: "12px",
              color: COLORS.textTertiary,
              fontFamily: "'DM Sans', -apple-system, sans-serif",
              paddingBottom: "6px",
            }}
          >
            {t("Выберите период для анализа", "Tahlil uchun davrni tanlang")}
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <PnLSummaryCards current={current} deltas={deltas} fmt={fmt} t={t} />

      {/* Margin Rings + Stats */}
      <PnLMarginRings current={current} deltas={deltas} lang={lang} />

      {/* Payment Method Breakdown */}
      <PnLPaymentBreakdown
        paymentBreakdown={paymentBreakdown.data}
        paymentTrend={paymentTrend.data}
        fmt={fmt}
        t={t}
        lang={lang}
      />

      {/* Period Comparison */}
      {data?.previous && (
        <PnLPeriodComparison
          current={current}
          previous={data.previous}
          deltas={deltas}
          fmt={fmt}
          t={t}
        />
      )}

      {/* Monthly Trend Chart */}
      <PnLRevenueChart chartData={chartData} fmt={fmt} t={t} lang={lang} />

      {/* Products with COGS */}
      <PnLExpenseBreakdown
        cogsByProduct={cogsByProduct.data}
        fmt={fmt}
        lang={lang}
      />

      {/* Transport Expenses */}
      <PnLTransportExpenses
        arrivals={arrivals.data}
        fmt={fmt}
        lang={lang}
      />
    </div>
  );
}
