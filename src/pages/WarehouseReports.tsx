import { useState } from "react";
import { formatChartValue, truncateMiddle } from "@/lib/chart-value";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import {
  TrendingUp, Package,
  ArrowUpRight, ArrowDownRight, Minus, Layers,
  FileSpreadsheet, FileText,
  AlertTriangle,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, LineChart, Line, PieChart, Pie, Cell,
} from "recharts";
import { exportToExcel, exportToPDF, buildExcelSheets, buildPDFHtml, type ReportData } from "@/lib/export";
import { PremiumSelect } from "@/components/PremiumSelect";
import { SectionNotice } from "@/components/SectionNotice";
import { CHART_PALETTE } from "@/lib/chartTheme";
import { unitShort } from "@/lib/units";

/*
  Цвета долей берутся из общей палитры, а не собираются здесь.

  Стоял местный список из восьми значений, в котором «#c7c9f8» повторялось ТРИ
  раза подряд, а «--color-primary-subtle» — дважды. Круговая диаграмма делит
  склад по категориям, и три доли из восьми выходили одного цвета, ещё две —
  другого одинакового: единственное, ради чего эта диаграмма нужна, она и не
  делала. Плюс сам «#c7c9f8» — литерал, в тёмной теме он не меняется.

  CHART_PALETTE (lib/chartTheme) — десять опознавательных оттенков, объявленных
  в обеих темах и уже используемых на других экранах.
*/
const COLORS = CHART_PALETTE;

