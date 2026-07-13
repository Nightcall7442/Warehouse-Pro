import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { BarChart3, TrendingUp, Package, Truck, Layers, AlertTriangle, FileDown, FileText, ArrowUpRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import { exportToExcel, exportToPDF, buildExcelSheets, buildPDFHtml, type ReportData } from "@/lib/export";
import { CardDots, Card, KpiCard, PageHeader, SectionTitle, btnSecondary } from "@/components/DashboardLayout";

const COLORS = ["var(--color-primary, #818cf8)", "var(--color-success, #4ade80)", "var(--color-warning, #fbbf24)", "var(--color-danger, #f87171)", "var(--color-info, #60a5fa)", "#a78bfa"];

export default function WarehouseReports() {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [days, setDays] = useState(30);

  const { data: byCategory, isLoading } = trpc.warehouseReports.stockByCategory.useQuery();
  const { data: trends } = trpc.warehouseReports.movementTrends.useQuery({ days });
  const { data: topByValue } = trpc.warehouseReports.topByValue.useQuery({ limit: 10 });
  const { data: arrivalData } = trpc.warehouseReports.arrivalCosts.useQuery({ days });
  const { data: turnoverData } = trpc.warehouseReports.turnover.useQuery({ days });

  const totalValue = byCategory?.reduce((s, c) => s + Number(c.totalValue ?? 0), 0) ?? 0;
  const totalRetail = byCategory?.reduce((s, c) => s + Number(c.totalRetail ?? 0), 0) ?? 0;
  const totalUnits = byCategory?.reduce((s, c) => s + Number(c.totalUnits ?? 0), 0) ?? 0;
  const lowStockTotal = byCategory?.reduce((s, c) => s + Number(c.lowStockCount ?? 0), 0) ?? 0;
  const margin = totalRetail - totalValue;

  const pieData = byCategory?.map(c => ({ name: c.category, value: Number(c.totalValue ?? 0) })).filter(d => d.value > 0) ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader
        title={t("Отчёты по складу", "Ombor hisobotlari")}
        subtitle={t("Аналитика остатков, движения и логистики", "Qoldiq, harakat va logistika tahlili")}
        actions={
          <>
            <select value={days} onChange={e => setDays(Number(e.target.value))} className="input-field" style={{ minWidth: 100, padding: "8px 12px", fontSize: "12px" }}>
              <option value={7}>{t("7 дней", "7 kun")}</option>
              <option value={30}>{t("30 дней", "30 kun")}</option>
              <option value={90}>{t("90 дней", "90 kun")}</option>
            </select>
            <button style={btnSecondary}><FileDown size={14} /> Excel</button>
          </>
        }
      />

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "16px" }}>
        <KpiCard label={t("ОБЩАЯ СТОИМОСТЬ", "UMUMIY QIYMAT")} value={fmt(totalValue)} icon={<Package size={18} color="#818cf8" />} gradient="rgba(129,140,248,.10)" />
        <KpiCard label={t("РОЗНИЧНАЯ", "CHAKANA")} value={fmt(totalRetail)} icon={<TrendingUp size={18} color="#4ade80" />} gradient="rgba(74,222,128,.10)" />
        <KpiCard label={t("МАРЖА", "MARJA")} value={fmt(margin)} icon={<ArrowUpRight size={18} color="#4ade80" />} gradient="rgba(74,222,128,.10)" />
        <KpiCard label={t("ЕДИНИЦЫ", "BIRLIXLAR")} value={totalUnits.toLocaleString("ru")} icon={<Layers size={18} color="#fbbf24" />} gradient="rgba(251,191,36,.10)" />
        <KpiCard label={t("НИЗКИЕ ОСТАТКИ", "KAM QOLDIQ")} value={String(lowStockTotal)} icon={<AlertTriangle size={18} color="#f87171" />} gradient="rgba(248,113,113,.10)" />
      </div>

      {/* Charts */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <Card>
          <SectionTitle title={t("Остатки по категориям", "Kategoriyalar bo'yicha qoldiq")} />
          <div style={{ height: 280, marginTop: "16px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byCategory?.slice(0, 8)} layout="vertical" margin={{ left: 80, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #f3f4f6)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "var(--color-text-tertiary, #9ca3af)" }} />
                <YAxis dataKey="category" type="category" tick={{ fontSize: 11, fill: "var(--color-text-secondary, #6b7280)" }} width={75} />
                <Tooltip contentStyle={{ background: "var(--color-surface, #ffffff)", border: "none", borderRadius: 12, boxShadow: "0 4px 12px rgba(0,0,0,.08)" }} />
                <Bar dataKey="totalValue" name={t("Стоимость", "Qiymat")} fill="var(--color-primary, #818cf8)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <SectionTitle title={t("Доля категорий", "Kategoriya ulushi")} />
          <div style={{ display: "flex", alignItems: "center", gap: "24px", marginTop: "16px" }}>
            <div style={{ width: 200, height: 200, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "var(--color-surface, #ffffff)", border: "none", borderRadius: 12, boxShadow: "0 4px 12px rgba(0,0,0,.08)" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
              {pieData.slice(0, 5).map((d, i) => (
                <div key={d.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "10px", height: "10px", borderRadius: "3px", background: COLORS[i % COLORS.length] }} />
                    <span style={{ color: "var(--color-text-secondary, #6b7280)" }}>{d.name}</span>
                  </div>
                  <span style={{ fontWeight: 600, color: "var(--color-text-primary, #111827)" }}>{fmt(d.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Movement Trends */}
      <Card>
        <SectionTitle title={`${t("Движение товаров", "Mahsulot harakati")} — ${t(`за ${days} дней`, `${days} kun ichida`)}`} />
        <div style={{ height: 280, marginTop: "16px" }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trends} margin={{ left: 0, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #f3f4f6)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--color-text-tertiary, #9ca3af)" }} />
              <YAxis tick={{ fontSize: 10, fill: "var(--color-text-tertiary, #9ca3af)" }} />
              <Tooltip contentStyle={{ background: "var(--color-surface, #ffffff)", border: "none", borderRadius: 12, boxShadow: "0 4px 12px rgba(0,0,0,.08)" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="inQty" name={t("Приход", "Kirish")} stroke="var(--color-success, #4ade80)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="outQty" name={t("Расход", "Chiqish")} stroke="var(--color-danger, #f87171)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
