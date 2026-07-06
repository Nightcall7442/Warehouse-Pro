import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import {
  BarChart3, TrendingUp, Package, Truck, RefreshCw,
  ArrowUpRight, ArrowDownRight, Minus, Layers,
  Download, FileSpreadsheet, FileText,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, LineChart, Line, PieChart, Pie, Cell,
} from "recharts";
import { exportToExcel, exportToPDF, buildExcelSheets, buildPDFHtml, type ReportData } from "@/lib/export";

const COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe", "#22c55e", "#f59e0b"];

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-panel p-3 text-xs" style={{ backdropFilter: "blur(16px)" }}>
      <p className="font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span style={{ color: "var(--color-text-secondary)" }}>{p.name}:</span>
          <span className="font-semibold" style={{ color: "var(--color-text-primary)" }}>
            {typeof p.value === "number" ? p.value.toLocaleString("ru") : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string | number; sub?: string; icon: any; color: string;
}) {
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-label" style={{ color: "var(--color-text-tertiary)" }}>{label}</span>
        <Icon size={15} style={{ color }} />
      </div>
      <div className="text-2xl font-bold font-data" style={{ color: "var(--color-text-primary)" }}>{value}</div>
      {sub && <p className="text-[11px] mt-1" style={{ color: "var(--color-text-tertiary)" }}>{sub}</p>}
    </div>
  );
}

