import { useCallback, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { format, subDays } from "date-fns";
import { FileDown, Printer, LayoutDashboard, ShoppingCart, Award, Users } from "lucide-react";
import { exportToExcel } from "@/lib/excel";
import { exportToPDF } from "@/lib/export";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { F, COLORS, PAYMENT_MAP, type TabKey } from "@/components/reports/report-constants";
import { PeriodPicker } from "@/components/reports/ReportCharts";
import { OverviewTab } from "@/components/reports/OverviewTab";
import { SalesTab } from "@/components/reports/SalesTab";
import { AgentsTab } from "@/components/reports/AgentsTab";
import { AgentProductsTab } from "@/components/reports/AgentProductsTab";

export default function Reports() {
  const [tab, setTab] = useState<TabKey>("overview");
  const [days, setDays] = useState(30);
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const t = useCallback((ru: string, uz: string) => lang === "uz" ? uz : ru, [lang]);

  const from = format(subDays(new Date(), days), "yyyy-MM-dd");
  const to = format(new Date(), "yyyy-MM-dd");

  const [apDateFrom, setApDateFrom] = useState(from);
  const [apDateTo, setApDateTo] = useState(to);

  const { data: summary, isLoading: summaryLoading, isError, refetch } = trpc.reports.getDashboardSummary.useQuery();
  const { data: chart } = trpc.reports.getVisitChart.useQuery({ days });
  const { data: plans } = trpc.reports.getPlanCompletion.useQuery();
  const { data: byShop } = trpc.analytics.salesByShop.useQuery({ dateFrom: from, dateTo: to });
  const { data: topProds } = trpc.analytics.topProducts.useQuery({ dateFrom: from, dateTo: to });
  const { data: agents } = trpc.reports.getAgentPerformance.useQuery({ days });
  const { data: byPayment } = trpc.analytics.pnlByPaymentMethod.useQuery({ from, to });
  const { data: agentProducts, isLoading: agentProductsLoading } = trpc.analytics.agentProductSales.useQuery(
    { dateFrom: apDateFrom, dateTo: apDateTo },
    { enabled: tab === "agentProducts" },
  );

  const shopChartData = (byShop ?? []).map(s => ({
    name: (s.shopName ?? "—").slice(0, 14), revenue: Number(s.revenue), fullName: s.shopName ?? "—",
  }));

  const totalRevenue = topProds?.reduce((s, p) => s + Number(p.totalRevenue), 0) ?? 0;

  const TABS = [
    { key: "overview" as const, ru: "Обзор", uz: "Umumiy", icon: <LayoutDashboard size={16} /> },
    { key: "sales" as const, ru: "Продажи", uz: "Sotuvlar", icon: <ShoppingCart size={16} /> },
    { key: "agents" as const, ru: "Агенты", uz: "Agentlar", icon: <Award size={16} /> },
    { key: "agentProducts" as const, ru: "Агент × Товар", uz: "Agent × Mahsulot", icon: <Users size={16} /> },
  ];

  const handleExportAgentProducts = async () => {
    if (!agentProducts || agentProducts.length === 0) return;
    const rows = agentProducts
      .slice()
      .sort((a, b) => (a.agentName ?? "").localeCompare(b.agentName ?? "") || Number(b.totalRevenue) - Number(a.totalRevenue))
      .map(r => ({
        Агент: r.agentName ?? t("Не назначен", "Tayinlanmagan"),
        Товар: r.productName ?? "—",
        Код: r.productCode ?? "",
        "Кол-во": Number(r.totalQty ?? 0),
        Ед: r.unit ?? "",
        Заказов: Number(r.orderCount ?? 0),
        Сумма: Number(r.totalRevenue ?? 0).toFixed(2),
      }));
    await exportToExcel(
      rows,
      `agent-products-${apDateFrom}_${apDateTo}`,
      t("Агент-Товар", "Agent-Mahsulot"),
      `${t("Продажи по агентам и товарам", "Agent va mahsulot bo'yicha sotuvlar")} — ${apDateFrom} — ${apDateTo}`,
    );
  };

  const handleExport = async () => {
    const rows: Record<string, unknown>[] = [];

    if (summary) {
      rows.push({ Раздел: "📊 СВОДКА", Показатель: "Агентов", Значение: summary.totalAgents, "": "" });
      rows.push({ Раздел: "", Показатель: "Онлайн", Значение: summary.activeNow });
      rows.push({ Раздел: "", Показатель: "Визитов сегодня", Значение: summary.visitsToday });
      rows.push({ Раздел: "", Показатель: `Заказов за ${days}д`, Значение: summary.ordersMonth });
      rows.push({ Раздел: "", Показатель: `Выручка за ${days}д`, Значение: summary.revenueMonth });
    }

    if (byShop && byShop.length > 0) {
      rows.push({ Раздел: "🛒 ПРОДАЖИ ПО МАГАЗИНАМ", Показатель: "Магазин", Значение: "Выручка", "": "Заказов" });
      for (const s of byShop) {
        rows.push({ Раздел: "", Показатель: s.shopName ?? "—", Значение: Number(s.revenue ?? 0).toFixed(2), "": s.orderCount ?? 0 });
      }
    }

    if (topProds && topProds.length > 0) {
      rows.push({ Раздел: "📦 ТОП ТОВАРОВ", Показатель: "Товар", Значение: "Объём", "": "Выручка" });
      for (const p of topProds) {
        rows.push({ Раздел: "", Показатель: p.productName, Значение: Number(p.totalQty ?? 0).toFixed(0), "": Number(p.totalRevenue ?? 0).toFixed(2) });
      }
    }

    if (byPayment && byPayment.length > 0) {
      rows.push({ Раздел: "💳 МЕТОДЫ ОПЛАТЫ", Показатель: "Метод", Значение: "Выручка", "": "Заказов" });
      for (const p of byPayment) {
        const pm = PAYMENT_MAP[p.method] ?? { label: p.method };
        rows.push({ Раздел: "", Показатель: pm.label, Значение: Number(p.revenue ?? 0).toFixed(2), "": p.orderCount ?? 0 });
      }
    }

    if (agents && agents.length > 0) {
      rows.push({ Раздел: "👤 АГЕНТЫ", Показатель: "Агент", Значение: "Выручка", "": "Заказов" });
      for (const a of agents) {
        rows.push({ Раздел: "", Показатель: a.agentName ?? `Agent #${a.agentId}`, Значение: Number(a.revenue ?? 0).toFixed(2), "": Number(a.orders ?? 0) });
      }
    }

    if (rows.length === 0) return;
    await exportToExcel(rows, `report-${format(new Date(), "yyyy-MM-dd")}`, t("Отчёт", "Hisobot"), `${t("Сводный отчёт", "Yig'ma hisobot")} — ${format(new Date(), "dd.MM.yyyy")}`);
  };

  const handleExportPDF = () => {
    const fmtNum = (n: number) => n.toLocaleString("ru");
    let html = "";

    if (summary) {
      html += `<div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">Агентов</div><div class="kpi-value">${summary.totalAgents}</div></div>
        <div class="kpi"><div class="kpi-label">Визитов</div><div class="kpi-value">${summary.visitsToday}</div></div>
        <div class="kpi"><div class="kpi-label">Заказов</div><div class="kpi-value">${summary.ordersMonth}</div></div>
        <div class="kpi"><div class="kpi-label">Выручка</div><div class="kpi-value">${fmtNum(summary.revenueMonth)} сум</div></div>
      </div>`;
    }

    if (byShop && byShop.length > 0) {
      html += `<div class="section"><h2>Продажи по магазинам</h2>
        <table><thead><tr><th>Магазин</th><th class="right">Выручка</th><th class="right">Заказов</th></tr></thead><tbody>`;
      for (const s of byShop) {
        html += `<tr><td>${s.shopName ?? "—"}</td><td class="right">${fmtNum(Number(s.revenue ?? 0))}</td><td class="right">${s.orderCount ?? 0}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }

    if (topProds && topProds.length > 0) {
      html += `<div class="section"><h2>Топ товаров</h2>
        <table><thead><tr><th>Товар</th><th>Код</th><th class="right">Объём</th><th class="right">Выручка</th></tr></thead><tbody>`;
      for (const p of topProds) {
        html += `<tr><td>${p.productName}</td><td>${p.productCode ?? "—"}</td><td class="right">${Number(p.totalQty).toFixed(0)}</td><td class="right bold">${fmtNum(Number(p.totalRevenue))}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }

    if (byPayment && byPayment.length > 0) {
      html += `<div class="section"><h2>По методам оплаты</h2>
        <table><thead><tr><th>Метод</th><th class="right">Выручка</th><th class="right">Заказов</th></tr></thead><tbody>`;
      for (const p of byPayment) {
        const pm = PAYMENT_MAP[p.method] ?? { label: p.method };
        html += `<tr><td>${pm.label}</td><td class="right">${fmtNum(Number(p.revenue ?? 0))}</td><td class="right">${p.orderCount ?? 0}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }

    if (agents && agents.length > 0) {
      html += `<div class="section"><h2>Агенты</h2>
        <table><thead><tr><th>Агент</th><th class="right">Визиты</th><th class="right">Заказы</th><th class="right">Выручка</th></tr></thead><tbody>`;
      for (const a of agents) {
        html += `<tr><td>${a.agentName ?? `Agent #${a.agentId}`}</td><td class="right">${Number(a.visits)}</td><td class="right">${Number(a.orders)}</td><td class="right bold">${fmtNum(Number(a.revenue ?? 0))}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }

    exportToPDF(`${t("Сводный отчёт", "Yig'ma hisobot")} — ${format(new Date(), "dd.MM.yyyy")}`, html);
  };

  if (isError) return <QueryErrorFallback onRetry={refetch} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.025em", margin: 0 }}>
            {t("Отчёты", "Hisobotlar")}
          </h1>
          <p style={{ fontSize: "13px", color: COLORS.textSecondary, margin: "4px 0 0" }}>
            {format(new Date(), "dd MMMM yyyy")}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <PeriodPicker days={days} onChange={setDays} />
          <button onClick={handleExport} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
            fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
            border: "none", cursor: "pointer", background: COLORS.surfaceLight, color: COLORS.textSecondary,
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}>
            <FileDown size={14} /> Excel
          </button>
          <button onClick={handleExportPDF} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
            fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
            border: "none", cursor: "pointer", background: COLORS.surfaceLight, color: COLORS.textSecondary,
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}>
            <FileDown size={14} /> PDF
          </button>
          <button onClick={() => window.print()} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
            fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
            border: "none", cursor: "pointer", background: COLORS.surfaceLight, color: COLORS.textSecondary,
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}>
            <Printer size={14} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "inline-flex", background: COLORS.surfaceLight, borderRadius: "14px", padding: "4px", gap: "4px", alignSelf: "flex-start" }}>
        {TABS.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)} style={{
            display: "flex", alignItems: "center", gap: "8px", padding: "10px 20px",
            fontSize: "13px", fontWeight: 600, fontFamily: F.body, borderRadius: "10px",
            border: "none", cursor: "pointer", transition: "all 0.2s",
            background: tab === tb.key ? COLORS.surface : "transparent",
            color: tab === tb.key ? COLORS.textPrimary : COLORS.textSecondary,
            boxShadow: tab === tb.key ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
          }}>
            {tb.icon}
            {t(tb.ru, tb.uz)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && (
        <OverviewTab
          summary={summary}
          summaryLoading={summaryLoading}
          chart={chart}
          plans={plans}
          days={days}
          fmt={fmt}
          t={t}
        />
      )}

      {tab === "sales" && (
        <SalesTab
          shopChartData={shopChartData}
          byPayment={byPayment}
          topProds={topProds}
          totalRevenue={totalRevenue}
          fmt={fmt}
          t={t}
        />
      )}

      {tab === "agents" && (
        <AgentsTab
          agents={agents}
          days={days}
          fmt={fmt}
          t={t}
          onExport={handleExport}
          onExportPDF={handleExportPDF}
        />
      )}

      {tab === "agentProducts" && (
        <AgentProductsTab
          rows={agentProducts}
          isLoading={agentProductsLoading}
          dateFrom={apDateFrom}
          dateTo={apDateTo}
          onDateFromChange={setApDateFrom}
          onDateToChange={setApDateTo}
          fmt={fmt}
          t={t}
          onExport={handleExportAgentProducts}
        />
      )}
    </div>
  );
}
