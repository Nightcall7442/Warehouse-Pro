/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLang } from "@/i18n";
import { format } from "date-fns";
import {
  Search, AlertTriangle, Package, FileDown, Trash2,
  Loader2, Boxes, Scale, AlertCircle, DollarSign,
  Clock, ShoppingCart,
} from "lucide-react";
import { exportToExcel, formatWarehouseForExport, formatStockValuationForExport, formatDeadStockForExport, formatReorderForExport } from "@/lib/excel";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { AdjustModal, MovementHistory, LowStockModal, unitLabel, toKg } from "@/components/warehouse";

// ── Main warehouse page ───────────────────────────────────────────────────────
export default function Warehouse() {
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const isMobile = useIsMobile();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const [search, setSearch] = useState("");
  const [adjusting, setAdjusting] = useState<{ id: number; name: string; stock: number; unit: string; unitWeight: number } | null>(null);
  const [activeTab, setActiveTab] = useState<"stock" | "deadstock" | "reorder">("stock");
  const [deadStockDays, setDeadStockDays] = useState(30);
  const [showLowStock, setShowLowStock] = useState(false);


  const { data, isLoading } = trpc.warehouse.list.useQuery({ search: search || undefined }) as { data: any; isLoading: boolean };
  const { data: valuation, isLoading: valLoading } = trpc.warehouse.valuation.useQuery() as { data: any; isLoading: boolean };
  const { data: reorderSuggestions } = trpc.warehouse.reorderSuggestions.useQuery() as { data: any };
  const { data: deadStockItems, isLoading: deadStockLoading } = trpc.warehouse.deadStock.useQuery({ days: deadStockDays }) as { data: any; isLoading: boolean };
  const utils = trpc.useUtils();

  const handleAdjust = useCallback((item: { id: number; name: string; stock: number; unit: string; unitWeight: number }) => {
    setAdjusting(item);
  }, []);

  const deleteMutation = trpc.product.delete.useMutation({
    onSuccess: () => {
      utils.warehouse.list.invalidate();
      notify.success(t("Товар удалён", "Mahsulot o'chirildi"));
    },
    onError: (e) => notify.error(e.message),
  });

  const handleDelete = useCallback((id: number) => {
    deleteMutation.mutate({ id });
  }, [deleteMutation]);

  const adjustMutation = trpc.warehouse.adjustStock.useMutation({
    onSuccess: () => {
      utils.warehouse.list.invalidate();
      setAdjusting(null);
      notify.success(t("Сток обновлён", "Stok yangilandi"));
    },
    onError: (e) => notify.error(e.message),
  });

  const backfillMutation = trpc.warehouse.backfillStock.useMutation({
    onSuccess: (result) => {
      utils.warehouse.list.invalidate();
      if (result.created > 0) {
        notify.success(t(`Создано ${result.created} строк стока`, `${result.created} ta stok satiri yaratildi`));
      } else {
        notify.success(t("Все товары уже имеют строки стока", "Barcha mahsulotlar allaqachon stokka ega"));
      }
    },
    onError: (e) => notify.error(e.message),
  });

  const deleteAllMutation = trpc.warehouse.deleteAll.useMutation({
    onSuccess: () => {
      utils.warehouse.list.invalidate();
      utils.warehouse.valuation.invalidate();
      notify.success(t("Все товары удалены со склада", "Barcha mahsulotlar o'chirildi"));
    },
    onError: (e) => notify.error(e.message),
  });

  const summary = data?.summary;
  const lowCount = Number(summary?.lowStockCount ?? 0);

  const kpis = useMemo(() => [
    { label: t("ПОЗИЦИЙ", "POZITSIYALAR"), value: summary?.totalSKUs ?? "—", icon: Boxes, gradient: "linear-gradient(135deg, #5b6d8a, #5b6d8a)", sub: t("уникальных товаров", "noyob mahsulotlar") },
    { label: t("ВСЕГО КГ", "JAMI KG"), value: Number(summary?.totalWeight ?? 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 }), icon: Scale, gradient: "linear-gradient(135deg, #60a5fa, #22d3ee)", sub: t("общий вес на складе", "ombordagi umumiy") },
    { label: t("СТОИМОСТЬ СКЛАДА", "OMBOR QIYMATI"), value: valLoading ? "—" : fmt(Number(valuation?.totalCostValue ?? 0).toFixed(0)), icon: DollarSign, gradient: "linear-gradient(135deg, #d4973a, #fb923c)", sub: t("себестоимость остатков", "qoldiq tannarx") },
    { label: t("МЕРТВЫЙ СТОК", "O'LIK STOK"), value: deadStockItems?.length ?? "—", icon: Clock, gradient: deadStockItems && deadStockItems.length > 0 ? "linear-gradient(135deg, #5b6d8a, #5b6d8a)" : "linear-gradient(135deg, #34c473, #34c473)", sub: t("товаров без продаж", "sotilmasdan mahsulotlar") },
    { label: t("МАЛО СТОКА", "KAM STOK"), value: lowCount, icon: lowCount > 0 ? AlertCircle : Package, gradient: lowCount > 0 ? "linear-gradient(135deg, #d45050, #d45050)" : "linear-gradient(135deg, #34c473, #34c473)", sub: lowCount > 0 ? t("товаров ниже порога", "mahsulot chegaradan past") : t("все в норме", "hammasi yaxshi"), onClick: lowCount > 0 ? () => setShowLowStock(true) : undefined },
  ], [summary, valuation, valLoading, deadStockItems, lowCount, t, fmt]);

  const tabs = useMemo(() => [
    { key: "stock" as const, label: t("Остатки", "Qoldiqlar"), count: summary?.totalSKUs ?? 0 },
    { key: "deadstock" as const, label: t("Мёртвый сток", "O'lik stok"), count: deadStockItems?.length ?? 0 },
    { key: "reorder" as const, label: t("Дозаказ", "Qayta buyurtma"), count: reorderSuggestions?.length ?? 0 },
  ], [summary, deadStockItems, reorderSuggestions, t]);

  return (
    <div className="space-y-5 animate-fade-up">
      {adjusting && (
        <AdjustModal
          productId={adjusting.id}
          productName={adjusting.name}
          currentStock={adjusting.stock}
          unit={adjusting.unit}
          unitWeight={adjusting.unitWeight}
          onSave={d => adjustMutation.mutate(d as Parameters<typeof adjustMutation.mutate>[0])}
          onClose={() => setAdjusting(null)}
          isPending={adjustMutation.isPending}
        />
      )}

      {/* Low Stock Modal */}
      {showLowStock && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={() => setShowLowStock(false)}>
          <div className="relative w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-3xl p-6" style={{ background: "var(--color-surface, #ffffff)", boxShadow: "0 25px 80px -12px rgba(0,0,0,0.35)" }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #d45050, #d45050)" }}>
                  <AlertTriangle size={18} color="#fff" />
                </div>
                <div>
                  <h2 className="text-lg font-bold" style={{ color: "var(--color-text-primary, #2b3450)", fontFamily: "'DM Sans', sans-serif" }}>
                    {t("Товары ниже порога", "Chegaradan past mahsulotlar")}
                  </h2>
                  <p className="text-xs" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
                    {lowCount} {t("товаров требуют пополнения", "ta mahsulot to'ldirish talab qiladi")}
                  </p>
                </div>
              </div>
              <button onClick={() => setShowLowStock(false)} className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "var(--color-surface-light, #f0f3f8)", border: "none", cursor: "pointer", color: "var(--color-text-secondary, #6a7290)" }}>
                ×
              </button>
            </div>
            <div className="space-y-2">
              {reorderSuggestions?.filter((r: any) => Number(r.currentStock ?? 0) < Number(r.reorderPoint ?? 0) && Number(r.reorderPoint ?? 0) > 0).map((item: any, i: number) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
                  <div className="w-2 h-8 rounded-full flex-shrink-0" style={{ background: "linear-gradient(180deg, #d45050, #d45050)" }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--color-text-primary, #2b3450)" }}>{item.productName}</p>
                    <p className="text-xs" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>{item.productCode}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold" style={{ color: "#d45050" }}>{Number(item.currentStock ?? 0).toFixed(1)}</p>
                    <p className="text-xs" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>{t("порог", "chegara")}: {Number(item.reorderPoint ?? 0).toFixed(0)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: "var(--color-text-primary, #2b3450)", fontFamily: "'DM Sans', sans-serif" }}>
            {t("Склад", "Ombor")}
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
            {t("Управление остатками товаров", "Mahsulot zaxiralarini boshqarish")}
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {activeTab === "stock" && (
            <>
              <button onClick={() => backfillMutation.mutate()} disabled={backfillMutation.isPending}
                className="neo-btn flex items-center gap-2 text-sm py-2 px-4"
                style={{ opacity: backfillMutation.isPending ? 0.5 : 1 }}>
                {backfillMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} />}
                {t("Добить стоки", "Stoklarni to'ldirish")}
              </button>
              <button onClick={() => {
                if (window.confirm(t("Удалить ВСЕ товары со склада? Это нельзя отменить.", "Barcha mahsulotlarni o'chirish? Qaytarib bo'lmaydi."))) {
                  deleteAllMutation.mutate();
                }
              }} disabled={deleteAllMutation.isPending}
                className="neo-btn flex items-center gap-2 text-sm py-2 px-4"
                style={{ color: "var(--color-danger)", opacity: deleteAllMutation.isPending ? 0.5 : 1 }}>
                {deleteAllMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {t("Удалить все", "Hammasini o'chirish")}
              </button>
              <button onClick={() => data?.data && exportToExcel(formatWarehouseForExport(data.data), "warehouse-stock", "Склад", t("Остатки склада", "Ombor qoldiqlari"))}
                className="neo-btn-primary flex items-center gap-2 text-sm py-2 px-5">
                <FileDown size={16} /> {t("Остатки", "Qoldiqlar")}
              </button>
              <button onClick={() => data?.data && exportToExcel(formatStockValuationForExport(data.data), "stock-valuation", "Оценка склада", t("Оценка стоимости склада", "Ombor qiymati"))}
                className="neo-btn flex items-center gap-2 text-sm py-2 px-5">
                <FileDown size={16} /> {t("Оценка", "Qiymat")}
              </button>
            </>
          )}
          {activeTab === "deadstock" && (
            <button onClick={() => deadStockItems?.length && exportToExcel(formatDeadStockForExport(deadStockItems), "dead-stock", "Мёртвый сток", t("Мёртвый сток — товары без продаж", "O'lik stok — sotilmasdan mahsulotlar"))}
              className="flex items-center gap-2 text-sm py-2.5 px-5 rounded-xl font-medium transition-all"
              style={{ background: "linear-gradient(135deg, #5b6d8a, #5b6d8a)", color: "#fff", boxShadow: "0 4px 16px rgba(167,139,250,0.3)" }}>
              <FileDown size={16} /> {t("Экспорт", "Eksport")}
            </button>
          )}
          {activeTab === "reorder" && (
            <button onClick={() => reorderSuggestions?.length && exportToExcel(formatReorderForExport(reorderSuggestions), "reorder-suggestions", "Дозаказ", t("Рекомендации по дозаказу", "Qayta buyurtma tavsiyalari"))}
              className="neo-btn-primary flex items-center gap-2 text-sm py-2 px-5">
              <FileDown size={16} /> {t("Экспорт", "Eksport")}
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {kpis.map((k, i) => {
          const Icon = k.icon;
          const Wrapper = k.onClick ? 'button' : 'div';
          return (
            <Wrapper key={k.label}
              className="kpi-hero"
              style={{ animationDelay: `${i * 0.05}s`, cursor: k.onClick ? "pointer" : "default", border: 'none', textAlign: 'left', width: '100%' } as any}
              onClick={k.onClick as any}>
              <div className="flex justify-between items-start mb-4">
                <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: "var(--color-text-tertiary, #98a0b8)", fontFamily: "'DM Sans', sans-serif" }}>
                  {k.label}
                </span>
                <div className="kpi-hero-icon" style={{ background: k.gradient }}>
                  <Icon size={22} color="#fff" />
                </div>
              </div>
              <div className="kpi-hero-value animate-count-up">{k.value}</div>
              <div className="kpi-hero-label mt-1">{k.sub}</div>
            </Wrapper>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className="flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all"
            style={{
              background: activeTab === tab.key ? "var(--color-surface, #ffffff)" : "transparent",
              color: activeTab === tab.key ? "var(--color-text-primary, #2b3450)" : "var(--color-text-tertiary, #98a0b8)",
              boxShadow: activeTab === tab.key ? "0 1px 3px rgba(0,0,0,.06)" : "none",
            }}>
            {tab.label}
            {tab.count > 0 && (
              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                style={{ background: activeTab === tab.key ? "#5b6d8a" : "var(--color-border, #f0f3f8)", color: activeTab === tab.key ? "#fff" : "var(--color-text-tertiary, #98a0b8)" }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── STOCK TAB ───────────────────────────────────────────────────────── */}
      {activeTab === "stock" && (
        <>
          {/* Low stock warning */}
          {lowCount > 0 && (
            <div className="flex items-center gap-3 px-5 py-4 rounded-2xl cursor-pointer neo-card-sm"
              onClick={() => setShowLowStock(true)}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "var(--color-danger, #d45050)" }}>
                <AlertTriangle size={18} color="#fff" />
              </div>
              <p className="text-sm flex-1 font-medium" style={{ color: "var(--color-text-primary)" }}>
                <b style={{ color: "var(--color-danger)" }}>{lowCount}</b> {t("товаров ниже порога — отмечены красным", "ta mahsulot chegaradan past")}
              </p>
              <span className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: "var(--color-danger-subtle, rgba(232,80,80,0.12))", color: "var(--color-danger, #d45050)" }}>
                {t("Показать", "Ko'rish")} →
              </span>
            </div>
          )}

          {/* Search */}
          <div style={{ position: "relative" }}>
            <Search size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #98a0b8)", pointerEvents: "none" }} />
            <input className="w-full py-3 pl-10 pr-4 rounded-xl text-sm outline-none transition-all"
              style={{ background: "var(--color-surface-light, #f0f3f8)", color: "var(--color-text-primary, #2b3450)", border: "2px solid transparent", fontFamily: "'DM Sans', sans-serif" }}
              onFocus={e => { e.currentTarget.style.borderColor = "#5b6d8a"; e.currentTarget.style.boxShadow = "0 0 0 4px rgba(75,108,246,0.1)"; e.currentTarget.style.background = "var(--color-surface, #ffffff)"; }}
              onBlur={e => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.background = "var(--color-surface-light, #f0f3f8)"; }}
              placeholder={t("Поиск товаров…", "Mahsulot qidirish…")}
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          {/* Table */}
          {isMobile ? (
            <div className="space-y-3">
              {isLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-28 rounded-2xl animate-pulse" style={{ background: "var(--color-surface-light, #f0f3f8)" }} />
                  ))
                : data?.data.map((item: any) => {
                    const low = Number(item.available ?? 0) < Number(item.reorderPoint ?? 0);
                    return (
                      <div key={item.id} className="rounded-2xl overflow-hidden"
                        style={{ background: "var(--color-surface, #ffffff)", boxShadow: "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06))" }}>
                        <div className="flex">
                          {low && <div className="w-1.5 flex-shrink-0" style={{ background: "#d45050" }} />}
                          <div className="flex-1 p-5">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                {low && <AlertTriangle size={14} color="#d45050" />}
                                <p className="text-sm font-semibold" style={{ color: "var(--color-text-primary, #2b3450)" }}>{item.productName}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button onClick={() => handleAdjust({ id: item.productId, name: item.productName ?? "", stock: Number(item.currentStock ?? 0), unit: item.unit ?? "pcs", unitWeight: Number(item.unitWeight ?? 0) })}
                                  className="text-xs py-1.5 px-3 rounded-lg transition-colors" style={{ color: "#5b6d8a", background: "rgba(75,108,246,0.08)" }}>
                                  {t("Скорр.", "Tuzatish")}
                                </button>
                                <button onClick={() => handleDelete(item.productId)}
                                  disabled={deleteMutation.isPending}
                                  className="text-xs py-1.5 px-2 rounded-lg transition-all"
                                  style={{ color: "#d45050", background: "rgba(232,80,80,0.08)" }}>
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                              {[
                                { label: t("Доступно", "Mavjud"), val: item.available, unit: item.unit, danger: low },
                                { label: t("Резерв", "Zahira"), val: item.reserved, unit: item.unit, danger: false },
                                { label: t("Всего", "Jami"), val: item.currentStock, unit: item.unit, danger: false },
                              ].map(col => (
                                <div key={col.label}>
                                  <p className="text-lg font-bold" style={{ color: col.danger ? "#d45050" : "var(--color-text-primary, #2b3450)", fontFamily: "'DM Sans', sans-serif" }}>
                                    {Number(col.val ?? 0).toFixed(0)}
                                  </p>
                                  <p className="text-[10px] mt-0.5" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>{col.label}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
            </div>
          ) : (
            <div className="rounded-2xl overflow-hidden"
              style={{ background: "var(--color-surface, #ffffff)", boxShadow: "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06))" }}>
              <table className="w-full" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                <thead>
                  <tr>
                    {[t("ТОВАР","MAHSULOT"), t("КОД","KOD"), t("КАТЕГОРИЯ","KATEGORIYA"),
                      t("ДОСТУПНО","MAVJUD"), t("ВЕС","OG'IRLIK"), t("РЕЗЕРВ","ZAHIRA"), t("ВСЕГО","JAMI"),
                      t("ПОРОГ","CHEGARA"), ""].map(h => (
                      <th key={h} className="text-left px-5 py-3 text-[10px] font-semibold tracking-wider uppercase"
                        style={{ color: "var(--color-text-tertiary, #98a0b8)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i}><td colSpan={9} className="px-5 py-4">
                          <div className="h-5 rounded-lg animate-pulse" style={{ background: "var(--color-surface-light, #f0f3f8)" }} />
                        </td></tr>
                      ))
                    : data?.data.length === 0
                    ? <tr><td colSpan={9} className="text-center py-16 text-sm" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
                        {t("Нет товаров на складе","Omborda mahsulot yo'q")}
                      </td></tr>
                    : data?.data.map((item: any) => {
                        const low = Number(item.available ?? 0) < Number(item.reorderPoint ?? 0);
                        return (
                          <tr key={item.id} style={low ? { background: "rgba(232,80,80,0.03)" } : undefined}>
                            <td className="px-5 py-3.5" style={{ borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                              <div className="flex items-center gap-2.5">
                                {low && <AlertTriangle size={13} color="#d45050" />}
                                <span className="text-sm font-medium" style={{ color: "var(--color-text-primary, #2b3450)" }}>{item.productName}</span>
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-xs" style={{ color: "var(--color-text-tertiary, #98a0b8)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                              {item.productCode}
                            </td>
                            <td className="px-5 py-3.5 text-sm" style={{ color: "var(--color-text-secondary, #6a7290)", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                              {item.category ?? "—"}
                            </td>
                            <td className="px-5 py-3.5 text-sm font-bold" style={{ color: low ? "#d45050" : "var(--color-text-primary, #2b3450)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                              {Number(item.available ?? 0).toFixed(2)}
                            </td>
                            <td className="px-5 py-3.5 text-sm" style={{ color: "var(--color-text-secondary, #6a7290)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                              {toKg(item.available, item.unitWeight).toFixed(1)} кг
                            </td>
                            <td className="px-5 py-3.5 text-sm" style={{ color: "var(--color-text-secondary, #6a7290)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                              {Number(item.reserved ?? 0).toFixed(2)}
                            </td>
                            <td className="px-5 py-3.5 text-sm" style={{ color: "var(--color-text-primary, #2b3450)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                              {Number(item.currentStock ?? 0).toFixed(2)}
                            </td>
                            <td className="px-5 py-3.5 text-sm" style={{ color: "var(--color-text-tertiary, #98a0b8)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                              {Number(item.reorderPoint ?? 0).toFixed(0)}
                            </td>
                            <td className="px-5 py-3.5" style={{ borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                              <div className="flex items-center gap-2">
                                <button onClick={() => handleAdjust({ id: item.productId, name: item.productName ?? "", stock: Number(item.currentStock ?? 0), unit: item.unit ?? "pcs", unitWeight: Number(item.unitWeight ?? 0) })}
                                  className="text-xs py-1.5 px-3 rounded-lg transition-all"
                                  style={{ color: "#5b6d8a", background: "rgba(75,108,246,0.08)" }}>
                                  {t("Скорректировать", "Tuzatish")}
                                </button>
                                <button onClick={() => handleDelete(item.productId)}
                                  disabled={deleteMutation.isPending}
                                  className="text-xs py-1.5 px-3 rounded-lg transition-all"
                                  style={{ color: "#d45050", background: "rgba(232,80,80,0.08)" }}>
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── DEAD STOCK TAB ─────────────────────────────────────────────────── */}
      {activeTab === "deadstock" && (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-medium" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
              {t("Без продаж более", "Sotilmasdan ko'proq")}:
            </span>
            {[7, 14, 30, 60, 90].map(d => (
              <button key={d} onClick={() => setDeadStockDays(d)}
                className="text-xs py-1.5 px-3 rounded-lg font-medium transition-all"
                style={{
                  background: deadStockDays === d ? "#5b6d8a" : "var(--color-surface-light, #f0f3f8)",
                  color: deadStockDays === d ? "#fff" : "var(--color-text-tertiary, #98a0b8)",
                }}>
                {d} {t("дн", "kun")}
              </button>
            ))}
          </div>

          {deadStockLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: "var(--color-surface-light, #f0f3f8)" }} />
              ))}
            </div>
          ) : !deadStockItems?.length ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(74,222,128,0.1)" }}>
                <Package size={28} color="#34c473" />
              </div>
              <p className="text-sm font-medium" style={{ color: "var(--color-text-primary, #2b3450)" }}>
                {t("Нет мёртвого стока", "O'lik stok yo'q")}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
                {t("Все товары продаются в течение", "Barcha mahsulotlar sotilmoqda")} {deadStockDays} {t("дней", "kun")}.
              </p>
            </div>
          ) : isMobile ? (
            <div className="space-y-3">
              {deadStockItems.map((item: any, i: any) => {
                const days = Number(item.daysSinceOrder ?? 99999);
                const isUrgent = days > 90;
                const isWarning = days > 30;
                const bgColor = isUrgent ? "rgba(232,80,80,0.06)" : isWarning ? "rgba(251,191,36,0.06)" : "var(--color-surface, #ffffff)";
                const borderColor = isUrgent ? "rgba(232,80,80,0.15)" : isWarning ? "rgba(251,191,36,0.15)" : "var(--color-border, #f0f3f8)";
                const badgeColor = isUrgent ? "#d45050" : isWarning ? "#d4973a" : "#5b6d8a";
                return (
                  <div key={item.productId} className="rounded-2xl p-4" style={{ background: bgColor, boxShadow: `inset 0 0 0 1px ${borderColor}`, animation: `slideUp ${0.3 + i * 0.05}s ease forwards` }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Clock size={14} color={badgeColor} />
                        <span className="text-sm font-semibold" style={{ color: "var(--color-text-primary, #2b3450)" }}>{item.productName}</span>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: `${badgeColor}15`, color: badgeColor }}>
                        {days === 99999 ? t("Никогда", "Hech qachon") : `${days} ${t("дн", "kun")}`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
                        {t("Остаток:", "Qoldiq:")} {Number(item.currentStock ?? 0).toFixed(2)}
                      </span>
                      <span className="text-sm font-bold" style={{ color: badgeColor, fontFamily: "'DM Sans', sans-serif" }}>
                        {fmt(Number(item.value ?? 0).toFixed(0))}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl overflow-hidden" style={{ background: "var(--color-surface, #ffffff)", boxShadow: "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06))" }}>
              <table className="w-full" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                <thead>
                  <tr>
                    {[t("ТОВАР","MAHSULOT"), t("КОД","KOD"), t("КАТЕГОРИЯ","KATEGORIYA"), t("ОСТАТОК","QOLDIQ"), t("СТОИМОСТЬ","QIYMAT"), t("ПОСЛ. ЗАКАЗ","OXIRGI BUYURTMA"), t("ДНЕЙ БЕЗ ПРОДАЖ","SOTISHSIZ KUN")].map(h => (
                      <th key={h} className="text-left px-5 py-3 text-[10px] font-semibold tracking-wider uppercase cursor-pointer select-none"
                        style={{ color: "var(--color-text-tertiary, #98a0b8)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                        <span className="flex items-center gap-1">{h}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deadStockItems.map((item: any) => {
                    const days = Number(item.daysSinceOrder ?? 99999);
                    const isUrgent = days > 90;
                    const isWarning = days > 30;
                    const rowBg = isUrgent ? "rgba(232,80,80,0.04)" : isWarning ? "rgba(251,191,36,0.04)" : undefined;
                    const badgeColor = isUrgent ? "#d45050" : isWarning ? "#d4973a" : "#5b6d8a";
                    return (
                      <tr key={item.productId} style={{ background: rowBg }}>
                        <td className="px-5 py-3.5 text-sm font-medium" style={{ color: "var(--color-text-primary, #2b3450)", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                          <div className="flex items-center gap-2">
                            <Clock size={13} color={badgeColor} />
                            {item.productName}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-xs" style={{ color: "var(--color-text-tertiary, #98a0b8)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                          {item.productCode}
                        </td>
                        <td className="px-5 py-3.5 text-sm" style={{ color: "var(--color-text-secondary, #6a7290)", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                          {item.category ?? "—"}
                        </td>
                        <td className="px-5 py-3.5 text-sm font-bold" style={{ color: "var(--color-text-primary, #2b3450)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                          {Number(item.currentStock ?? 0).toFixed(2)}
                        </td>
                        <td className="px-5 py-3.5 text-sm font-bold" style={{ color: badgeColor, fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                          {fmt(Number(item.value ?? 0).toFixed(0))}
                        </td>
                        <td className="px-5 py-3.5 text-xs" style={{ color: "var(--color-text-tertiary, #98a0b8)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                          {item.lastOrderDate ? format(new Date(item.lastOrderDate), "dd.MM.yyyy") : t("Никогда", "Hech qachon")}
                        </td>
                        <td className="px-5 py-3.5" style={{ borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                          <span className="text-xs px-2.5 py-1 rounded-full font-semibold"
                            style={{ background: `${badgeColor}15`, color: badgeColor }}>
                            {days === 99999 ? t("∞", "∞") : `${days} ${t("дн", "kun")}`}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {deadStockItems && deadStockItems.length > 0 && (
            <div className="flex items-center justify-between text-xs px-2" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
              <span>{deadStockItems.length} {t("товаров", "mahsulot")}</span>
              <span>{t("Общая стоимость:", "Umumiy qiymat:")} {fmt(deadStockItems.reduce((acc: any, r: any) => acc + Number(r.value ?? 0), 0).toFixed(0))}</span>
            </div>
          )}
        </>
      )}

      {/* ── REORDER TAB ────────────────────────────────────────────────────── */}
      {activeTab === "reorder" && (
        <>
          {!reorderSuggestions?.length ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(74,222,128,0.1)" }}>
                <ShoppingCart size={28} color="#34c473" />
              </div>
              <p className="text-sm font-medium" style={{ color: "var(--color-text-primary, #2b3450)" }}>
                {t("Все товары в наличии", "Barcha mahsulotlar mavjud")}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
                {t("Нет товаров, требующих дозаказа", "Qayta buyurtma kerak bo'lgan mahsulot yo'q")}
              </p>
            </div>
          ) : isMobile ? (
            <div className="space-y-3">
              {reorderSuggestions.map((item: any, i: any) => {
                const daysLeft = Number(item.daysUntilStockout ?? 999);
                const isUrgent = daysLeft <= 3;
                const isWarning = daysLeft <= 7;
                const badgeColor = isUrgent ? "#d45050" : isWarning ? "#d4973a" : "#5b6d8a";
                return (
                  <div key={item.productId} className="rounded-2xl overflow-hidden" style={{ animation: `slideUp ${0.3 + i * 0.05}s ease forwards` }}>
                    <div className="flex">
                      <div className="w-1.5 flex-shrink-0" style={{ background: badgeColor }} />
                      <div className="flex-1 p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold" style={{ color: "var(--color-text-primary, #2b3450)" }}>{item.productName}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: `${badgeColor}15`, color: badgeColor }}>
                            {daysLeft} {t("дн до конца", "kun qoldi")}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
                          <span>{t("Остаток:", "Qoldiq:")} {Number(item.currentStock ?? 0).toFixed(1)} / {Number(item.reorderPoint ?? 0).toFixed(0)} {unitLabel(item.unit, lang)}</span>
                          <span className="font-semibold" style={{ color: badgeColor }}>+{item.suggestedQty} {unitLabel(item.unit, lang)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl overflow-hidden" style={{ background: "var(--color-surface, #ffffff)", boxShadow: "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06))" }}>
              <table className="w-full" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                <thead>
                  <tr>
                    {[t("ТОВАР","MAHSULOT"), t("ОСТАТОК","QOLDIQ"), t("ПОРОГ","CHEGARA"), t("ПРОДАЖИ/ДЕНЬ","SOTISH/KUN"), t("ДНЕЙ ДО КОНЦА","KUN QOLDI"), t("ЗАКАЗАТЬ","BUYURTMA BERISH"), t("СТОИМОСТЬ","NARX")].map(h => (
                      <th key={h} className="text-left px-5 py-3 text-[10px] font-semibold tracking-wider uppercase"
                        style={{ color: "var(--color-text-tertiary, #98a0b8)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reorderSuggestions.map((item: any) => {
                    const daysLeft = Number(item.daysUntilStockout ?? 999);
                    const isUrgent = daysLeft <= 3;
                    const isWarning = daysLeft <= 7;
                    const badgeColor = isUrgent ? "#d45050" : isWarning ? "#d4973a" : "#5b6d8a";
                    const rowBg = isUrgent ? "rgba(232,80,80,0.04)" : isWarning ? "rgba(251,191,36,0.04)" : undefined;
                    return (
                      <tr key={item.productId} style={{ background: rowBg }}>
                        <td className="px-5 py-3.5 text-sm font-medium" style={{ color: "var(--color-text-primary, #2b3450)", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                          <div className="flex items-center gap-2">
                            {isUrgent && <AlertTriangle size={13} color="#d45050" />}
                            {item.productName}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-sm font-bold" style={{ color: badgeColor, fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                          {Number(item.currentStock ?? 0).toFixed(1)} {unitLabel(item.unit, lang)}
                        </td>
                        <td className="px-5 py-3.5 text-sm" style={{ color: "var(--color-text-tertiary, #98a0b8)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                          {Number(item.reorderPoint ?? 0).toFixed(0)} {unitLabel(item.unit, lang)}
                        </td>
                        <td className="px-5 py-3.5 text-sm" style={{ color: "var(--color-text-secondary, #6a7290)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                          {item.avgDailySales}
                        </td>
                        <td className="px-5 py-3.5" style={{ borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                          <span className="text-xs px-2.5 py-1 rounded-full font-semibold"
                            style={{ background: `${badgeColor}15`, color: badgeColor }}>
                            {daysLeft} {t("дн", "kun")}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-sm font-bold" style={{ color: badgeColor, fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                          +{item.suggestedQty} {unitLabel(item.unit, lang)}
                        </td>
                        <td className="px-5 py-3.5 text-sm font-bold" style={{ color: "var(--color-text-primary, #2b3450)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                          {fmt(Number(item.suggestedCost ?? 0).toFixed(0))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {reorderSuggestions && reorderSuggestions.length > 0 && (
            <div className="flex items-center justify-between text-xs px-2" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
              <span>{reorderSuggestions.length} {t("товаров", "mahsulot")}</span>
              <span>{t("Общая стоимость дозаказа:", "Umumiy buyurtma qiymati:")} {fmt(reorderSuggestions.reduce((acc: number, r: any) => acc + Number(r.suggestedCost ?? 0), 0).toFixed(0))}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