export default function WarehouseReports() {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [days, setDays] = useState(30);

  const { data: byCategory, isLoading: catLoading } = trpc.warehouseReports.stockByCategory.useQuery();
  const { data: trends, isLoading: trendsLoading } = trpc.warehouseReports.movementTrends.useQuery({ days });
  const { data: topByValue, isLoading: topLoading } = trpc.warehouseReports.topByValue.useQuery({ limit: 10 });
  const { data: arrivalData, isLoading: arrivalLoading } = trpc.warehouseReports.arrivalCosts.useQuery({ days });
  const { data: turnoverData, isLoading: turnoverLoading } = trpc.warehouseReports.turnover.useQuery({ days });

  const isLoading = catLoading || trendsLoading || topLoading || arrivalLoading || turnoverLoading;

  // Summary stats
  const totalValue = byCategory?.reduce((s, c) => s + Number(c.totalValue ?? 0), 0) ?? 0;
  const totalRetail = byCategory?.reduce((s, c) => s + Number(c.totalRetail ?? 0), 0) ?? 0;
  const totalUnits = byCategory?.reduce((s, c) => s + Number(c.totalUnits ?? 0), 0) ?? 0;
  const lowStockTotal = byCategory?.reduce((s, c) => s + Number(c.lowStockCount ?? 0), 0) ?? 0;
  const margin = totalRetail - totalValue;

  // Pie chart data
  const pieData = byCategory?.map(c => ({
    name: c.category,
    value: Number(c.totalValue ?? 0),
  })).filter(d => d.value > 0) ?? [];

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-surface-light animate-pulse rounded" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-surface-light animate-pulse rounded-xl" />)}
        </div>
        <div className="h-72 bg-surface-light animate-pulse rounded-xl" />
      </div>
    );
  }

  // ── Export handlers ──────────────────────────────────────────────────────
  const handleExcelExport = () => {
    if (!byCategory || !topByValue || !turnoverData) return;
    const reportData: ReportData = {
      byCategory: byCategory.map(c => ({ ...c, totalProducts: Number(c.totalProducts), totalUnits: Number(c.totalUnits), totalValue: Number(c.totalValue), totalRetail: Number(c.totalRetail), lowStockCount: Number(c.lowStockCount) })),
      topByValue: topByValue.map(p => ({ ...p, currentStock: Number(p.currentStock), costValue: Number(p.costValue), retailValue: Number(p.retailValue), margin: Number(p.margin) })),
      turnover: turnoverData.map(p => ({ ...p, currentStock: Number(p.currentStock), soldQty: Number(p.soldQty), daysToSell: Number(p.daysToSell) })),
      arrivalSummary: arrivalData?.summary ? {
        totalArrivals: Number(arrivalData.summary.totalArrivals),
        totalFuelCost: Number(arrivalData.summary.totalFuelCost ?? 0),
        totalTollCost: Number(arrivalData.summary.totalTollCost ?? 0),
        totalOtherCost: Number(arrivalData.summary.totalOtherCost ?? 0),
        totalExpense: Number(arrivalData.summary.totalExpense ?? 0),
        totalUnits: Number(arrivalData.summary.totalUnits ?? 0),
      } : undefined,
      days,
    };
    exportToExcel(buildExcelSheets(reportData));
  };

  const handlePDFExport = () => {
    if (!byCategory || !topByValue || !turnoverData) return;
    const reportData: ReportData = {
      byCategory: byCategory.map(c => ({ ...c, totalProducts: Number(c.totalProducts), totalUnits: Number(c.totalUnits), totalValue: Number(c.totalValue), totalRetail: Number(c.totalRetail), lowStockCount: Number(c.lowStockCount) })),
      topByValue: topByValue.map(p => ({ ...p, currentStock: Number(p.currentStock), costValue: Number(p.costValue), retailValue: Number(p.retailValue), margin: Number(p.margin) })),
      turnover: turnoverData.map(p => ({ ...p, currentStock: Number(p.currentStock), soldQty: Number(p.soldQty), daysToSell: Number(p.daysToSell) })),
      arrivalSummary: arrivalData?.summary ? {
        totalArrivals: Number(arrivalData.summary.totalArrivals),
        totalFuelCost: Number(arrivalData.summary.totalFuelCost ?? 0),
        totalTollCost: Number(arrivalData.summary.totalTollCost ?? 0),
        totalOtherCost: Number(arrivalData.summary.totalOtherCost ?? 0),
        totalExpense: Number(arrivalData.summary.totalExpense ?? 0),
        totalUnits: Number(arrivalData.summary.totalUnits ?? 0),
      } : undefined,
      days,
    };
    exportToPDF(t("Отчёт по складу", "Ombor hisoboti"), buildPDFHtml(reportData));
  };

  return (
    <div className="space-y-5 animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-primary tracking-tight">
            {t("Отчёты по складу", "Ombor hisobotlari")}
          </h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
            {t("Аналитика остатков, движения и логистики", "Qoldiq, harakat va logistika tahlili")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="input-field text-xs py-1.5"
            style={{ minWidth: 100 }}
          >
            <option value={7}>{t("7 дней", "7 kun")}</option>
            <option value={14}>{t("14 дней", "14 kun")}</option>
            <option value={30}>{t("30 дней", "30 kun")}</option>
            <option value={90}>{t("90 дней", "90 kun")}</option>
          </select>
          <button
            onClick={handleExcelExport}
            disabled={isLoading}
            className="btn-secondary flex items-center gap-1.5 text-xs py-1.5 px-3"
            title="Excel"
          >
            <FileSpreadsheet size={14} />
            <span className="hidden sm:inline">Excel</span>
          </button>
          <button
            onClick={handlePDFExport}
            disabled={isLoading}
            className="btn-secondary flex items-center gap-1.5 text-xs py-1.5 px-3"
            title="PDF"
          >
            <FileText size={14} />
            <span className="hidden sm:inline">PDF</span>
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label={t("Общая стоимость", "Umumiy qiymat")} value={fmt(totalValue)} icon={Package} color="#6366f1" sub={t("по себестоимости", "xarajat bo'yicha")} />
        <StatCard label={t("Розничная", "Chakana")} value={fmt(totalRetail)} icon={TrendingUp} color="#22c55e" sub={t("по продаже", "sotish bo'yicha")} />
        <StatCard label={t("Маржа", "Marja")} value={fmt(margin)} icon={ArrowUpRight} color={margin >= 0 ? "#22c55e" : "#ef4444"} sub={`${((margin / (totalValue || 1)) * 100).toFixed(1)}%`} />
        <StatCard label={t("Единицы", "Birliklar")} value={totalUnits.toLocaleString("ru")} icon={Layers} color="#f59e0b" />
        <StatCard label={t("Низкие остатки", "Kam qoldiq")} value={lowStockTotal} icon={Minus} color={lowStockTotal > 0 ? "#ef4444" : "#22c55e"} sub={t("товаров ниже порога", "mahsulotlar chegaradan past)")} />
      </div>

      {/* Charts Row 1 */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Stock by category bar chart */}
        <div className="panel p-5">
          <h3 className="font-semibold text-sm mb-4" style={{ color: "var(--color-text-primary)" }}>
            {t("Остатки по категориям", "Kategoriyalar bo'yicha qoldiq")}
          </h3>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byCategory?.slice(0, 8)} layout="vertical" margin={{ left: 80, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "var(--color-text-tertiary)" }} />
                <YAxis dataKey="category" type="category" tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} width={75} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="totalValue" name={t("Стоимость", "Qiymat")} fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Category pie chart */}
        <div className="panel p-5">
          <h3 className="font-semibold text-sm mb-4" style={{ color: "var(--color-text-primary)" }}>
            {t("Доля категорий", "Kategoriya ulushi")}
          </h3>
          <div className="flex items-center gap-6">
            <div style={{ width: 200, height: 200, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-2">
              {pieData.slice(0, 5).map((d, i) => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded" style={{ background: COLORS[i % COLORS.length] }} />
                    <span style={{ color: "var(--color-text-secondary)" }}>{d.name}</span>
                  </div>
                  <span className="font-semibold" style={{ color: "var(--color-text-primary)" }}>
                    {fmt(d.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Movement trends */}
      <div className="panel p-5">
        <h3 className="font-semibold text-sm mb-4" style={{ color: "var(--color-text-primary)" }}>
          {t("Движение товаров", "Mahsulot harakati")} — {t(`за ${days} дней`, `${days} kun ichida`)}
        </h3>
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trends} margin={{ left: 0, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--color-text-tertiary)" }} />
              <YAxis tick={{ fontSize: 10, fill: "var(--color-text-tertiary)" }} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="inQty" name={t("Приход", "Kirish")} stroke="#22c55e" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="outQty" name={t("Расход", "Chiqish")} stroke="#ef4444" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Arrival costs */}
        <div className="panel p-5">
          <h3 className="font-semibold text-sm mb-4" style={{ color: "var(--color-text-primary)" }}>
            {t("Расходы на доставку", "Yetkazish xarajatlari")}
          </h3>
          {arrivalData?.summary ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl" style={{ background: "var(--color-surface-light)" }}>
                  <div className="text-[10px] font-label uppercase" style={{ color: "var(--color-text-tertiary)" }}>
                    {t("Приходы", "Kirimlar")}
                  </div>
                  <div className="text-xl font-bold mt-1">{Number(arrivalData.summary.totalArrivals)}</div>
                </div>
                <div className="p-3 rounded-xl" style={{ background: "var(--color-surface-light)" }}>
                  <div className="text-[10px] font-label uppercase" style={{ color: "var(--color-text-tertiary)" }}>
                    {t("Единицы", "Birliklar")}
                  </div>
                  <div className="text-xl font-bold mt-1">{Number(arrivalData.summary.totalUnits ?? 0).toLocaleString("ru")}</div>
                </div>
              </div>
              <div className="space-y-2">
                {[
                  { label: t("Топливо", "Yoqilg'i"), value: Number(arrivalData.summary.totalFuelCost ?? 0), color: "#f59e0b" },
                  { label: t("Платные дороги", "Pullik yo'llar"), value: Number(arrivalData.summary.totalTollCost ?? 0), color: "#6366f1" },
                  { label: t("Прочее", "Boshqa"), value: Number(arrivalData.summary.totalOtherCost ?? 0), color: "#a1a1aa" },
                ].map(c => (
                  <div key={c.label} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded" style={{ background: c.color }} />
                      <span style={{ color: "var(--color-text-secondary)" }}>{c.label}</span>
                    </div>
                    <span className="font-semibold">{fmt(c.value)}</span>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t" style={{ borderColor: "var(--color-border-subtle)" }}>
                <div className="flex items-center justify-between text-sm font-semibold">
                  <span style={{ color: "var(--color-text-primary)" }}>{t("Итого", "Jami")}</span>
                  <span>{fmt(Number(arrivalData.summary.totalExpense ?? 0))}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-center py-8" style={{ color: "var(--color-text-tertiary)" }}>
              {t("Нет данных за период", "Davr uchun ma'lumot yo'q")}
            </p>
          )}
        </div>

        {/* Top products by value */}
        <div className="panel p-5">
          <h3 className="font-semibold text-sm mb-4" style={{ color: "var(--color-text-primary)" }}>
            {t("Топ товаров по стоимости", "Qiymat bo'yicha TOP mahsulotlar")}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                  <th className="text-left py-2 font-label" style={{ color: "var(--color-text-tertiary)" }}>#</th>
                  <th className="text-left py-2 font-label" style={{ color: "var(--color-text-tertiary)" }}>{t("Товар", "Mahsulot")}</th>
                  <th className="text-right py-2 font-label" style={{ color: "var(--color-text-tertiary)" }}>{t("Остаток", "Qoldiq")}</th>
                  <th className="text-right py-2 font-label" style={{ color: "var(--color-text-tertiary)" }}>{t("Стоимость", "Qiymat")}</th>
                  <th className="text-right py-2 font-label" style={{ color: "var(--color-text-tertiary)" }}>{t("Маржа", "Marja")}</th>
                </tr>
              </thead>
              <tbody>
                {topByValue?.map((p, i) => (
                  <tr key={p.productId} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                    <td className="py-2 font-data" style={{ color: "var(--color-text-tertiary)" }}>{i + 1}</td>
                    <td className="py-2">
                      <div className="font-medium" style={{ color: "var(--color-text-primary)" }}>{p.productName ?? "—"}</div>
                      <div style={{ color: "var(--color-text-tertiary)" }}>{p.productCode ?? ""}</div>
                    </td>
                    <td className="py-2 text-right font-data">{Number(p.currentStock ?? 0).toLocaleString("ru")} {p.unit}</td>
                    <td className="py-2 text-right font-data font-semibold">{fmt(Number(p.costValue ?? 0))}</td>
                    <td className="py-2 text-right font-data" style={{ color: Number(p.margin ?? 0) >= 0 ? "var(--color-success)" : "var(--color-danger)" }}>
                      {fmt(Number(p.margin ?? 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Turnover */}
      <div className="panel p-5">
        <h3 className="font-semibold text-sm mb-4" style={{ color: "var(--color-text-primary)" }}>
          {t("Оборачиваемость", "Aylanma")} — {t(`за ${days} дней`, `${days} kun ichida`)}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                <th className="text-left py-2 font-label" style={{ color: "var(--color-text-tertiary)" }}>{t("Товар", "Mahsulot")}</th>
                <th className="text-right py-2 font-label" style={{ color: "var(--color-text-tertiary)" }}>{t("Остаток", "Qoldiq")}</th>
                <th className="text-right py-2 font-label" style={{ color: "var(--color-text-tertiary)" }}>{t("Продано", "Sotilgan")}</th>
                <th className="text-right py-2 font-label" style={{ color: "var(--color-text-tertiary)" }}>{t("Коэфф.", "Koeff.")}</th>
                <th className="text-right py-2 font-label" style={{ color: "var(--color-text-tertiary)" }}>{t("Дней до продажи", "Sotishgacha kun")}</th>
              </tr>
            </thead>
            <tbody>
              {turnoverData?.map((p) => {
                const rate = Number(p.turnoverRate);
                const color = rate >= 2 ? "var(--color-success)" : rate >= 1 ? "var(--color-warning)" : "var(--color-text-secondary)";
                return (
                  <tr key={p.productId} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                    <td className="py-2">
                      <div className="font-medium" style={{ color: "var(--color-text-primary)" }}>{p.productName ?? "—"}</div>
                      <div style={{ color: "var(--color-text-tertiary)" }}>{p.productCode ?? ""}</div>
                    </td>
                    <td className="py-2 text-right font-data">{Number(p.currentStock ?? 0).toLocaleString("ru")}</td>
                    <td className="py-2 text-right font-data font-semibold">{Number(p.soldQty).toLocaleString("ru")}</td>
                    <td className="py-2 text-right font-data font-bold" style={{ color }}>{p.turnoverRate}x</td>
                    <td className="py-2 text-right font-data" style={{ color: p.daysToSell < 7 ? "var(--color-danger)" : p.daysToSell < 14 ? "var(--color-warning)" : "var(--color-text-secondary)" }}>
                      {p.daysToSell < 999 ? p.daysToSell : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
