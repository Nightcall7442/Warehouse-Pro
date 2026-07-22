import { useState, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { exportToExcel } from "@/lib/excel";
import { exportToPDF } from "@/lib/export";
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
    const fmtNum = (n: number) => n.toLocaleString("ru");
    let html = "";

    // KPIs
    html += `<div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Выручка</div><div class="kpi-value">${fmtNum(current?.revenue ?? 0)} сум</div></div>
      <div class="kpi"><div class="kpi-label">COGS</div><div class="kpi-value">${fmtNum(current?.cogs ?? 0)} сум</div></div>
      <div class="kpi"><div class="kpi-label">Валовая прибыль</div><div class="kpi-value">${fmtNum(current?.grossProfit ?? 0)} сум</div></div>
      <div class="kpi"><div class="kpi-label">Чистая прибыль</div><div class="kpi-value">${fmtNum(current?.netProfit ?? 0)} сум</div></div>
    </div>`;

    // Summary table
    html += `<div class="section"><h2>Сводка P&L</h2>
      <table><thead><tr><th>Показатель</th><th class="right">Значение</th></tr></thead><tbody>
      <tr><td>Период</td><td class="right">${from} — ${to}</td></tr>
      <tr><td>Выручка</td><td class="right bold">${fmtNum(current?.revenue ?? 0)} сум</td></tr>
      <tr><td>Скидки</td><td class="right">${fmtNum(current?.discount ?? 0)} сум</td></tr>
      <tr><td>Себестоимость (COGS)</td><td class="right">${fmtNum(current?.cogs ?? 0)} сум</td></tr>
      <tr><td>Валовая прибыль</td><td class="right bold">${fmtNum(current?.grossProfit ?? 0)} сум</td></tr>
      <tr><td>Валовая маржа</td><td class="right">${(current?.grossMarginPct ?? 0).toFixed(1)}%</td></tr>
      <tr><td>Расходы на доставку</td><td class="right">${fmtNum(current?.operatingExpenses ?? 0)} сум</td></tr>
      <tr class="total"><td>Чистая прибыль</td><td class="right">${fmtNum(current?.netProfit ?? 0)} сум</td></tr>
      <tr><td>Чистая маржа</td><td class="right">${(current?.netMarginPct ?? 0).toFixed(1)}%</td></tr>
      <tr><td>Заказов</td><td class="right">${current?.orderCount ?? 0}</td></tr>
      </tbody></table></div>`;

    // Previous period comparison
    if (data?.previous) {
      html += `<div class="section"><h2>Сравнение с прошлым периодом</h2>
        <table><thead><tr><th>Показатель</th><th class="right">Текущий</th><th class="right">Прошлый</th><th class="right">Изменение</th></tr></thead><tbody>`;
      const rows: Array<[string, number, number]> = [
        ["Выручка", current?.revenue ?? 0, data.previous.revenue],
        ["COGS", current?.cogs ?? 0, data.previous.cogs],
        ["Валовая прибыль", current?.grossProfit ?? 0, data.previous.grossProfit],
        ["Чистая прибыль", current?.netProfit ?? 0, data.previous.netProfit],
      ];
      for (const [label, curr, prev] of rows) {
        const delta = prev > 0 ? ((curr - prev) / prev * 100).toFixed(1) : "—";
        html += `<tr><td>${label}</td><td class="right">${fmtNum(curr)}</td><td class="right">${fmtNum(prev)}</td><td class="right">${delta}%</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }

    // Products breakdown
    if (cogsByProduct.data && cogsByProduct.data.length > 0) {
      html += `<div class="section"><h2>Разбивка по товарам</h2>
        <table><thead><tr><th>Товар</th><th class="right">Объём</th><th class="right">Выручка</th><th class="right">Себестоимость</th><th class="right">Прибыль</th><th class="right">Маржа</th></tr></thead><tbody>`;
      for (const p of cogsByProduct.data) {
        const rev = Number(p.totalRevenue);
        const cost = Number(p.totalCost);
        const profit = rev - cost;
        const margin = rev > 0 ? (profit / rev * 100).toFixed(1) : "0";
        html += `<tr><td>${p.productName}</td><td class="right">${Number(p.totalQty).toFixed(0)}</td><td class="right">${fmtNum(rev)}</td><td class="right">${fmtNum(cost)}</td><td class="right bold">${fmtNum(profit)}</td><td class="right">${margin}%</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }

    // Payment methods
    if (paymentBreakdown.data && paymentBreakdown.data.length > 0) {
      html += `<div class="section"><h2>По методам оплаты</h2>
        <table><thead><tr><th>Метод</th><th class="right">Выручка</th><th class="right">COGS</th><th class="right">Прибыль</th><th class="right">Маржа</th><th class="right">Заказов</th></tr></thead><tbody>`;
      for (const row of paymentBreakdown.data) {
        const label = PAYMENT_LABELS[row.paymentMethod]?.ru ?? row.paymentMethod;
        html += `<tr><td>${label}</td><td class="right">${fmtNum(row.revenue)}</td><td class="right">${fmtNum(row.cogs)}</td><td class="right bold">${fmtNum(row.grossProfit)}</td><td class="right">${row.grossMarginPct.toFixed(1)}%</td><td class="right">${row.orderCount}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }

    exportToPDF(`P&L Отчёт: ${from} — ${to}`, html);
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