const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };
const THEME = {
  primary: "var(--color-primary)",
  // Accent-coloured *text* (a price, a code, a link). The fill colour above
  // is a hair under 4.5:1 as text on a light card, so semantic text uses
  // this darker sibling instead. See --color-primary-text in index.css.
  primaryText: "var(--color-primary-text)", success: "var(--color-success)",
  warning: "var(--color-warning)", danger: "var(--color-danger)",
  surface: "var(--color-surface, #efedea)", surfaceLight: "var(--color-surface-light, #f6f4f0)",
  textPrimary: "var(--color-text-primary, #2b2a28)", textSecondary: "var(--color-text-secondary, #5e5b54)",
  textTertiary: "var(--color-text-tertiary, #6b6760)", border: "var(--color-border, #d8d5cd)",
};
const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey?: string; name?: string; value?: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-panel p-3 text-xs" style={{ backdropFilter: "blur(16px)" }}>
      <p className="font-medium mb-1.5" style={{ color: THEME.textSecondary }}>{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span style={{ color: THEME.textSecondary }}>{p.name}:</span>
          <span className="font-semibold" style={{ color: THEME.textPrimary }}>
            {formatChartValue(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Подпись категории на оси: одна строка, лишнее — из середины.
 *
 * recharts зовёт этот компонент для каждой засечки и передаёт координаты и
 * само значение. Своя отрисовка нужна ровно ради двух вещей: не переносить
 * текст на несколько строк и сокращать его по середине.
 */
function CategoryTick(props: { x?: number; y?: number; payload?: { value?: string } }) {
  const { x = 0, y = 0, payload } = props;
  const text = String(payload?.value ?? "");
  return (
    <text
      x={x - 6}
      y={y}
      dy={4}
      textAnchor="end"
      style={{ fontSize: 10, fill: "var(--color-text-secondary, #5e5b54)" }}
    >
      {truncateMiddle(text, 26)}
    </text>
  );
}

function KpiCard({ label, value, delta, icon, gradient }: {
  label: string; value: string; delta?: number | null;
  icon: React.ReactNode; gradient: string; delay: number;
}) {
  const isPositive = delta !== null && delta !== undefined && delta > 0;
  const isNegative = delta !== null && delta !== undefined && delta < 0;
  return (
    <div className="kpi-hero" style={{
      padding: "22px",
      position: "relative", overflow: "hidden",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: THEME.textTertiary }}>
          {label}
        </span>
        <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {icon}
        </div>
      </div>
      <div style={{ fontFamily: F.display, fontSize: "28px", fontWeight: 700, color: THEME.textPrimary, lineHeight: 1, letterSpacing: "-0.03em" }}>
        {value}
      </div>
      {delta !== null && delta !== undefined && (
        <div style={{
          display: "flex", alignItems: "center", gap: "4px", marginTop: "10px",
          fontSize: "12px", fontWeight: 600, fontFamily: F.body,
          color: isPositive ? "var(--color-success-text)" : isNegative ? "var(--color-danger-text)" : THEME.textTertiary,
        }}>
          {isPositive ? <ArrowUpRight size={14} /> : isNegative ? <ArrowDownRight size={14} /> : <Minus size={14} />}
          {Math.abs(delta).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

function ChartPanel({ title, children, delay: _delay = 0 }: { title: string; children: React.ReactNode; delay?: number }) {
  return (
    <div style={{
      background: THEME.surface, borderRadius: "20px", padding: "24px",
      boxShadow: SHADOW, position: "relative", overflow: "hidden",
    }}>
      <h2 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 600, color: THEME.textPrimary, margin: "0 0 20px" }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

/**
 * Что показать в панели: данные, пустоту или отказ.
 *
 * Разделы этой страницы отличали только «есть данные» от «нет данных», а
 * `query.data` равен undefined в обоих случаях — и когда за период нечего
 * показать, и когда запрос упал. Человек читал «Нет данных за период» и делал
 * из этого вывод о складе, тогда как сервер просто не ответил.
 */
function PanelBody({ error, empty, onRetry, errorText, emptyText, children }: {
  error: boolean; empty: boolean; onRetry: () => void;
  errorText: string; emptyText: string; children: React.ReactNode;
}) {
  if (error) return <SectionNotice kind="error" message={errorText} onRetry={onRetry} />;
  if (empty) return <SectionNotice kind="empty" message={emptyText} />;
  return <>{children}</>;
}

export default function WarehouseReports() {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [days, setDays] = useState(30);

  /*
    Отказ каждого запроса разбирается отдельно.

    Здесь не проверялся НИ ОДИН из пяти. Упавший запрос отдаёт undefined, и
    итоги ниже считались от него: сумма по пустому массиву — ноль. Человек
    видел «Общая стоимость 0 сум» и «Низкие остатки 0» — то есть страница
    уверенно сообщала, что склад пуст и всё в порядке, тогда как сервер просто
    не ответил. Это не оформление, это неверный ответ на вопрос, ради которого
    страницу открыли.

    isLoadingError, а не isError: при обновлении уже показанных данных
    (переключили период) отказ не должен стирать то, что человек читает, —
    домашнее правило, закреплённое в refetch-error-keeps-data.test.ts.
  */
  const cat      = trpc.warehouseReports.stockByCategory.useQuery();
  const trendsQ  = trpc.warehouseReports.movementTrends.useQuery({ days });
  const topQ     = trpc.warehouseReports.topByValue.useQuery({ limit: 10 });
  const arrivalQ = trpc.warehouseReports.arrivalCosts.useQuery({ days });
  const turnQ    = trpc.warehouseReports.turnover.useQuery({ days });

  const byCategory   = cat.data;
  const trends       = trendsQ.data;
  const topByValue   = topQ.data;
  const arrivalData  = arrivalQ.data;
  const turnoverData = turnQ.data;

  // Выгрузки собирают все пять источников, поэтому кнопки ждут их все.
  const isLoading = cat.isLoading || trendsQ.isLoading || topQ.isLoading || arrivalQ.isLoading || turnQ.isLoading;

  // Summary stats
  const totalValue = byCategory?.reduce((s, c) => s + Number(c.totalValue ?? 0), 0) ?? 0;
  const totalRetail = byCategory?.reduce((s, c) => s + Number(c.totalRetail ?? 0), 0) ?? 0;
  const totalProducts = byCategory?.reduce((s, c) => s + Number(c.totalProducts ?? 0), 0) ?? 0;
  const lowStockTotal = byCategory?.reduce((s, c) => s + Number(c.lowStockCount ?? 0), 0) ?? 0;
  const margin = totalRetail - totalValue;

  // Pie chart data
  const pieData = byCategory?.map(c => ({
    name: c.category,
    value: Number(c.totalValue ?? 0),
  })).filter(d => d.value > 0) ?? [];

  /*
    Скелет ждёт только тот запрос, из которого собраны плитки наверху.

    Раньше он ждал ИЛИ по всем пяти: страница оставалась серой, пока не
    ответит самый медленный, — а «оборачиваемость» за девяносто дней считается
    заметно дольше остальных. Разделы ниже показывают своё состояние сами.
  */
  if (cat.isLoading) {
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
  const handleExcelExport = async () => {
    if (!byCategory || !topByValue || !turnoverData) return;
    const reportData: ReportData = {
      byCategory: byCategory.map(c => ({ ...c, totalProducts: Number(c.totalProducts), totalUnits: Number(c.totalUnits), totalValue: Number(c.totalValue), totalRetail: Number(c.totalRetail), lowStockCount: Number(c.lowStockCount) })),
      topByValue: topByValue.map(p => ({ ...p, productName: p.productName ?? "", productCode: p.productCode ?? "", unit: p.unit ?? "", currentStock: Number(p.currentStock), costValue: Number(p.costValue), retailValue: Number(p.retailValue), margin: Number(p.margin) })),
      turnover: turnoverData.map(p => ({ ...p, productName: p.productName ?? "", productCode: p.productCode ?? "", currentStock: Number(p.currentStock), soldQty: Number(p.soldQty), daysToSell: Number(p.daysToSell) })),
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
    await exportToExcel(buildExcelSheets(reportData));
  };

  const handlePDFExport = async () => {
    if (!byCategory || !topByValue || !turnoverData) return;
    const reportData: ReportData = {
      byCategory: byCategory.map(c => ({ ...c, totalProducts: Number(c.totalProducts), totalUnits: Number(c.totalUnits), totalValue: Number(c.totalValue), totalRetail: Number(c.totalRetail), lowStockCount: Number(c.lowStockCount) })),
      // product_id is a NOT NULL restricted FK, so the leftJoin never actually
      // misses — the ?? "" only fits the shape the report builders declare.
      topByValue: topByValue.map(p => ({ ...p, productName: p.productName ?? "", productCode: p.productCode ?? "", unit: p.unit ?? "", currentStock: Number(p.currentStock), costValue: Number(p.costValue), retailValue: Number(p.retailValue), margin: Number(p.margin) })),
      turnover: turnoverData.map(p => ({ ...p, productName: p.productName ?? "", productCode: p.productCode ?? "", currentStock: Number(p.currentStock), soldQty: Number(p.soldQty), daysToSell: Number(p.daysToSell) })),
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
          <h1 className="font-display text-2xl font-bold text-primary tracking-tight">
            {t("Отчёты по складу", "Ombor hisobotlari")}
          </h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary, #5e5b54)" }}>
            {t("Аналитика остатков, движения и логистики", "Qoldiq, harakat va logistika tahlili")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PremiumSelect
            value={String(days)}
            onChange={v => setDays(Number(v))}
            width="120px"
            aria-label={t("Период", "Davr")}
            options={[
              { value: "7",  label: t("7 дней", "7 kun") },
              { value: "14", label: t("14 дней", "14 kun") },
              { value: "30", label: t("30 дней", "30 kun") },
              { value: "90", label: t("90 дней", "90 kun") },
            ]}
          />
          <button
            onClick={handleExcelExport}
            disabled={isLoading}
            className="neo-btn flex items-center gap-1.5 text-xs py-1.5 px-3"
            title="Excel"
          >
            <FileSpreadsheet size={14} />
            <span className="hidden sm:inline">Excel</span>
          </button>
          <button
            onClick={handlePDFExport}
            disabled={isLoading}
            className="neo-btn flex items-center gap-1.5 text-xs py-1.5 px-3"
            title="PDF"
          >
            <FileText size={14} />
            <span className="hidden sm:inline">PDF</span>
          </button>
        </div>
      </div>

      {/*
        Плитки строятся из одного запроса — если он не ответил, показывать
        вместо них нули нельзя: «Общая стоимость 0» читается как «склад пуст»,
        а не как «сервер молчит».
      */}
      {cat.isLoadingError ? (
        <div className="neo-card-sm">
          <SectionNotice
            kind="error"
            message={t("Не удалось загрузить остатки по категориям", "Kategoriyalar bo'yicha qoldiqni yuklab bo'lmadi")}
            onRetry={() => cat.refetch()}
            retryLabel={t("Повторить", "Qayta urinish")}
          />
        </div>
      ) : (
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard label={t("Общая стоимость", "Umumiy qiymat")} value={fmt(totalValue)} icon={<Package size={20} color="#fff" />} gradient="linear-gradient(135deg, var(--kpi-indigo), var(--kpi-indigo))" delay={0} />
        <KpiCard label={t("Розничная", "Chakana")} value={fmt(totalRetail)} icon={<TrendingUp size={20} color="#fff" />} gradient="linear-gradient(135deg, var(--kpi-green), var(--kpi-green))" delay={0.1} />
        <KpiCard label={t("Маржа", "Marja")} value={fmt(margin)} delta={totalValue > 0 ? (margin / totalValue) * 100 : null} icon={<ArrowUpRight size={20} color="#fff" />} gradient={margin >= 0 ? "linear-gradient(135deg, var(--kpi-green), var(--kpi-green))" : "linear-gradient(135deg, var(--kpi-red), var(--kpi-red))"} delay={0.2} />
        {/*
          Здесь стояли «Единицы» — сумма totalUnits по всем категориям. Склад
          хранит штуки, ящики, литры и килограммы, и складывать их в одно число
          нельзя: «12 480» не значит ничего и ни на один вопрос не отвечает.

          Наименования складываются законно: это счёт карточек товара, и он
          отвечает на понятное «сколько у меня позиций». Разбивка по единицам
          осталась там, где она осмысленна, — в таблицах по товарам.
        */}
        <KpiCard label={t("Наименований", "Nomlar")} value={totalProducts.toLocaleString("ru")} icon={<Layers size={20} color="#fff" />} gradient="linear-gradient(135deg, var(--kpi-amber), var(--kpi-amber))" delay={0.3} />
        <KpiCard label={t("Низкие остатки", "Kam qoldiq")} value={String(lowStockTotal)} icon={<AlertTriangle size={20} color="#fff" />} gradient={lowStockTotal > 0 ? "linear-gradient(135deg, var(--kpi-red), var(--kpi-red))" : "linear-gradient(135deg, var(--kpi-green), var(--kpi-green))"} delay={0.4} />
      </div>
      )}

      {/* Charts Row 1 */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Stock by category bar chart */}
        <ChartPanel title={t("Остатки по категориям", "Kategoriyalar bo'yicha qoldiq")}>
          <PanelBody
            error={cat.isLoadingError}
            empty={!byCategory?.length}
            onRetry={() => cat.refetch()}
            errorText={t("Не удалось загрузить остатки", "Qoldiqni yuklab bo'lmadi")}
            emptyText={t("Категорий с остатком нет", "Qoldiqli kategoriyalar yo'q")}
          >
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byCategory?.slice(0, 8)} layout="vertical" margin={{ left: 8, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #d8d5cd)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "var(--color-text-tertiary, #6b6760)" }} />
                {/* Подписи категорий рисуются своим значком, а не готовым.
                    При width={75} и шрифте 11 длинное название переносилось на
                    три строки, строки соседних категорий налезали друг на
                    друга, и прочитать было нельзя ни одну.

                    Теперь строка одна, ширины больше, а лишнее убирается из
                    СЕРЕДИНЫ: названия здесь различаются хвостом — «(для
                    женщин)» и «(для мужчин)», — и обрезка с конца превратила
                    бы их в две одинаковые подписи. Полное название видно в
                    подсказке при наведении. */}
                <YAxis
                  dataKey="category"
                  type="category"
                  width={150}
                  tickLine={false}
                  tick={<CategoryTick />}
                />
                <Tooltip cursor={false} content={<ChartTooltip />} />
                <Bar dataKey="totalValue" name={t("Стоимость", "Qiymat")} fill="var(--color-primary)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          </PanelBody>
        </ChartPanel>

        {/* Category pie chart */}
        <ChartPanel title={t("Доля категорий", "Kategoriya ulushi")}>
          <PanelBody
            error={cat.isLoadingError}
            empty={pieData.length === 0}
            onRetry={() => cat.refetch()}
            errorText={t("Не удалось загрузить остатки", "Qoldiqni yuklab bo'lmadi")}
            emptyText={t("Нечего делить: остатков со стоимостью нет", "Bo'lish uchun qoldiq yo'q")}
          >
          <div className="flex items-center gap-6">
            <div style={{ width: 200, height: 200, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip cursor={false} content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-2">
              {pieData.slice(0, 5).map((d, i) => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded" style={{ background: COLORS[i % COLORS.length] }} />
                    <span style={{ color: "var(--color-text-secondary, #5e5b54)" }}>{d.name}</span>
                  </div>
                  <span className="font-semibold" style={{ color: "var(--color-text-primary, #2b2a28)" }}>
                    {fmt(d.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
          </PanelBody>
        </ChartPanel>
      </div>

      {/* Movement trends */}
      <ChartPanel title={`${t("Движение товаров", "Mahsulot harakati")} — ${t(`за ${days} дней`, `${days} kun ichida`)}`}>
        <PanelBody
          error={trendsQ.isLoadingError}
          empty={!trends?.length}
          onRetry={() => trendsQ.refetch()}
          errorText={t("Не удалось загрузить движение товаров", "Mahsulot harakatini yuklab bo'lmadi")}
          emptyText={t("За период движений не было", "Davr ichida harakat bo'lmagan")}
        >
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trends} margin={{ left: 0, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #d8d5cd)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--color-text-tertiary, #6b6760)" }} />
              <YAxis tick={{ fontSize: 10, fill: "var(--color-text-tertiary, #6b6760)" }} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="inQty" name={t("Приход", "Kirish")} stroke="var(--color-success)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="outQty" name={t("Расход", "Chiqish")} stroke="var(--color-danger)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        </PanelBody>
      </ChartPanel>

      {/* Charts Row 2 */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Arrival costs */}
        <ChartPanel title={t("Расходы на доставку", "Yetkazish xarajatlari")}>
          {arrivalData?.summary ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl" style={{ background: "var(--color-surface-light, #f6f4f0)" }}>
                  <div className="text-[10px] font-label uppercase" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>
                    {t("Приходы", "Kirimlar")}
                  </div>
                  <div className="text-xl font-bold mt-1">{Number(arrivalData.summary.totalArrivals)}</div>
                </div>
                <div className="p-3 rounded-xl" style={{ background: "var(--color-surface-light, #f6f4f0)" }}>
                  <div className="text-[10px] font-label uppercase" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>
                    {t("Единицы", "Birliklar")}
                  </div>
                  <div className="text-xl font-bold mt-1">{Number(arrivalData.summary.totalUnits ?? 0).toLocaleString("ru")}</div>
                </div>
              </div>
              <div className="space-y-2">
                {[
                  { label: t("Топливо", "Yoqilg'i"), value: Number(arrivalData.summary.totalFuelCost ?? 0), color: "var(--color-warning-text)" },
                  { label: t("Платные дороги", "Pullik yo'llar"), value: Number(arrivalData.summary.totalTollCost ?? 0), color: "var(--color-primary-text)" },
                  { label: t("Прочее", "Boshqa"), value: Number(arrivalData.summary.totalOtherCost ?? 0), color: "var(--color-text-tertiary, #6b6760)" },
                ].map(c => (
                  <div key={c.label} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded" style={{ background: c.color }} />
                      <span style={{ color: "var(--color-text-secondary, #5e5b54)" }}>{c.label}</span>
                    </div>
                    <span className="font-semibold">{fmt(c.value)}</span>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t" style={{ borderColor: "var(--color-border, #d8d5cd)" }}>
                <div className="flex items-center justify-between text-sm font-semibold">
                  <span style={{ color: "var(--color-text-primary, #2b2a28)" }}>{t("Итого", "Jami")}</span>
                  <span>{fmt(Number(arrivalData.summary.totalExpense ?? 0))}</span>
                </div>
              </div>
            </div>
          ) : (
            <SectionNotice
              kind={arrivalQ.isLoadingError ? "error" : "empty"}
              message={arrivalQ.isLoadingError
                ? t("Не удалось загрузить расходы на доставку", "Yetkazish xarajatlarini yuklab bo'lmadi")
                : t("За период приходов не было", "Davr ichida kirim bo'lmagan")}
              onRetry={() => arrivalQ.refetch()}
              retryLabel={t("Повторить", "Qayta urinish")}
            />
          )}
        </ChartPanel>

        {/* Top products by value */}
        <ChartPanel title={t("Топ товаров по стоимости", "Qiymat bo'yicha TOP mahsulotlar")}>
          <PanelBody
            error={topQ.isLoadingError}
            empty={!topByValue?.length}
            onRetry={() => topQ.refetch()}
            errorText={t("Не удалось загрузить топ товаров", "TOP mahsulotlarni yuklab bo'lmadi")}
            emptyText={t("Товаров с остатком нет", "Qoldiqli mahsulot yo'q")}
          >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border, #d8d5cd)" }}>
                  <th className="text-left py-2 font-label" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>#</th>
                  <th className="text-left py-2 font-label" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>{t("Товар", "Mahsulot")}</th>
                  <th className="text-right py-2 font-label" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>{t("Остаток", "Qoldiq")}</th>
                  <th className="text-right py-2 font-label" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>{t("Стоимость", "Qiymat")}</th>
                  <th className="text-right py-2 font-label" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>{t("Маржа", "Marja")}</th>
                </tr>
              </thead>
              <tbody>
                {topByValue?.map((p, i) => (
                  <tr key={p.productId} style={{ borderBottom: "1px solid var(--color-border, #d8d5cd)" }}>
                    <td className="py-2 font-data" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>{i + 1}</td>
                    <td className="py-2">
                      <div className="font-medium" style={{ color: "var(--color-text-primary, #2b2a28)" }}>{p.productName ?? "—"}</div>
                      <div style={{ color: "var(--color-text-tertiary, #6b6760)" }}>{p.productCode ?? ""}</div>
                    </td>
                    <td className="py-2 text-right font-data">{Number(p.currentStock ?? 0).toLocaleString("ru")} {unitShort(p.unit, lang)}</td>
                    <td className="py-2 text-right font-data font-semibold">{fmt(Number(p.costValue ?? 0))}</td>
                    <td className="py-2 text-right font-data" style={{ color: Number(p.margin ?? 0) >= 0 ? "var(--color-success-text)" : "var(--color-danger-text)" }}>
                      {fmt(Number(p.margin ?? 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </PanelBody>
        </ChartPanel>
      </div>

      {/* Turnover */}
      <ChartPanel title={`${t("Оборачиваемость", "Aylanma")} — ${t(`за ${days} дней`, `${days} kun ichida`)}`}>
        <PanelBody
          error={turnQ.isLoadingError}
          empty={!turnoverData?.length}
          onRetry={() => turnQ.refetch()}
          errorText={t("Не удалось загрузить оборачиваемость", "Aylanmani yuklab bo'lmadi")}
          emptyText={t("За период продаж не было", "Davr ichida sotuv bo'lmagan")}
        >
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border, #d8d5cd)" }}>
                <th className="text-left py-2 font-label" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>{t("Товар", "Mahsulot")}</th>
                <th className="text-right py-2 font-label" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>{t("Остаток", "Qoldiq")}</th>
                <th className="text-right py-2 font-label" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>{t("Продано", "Sotilgan")}</th>
                <th className="text-right py-2 font-label" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>{t("Коэфф.", "Koeff.")}</th>
                <th className="text-right py-2 font-label" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>{t("Дней до продажи", "Sotishgacha kun")}</th>
              </tr>
            </thead>
            <tbody>
              {turnoverData?.map((p) => {
                const rate = Number(p.turnoverRate);
                const color = rate >= 2 ? "var(--color-success-text)" : rate >= 1 ? "var(--color-warning-text)" : "var(--color-text-secondary, #5e5b54)";
                return (
                  <tr key={p.productId} style={{ borderBottom: "1px solid var(--color-border, #d8d5cd)" }}>
                    <td className="py-2">
                      <div className="font-medium" style={{ color: "var(--color-text-primary, #2b2a28)" }}>{p.productName ?? "—"}</div>
                      <div style={{ color: "var(--color-text-tertiary, #6b6760)" }}>{p.productCode ?? ""}</div>
                    </td>
                    <td className="py-2 text-right font-data">{Number(p.currentStock ?? 0).toLocaleString("ru")}</td>
                    <td className="py-2 text-right font-data font-semibold">{Number(p.soldQty).toLocaleString("ru")}</td>
                    <td className="py-2 text-right font-data font-bold" style={{ color }}>{p.turnoverRate}x</td>
                    <td className="py-2 text-right font-data" style={{ color: p.daysToSell < 7 ? "var(--color-danger-text)" : p.daysToSell < 14 ? "var(--color-warning-text)" : "var(--color-text-secondary, #5e5b54)" }}>
                      {p.daysToSell < 999 ? p.daysToSell : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </PanelBody>
      </ChartPanel>
    </div>
  );
}
