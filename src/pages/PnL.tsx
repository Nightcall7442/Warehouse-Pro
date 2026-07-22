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
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "Warehouse Pro";
    wb.created = new Date();

    const num = (v: unknown) => Number(v ?? 0);
    const fmtMoney = (n: number) => n.toLocaleString("ru-RU");

    // ── Sheet 1: Сводка P&L ──────────────────────────────────────────────
    const ws1 = wb.addWorksheet("Сводка P&L", { properties: { defaultColWidth: 22 } });

    // Title
    ws1.mergeCells("A1:C1");
    const titleCell = ws1.getCell("A1");
    titleCell.value = `P&L Отчёт: ${from} — ${to}`;
    titleCell.font = { bold: true, size: 16, color: { argb: "FF1E293B" } };
    titleCell.alignment = { horizontal: "left" };

    ws1.mergeCells("A2:C2");
    ws1.getCell("A2").value = `Сформирован: ${new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })}`;
    ws1.getCell("A2").font = { size: 10, color: { argb: "FF64748B" } };

    ws1.addRow([]);

    // Header
    const h1 = ws1.addRow(["Показатель", "Сумма", "Маржа %"]);
    h1.eachCell(c => {
      c.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
      c.border = { bottom: { style: "medium", color: { argb: "FF1E293B" } } };
      c.alignment = { horizontal: "center", vertical: "middle" };
    });
    h1.height = 28;

    const addRow = (label: string, value: number, margin?: number, bold?: boolean, highlight?: string) => {
      const row = ws1.addRow([label, fmtMoney(value), margin != null ? `${margin.toFixed(1)}%` : ""]);
      row.getCell(2).numFmt = "#,##0";
      row.getCell(2).alignment = { horizontal: "right" };
      row.getCell(3).alignment = { horizontal: "right" };
      if (bold) row.eachCell(c => { c.font = { bold: true, size: 11 }; });
      if (highlight) row.getCell(2).font = { bold: true, color: { argb: highlight } };
      row.eachCell(c => { c.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      }; });
      return row;
    };

    addRow("Выручка", num(current?.revenue), null, true);
    addRow("Скидки", num(current?.discount));
    addRow("Себестоимость (COGS)", num(current?.cogs));
    const gpRow = addRow("Валовая прибыль", num(current?.grossProfit), num(current?.grossMarginPct), true, "FF16A34A");

    ws1.addRow([]);
    addRow("Расходы на доставку", num(current?.operatingExpenses));
    const npRow = addRow("Чистая прибыль", num(current?.netProfit), num(current?.netMarginPct), true, num(current?.netProfit) >= 0 ? "FF16A34A" : "FFDC2626");

    ws1.addRow([]);
    addRow("Заказов", num(current?.orderCount));

    ws1.getColumn(1).width = 30;
    ws1.getColumn(2).width = 22;
    ws1.getColumn(3).width = 14;

    // ── Sheet 2: По товарам ──────────────────────────────────────────────
    if (cogsByProduct.data && cogsByProduct.data.length > 0) {
      const ws2 = wb.addWorksheet("По товарам");

      ws2.mergeCells("A1:F1");
      ws2.getCell("A1").value = "Разбивка по товарам";
      ws2.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF1E293B" } };

      ws2.addRow([]);
      const h2 = ws2.addRow(["Товар", "Объём", "Выручка", "Себестоимость", "Прибыль", "Маржа %"]);
      h2.eachCell(c => {
        c.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
        c.alignment = { horizontal: "center", vertical: "middle" };
        c.border = { bottom: { style: "medium", color: { argb: "FF4F46E5" } } };
      });
      h2.height = 26;

      let totalRev = 0, totalCost = 0;
      cogsByProduct.data.forEach((p, i) => {
        const rev = Number(p.totalRevenue ?? 0);
        const cost = Number(p.totalCost ?? 0);
        const profit = rev - cost;
        const margin = rev > 0 ? (profit / rev) * 100 : 0;
        totalRev += rev; totalCost += cost;
        const row = ws2.addRow([p.productName, Number(p.totalQty ?? 0), rev, cost, profit, `${margin.toFixed(1)}%`]);
        row.getCell(2).numFmt = "#,##0";
        [3, 4, 5].forEach(c => row.getCell(c).numFmt = "#,##0");
        row.getCell(6).alignment = { horizontal: "right" };
        const bg = i % 2 === 0 ? "FFF8FAFC" : "FFFFFFFF";
        row.eachCell(c => {
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
          c.border = {
            top: { style: "thin", color: { argb: "FFD1D5DB" } },
            bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
            left: { style: "thin", color: { argb: "FFD1D5DB" } },
            right: { style: "thin", color: { argb: "FFD1D5DB" } },
          };
        });
      });

      // Totals
      ws2.addRow([]);
      const totalRow = ws2.addRow(["ИТОГО", "", totalRev, totalCost, totalRev - totalCost, totalRev > 0 ? `${((totalRev - totalCost) / totalRev * 100).toFixed(1)}%` : "0%"]);
      totalRow.eachCell(c => {
        c.font = { bold: true, size: 11 };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E7FF" } };
        c.border = { top: { style: "medium", color: { argb: "FF4F46E5" } } };
      });
      [3, 4, 5].forEach(c => totalRow.getCell(c).numFmt = "#,##0");

      ws2.getColumn(1).width = 35;
      ws2.getColumn(2).width = 12;
      ws2.getColumn(3).width = 18;
      ws2.getColumn(4).width = 18;
      ws2.getColumn(5).width = 18;
      ws2.getColumn(6).width = 12;
    }

    // ── Sheet 3: По методам оплаты ───────────────────────────────────────
    if (paymentBreakdown.data && paymentBreakdown.data.length > 0) {
      const ws3 = wb.addWorksheet("По методам оплаты");

      ws3.mergeCells("A1:F1");
      ws3.getCell("A1").value = "Выручка по методам оплаты";
      ws3.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF1E293B" } };

      ws3.addRow([]);
      const h3 = ws3.addRow(["Метод оплаты", "Выручка", "Себестоимость", "Прибыль", "Маржа %", "Заказов"]);
      h3.eachCell(c => {
        c.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
        c.alignment = { horizontal: "center", vertical: "middle" };
      });
      h3.height = 26;

      paymentBreakdown.data.forEach((row, i) => {
        const label = PAYMENT_LABELS[row.paymentMethod]?.ru ?? row.paymentMethod;
        const r = ws3.addRow([label, num(row.revenue), num(row.cogs), num(row.grossProfit), `${num(row.grossMarginPct).toFixed(1)}%`, row.orderCount ?? 0]);
        [2, 3, 4].forEach(c => r.getCell(c).numFmt = "#,##0");
        const bg = i % 2 === 0 ? "FFF8FAFC" : "FFFFFFFF";
        r.eachCell(c => {
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
          c.border = {
            top: { style: "thin", color: { argb: "FFD1D5DB" } },
            bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
            left: { style: "thin", color: { argb: "FFD1D5DB" } },
            right: { style: "thin", color: { argb: "FFD1D5DB" } },
          };
        });
      });

      ws3.getColumn(1).width = 22;
      ws3.getColumn(2).width = 18;
      ws3.getColumn(3).width = 18;
      ws3.getColumn(4).width = 18;
      ws3.getColumn(5).width = 12;
      ws3.getColumn(6).width = 12;
    }

    // ── Sheet 4: Сравнение периодов ──────────────────────────────────────
    if (data?.previous) {
      const ws4 = wb.addWorksheet("Сравнение периодов");

      ws4.mergeCells("A1:D1");
      ws4.getCell("A1").value = "Сравнение с предыдущим периодом";
      ws4.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF1E293B" } };

      ws4.addRow([]);
      const h4 = ws4.addRow(["Показатель", "Текущий", "Прошлый", "Изменение"]);
      h4.eachCell(c => {
        c.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
        c.alignment = { horizontal: "center", vertical: "middle" };
      });
      h4.height = 26;

      const comparisons: Array<[string, number, number]> = [
        ["Выручка", num(current?.revenue), num(data.previous.revenue)],
        ["COGS", num(current?.cogs), num(data.previous.cogs)],
        ["Валовая прибыль", num(current?.grossProfit), num(data.previous.grossProfit)],
        ["Чистая прибыль", num(current?.netProfit), num(data.previous.netProfit)],
      ];
      comparisons.forEach(([label, curr, prev], i) => {
        const delta = prev > 0 ? ((curr - prev) / prev * 100) : 0;
        const r = ws4.addRow([label, curr, prev, `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`]);
        [2, 3].forEach(c => r.getCell(c).numFmt = "#,##0");
        r.getCell(4).alignment = { horizontal: "right" };
        r.getCell(4).font = { color: { argb: delta >= 0 ? "FF16A34A" : "FFDC2626" } };
        const bg = i % 2 === 0 ? "FFF8FAFC" : "FFFFFFFF";
        r.eachCell(c => {
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
          c.border = {
            top: { style: "thin", color: { argb: "FFD1D5DB" } },
            bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
            left: { style: "thin", color: { argb: "FFD1D5DB" } },
            right: { style: "thin", color: { argb: "FFD1D5DB" } },
          };
        });
      });

      ws4.getColumn(1).width = 22;
      ws4.getColumn(2).width = 18;
      ws4.getColumn(3).width = 18;
      ws4.getColumn(4).width = 14;
    }

    // Download
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `PnL-${from}-${to}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
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
