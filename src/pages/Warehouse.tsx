import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLang } from "@/i18n";
import { format } from "date-fns";
import {
  Search, AlertTriangle, Package, X, FileDown,
  TrendingUp, TrendingDown, ArrowUpDown, Loader2,
  ChevronDown, ChevronUp, Boxes, Scale, AlertCircle, DollarSign,
  Clock, ShoppingCart,
} from "lucide-react";
import { exportToExcel, formatWarehouseForExport, formatMovementsForExport, formatStockValuationForExport, formatDeadStockForExport, formatReorderForExport } from "@/lib/excel";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";

const MOVE_TYPE: Record<string, { icon: any; labelRu: string; labelUz: string; color: string; sign: string }> = {
  in:         { icon: TrendingUp,   labelRu: "Приход",       labelUz: "Kirim",       color: "#4ade80", sign: "+" },
  out:        { icon: TrendingDown,  labelRu: "Расход",       labelUz: "Chiqim",      color: "#f87171", sign: "−" },
  adjustment: { icon: ArrowUpDown,  labelRu: "Корректировка", labelUz: "Tuzatish",   color: "#fbbf24", sign: "±" },
};

const UNIT_LABELS: Record<string, [string, string]> = {
  kg: ["кг", "kg"], l: ["л", "l"], pcs: ["шт", "dona"],
  box: ["ящ", "quti"], pack: ["упак", "pachka"], m: ["м", "m"],
};

function unitLabel(unit: string | undefined, lang: "ru" | "uz"): string {
  const e = UNIT_LABELS[unit ?? "pcs"];
  return e ? (lang === "uz" ? e[1] : e[0]) : (unit ?? "шт");
}

/** Convert stock quantity to kg using unitWeight. If unitWeight=0, assume already in kg */
function toKg(stock: number | string, unitWeight: number | string | null): number {
  const qty = Number(stock ?? 0);
  const w = Number(unitWeight ?? 0);
  return w > 0 ? qty * w : qty;
}

// ── Premium adjust modal ─────────────────────────────────────────────────────
function AdjustModal({ productId, productName, currentStock, unit, unitWeight, onSave, onClose, isPending }: {
  productId: number; productName: string; currentStock: number;
  unit: string; unitWeight: number;
  onSave: (d: unknown) => void; onClose: () => void; isPending: boolean;
}) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [qty, setQty] = useState("");
  const [type, setType] = useState<"in" | "out" | "adjustment">("in");
  const [notes, setNotes] = useState("");

  const types = [
    { value: "in" as const, icon: TrendingUp, labelRu: "Приход", labelUz: "Kirim", color: "#4ade80", descRu: "Добавить на склад", descUz: "Omborga qo'shish" },
    { value: "out" as const, icon: TrendingDown, labelRu: "Расход", labelUz: "Chiqim", color: "#f87171", descRu: "Списать со склада", descUz: "Ombordan chiqarish" },
    { value: "adjustment" as const, icon: ArrowUpDown, labelRu: "Корректировка", labelUz: "Tuzatish", color: "#fbbf24", descRu: "Установить точное кол-во", descUz: "Aniq miqdorni o'rnatish" },
  ];

  const currentType = types.find(t => t.value === type)!;
  const numQty = Number(qty) || 0;
  const newStock = type === "in" ? currentStock + numQty : type === "out" ? currentStock - numQty : numQty;
  const unitLabel = unit === "kg" ? "кг" : unit === "l" ? "л" : unit === "pcs" ? "шт" : unit === "box" ? "ящ" : unit === "pack" ? "упак" : unit === "м" ? "м" : unit;
  const previewWeightKg = unitWeight > 0 ? (numQty * unitWeight).toFixed(1) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(12px)" }}>
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl p-6 space-y-5 animate-fade-up"
        style={{ background: "var(--color-surface, #ffffff)", boxShadow: "0 -25px 60px -15px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05) inset" }}>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: "var(--color-text-primary, #111827)", fontFamily: "'DM Sans', sans-serif" }}>
              {t("Движение товара", "Mahsulot harakati")}
            </h2>
            <p className="text-sm mt-0.5" style={{ color: "var(--color-text-tertiary, #9ca3af)" }}>{productName}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
            style={{ background: "var(--color-surface-light, #f8f9fb)" }}>
            <X size={18} style={{ color: "var(--color-text-secondary, #6b7280)" }} />
          </button>
        </div>

        {/* Current stock badge */}
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: "var(--color-surface-light, #f8f9fb)" }}>
          <Scale size={16} style={{ color: "var(--color-text-tertiary, #9ca3af)" }} />
          <span className="text-xs font-medium" style={{ color: "var(--color-text-tertiary, #9ca3af)" }}>
            {t("Текущий остаток", "Joriy qoldiq")}
          </span>
          <span className="ml-auto text-sm font-bold" style={{ color: "var(--color-text-primary, #111827)", fontFamily: "'DM Sans', sans-serif" }}>
            {currentStock.toFixed(2)} {unitLabel}
            {unitWeight > 0 && <span className="text-xs font-normal" style={{ color: "var(--color-text-tertiary, #9ca3af)" }}> ({toKg(currentStock, unitWeight).toFixed(1)} кг)</span>}
          </span>
        </div>

        {/* Type selector */}
        <div>
          <label className="text-[10px] font-semibold tracking-wider uppercase mb-3 block" style={{ color: "var(--color-text-tertiary, #9ca3af)", fontFamily: "'DM Sans', sans-serif" }}>
            {t("ТИП ОПЕРАЦИИ", "OPERATSIYA TURI")}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {types.map(opt => {
              const Icon = opt.icon;
              const active = type === opt.value;
              return (
                <button key={opt.value} onClick={() => setType(opt.value)}
                  className="p-3 rounded-xl text-center transition-all"
                  style={{
                    background: active ? `${opt.color}15` : "var(--color-surface-light, #f8f9fb)",
                    border: `2px solid ${active ? opt.color : "transparent"}`,
                    boxShadow: active ? `0 0 0 1px ${opt.color}20` : "none",
                  }}>
                  <Icon size={20} style={{ color: opt.color, margin: "0 auto 6px" }} />
                  <p className="text-xs font-semibold" style={{ color: active ? opt.color : "var(--color-text-primary, #111827)" }}>
                    {lang === "uz" ? opt.labelUz : opt.labelRu}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--color-text-tertiary, #9ca3af)" }}>
                    {lang === "uz" ? opt.descUz : opt.descRu}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Quantity input */}
        <div>
          <label className="text-[10px] font-semibold tracking-wider uppercase mb-2 block" style={{ color: "var(--color-text-tertiary, #9ca3af)", fontFamily: "'DM Sans', sans-serif" }}>
            {t(`КОЛИЧЕСТВО (${unitLabel.toUpperCase()})`, `MIQDOR (${unitLabel.toUpperCase()})`)}
          </label>
          <input type="number" step="0.01" min="0" autoFocus
            className="w-full px-4 py-3 rounded-xl text-xl font-bold outline-none transition-all"
            style={{ background: "var(--color-surface-light, #f8f9fb)", color: "var(--color-text-primary, #111827)", fontFamily: "'DM Sans', sans-serif", border: "2px solid transparent" }}
            onFocus={e => e.currentTarget.style.borderColor = currentType.color}
            onBlur={e => e.currentTarget.style.borderColor = "transparent"}
            placeholder="0.00" value={qty} onChange={e => setQty(e.target.value)} />
          {numQty > 0 && (
            <div className="flex items-center justify-between mt-2 px-1">
              <span className="text-xs" style={{ color: "var(--color-text-tertiary, #9ca3af)" }}>
                {t("Новый остаток", "Yangi qoldiq")}
              </span>
              <span className="text-sm font-bold" style={{ color: newStock >= 0 ? "#4ade80" : "#f87171", fontFamily: "'DM Sans', sans-serif" }}>
                {newStock.toFixed(2)} {unitLabel}
                {unitWeight > 0 && <span className="text-xs font-normal" style={{ color: "var(--color-text-tertiary, #9ca3af)" }}> ({toKg(newStock, unitWeight).toFixed(1)} кг)</span>}
              </span>
            </div>
          )}
          {numQty > 0 && previewWeightKg && (
            <div className="flex items-center justify-between mt-1 px-1">
              <span className="text-xs" style={{ color: "var(--color-text-tertiary, #9ca3af)" }}>
                {t("Вес", "Og'irlik")}
              </span>
              <span className="text-xs font-medium" style={{ color: "var(--color-text-secondary, #6b7280)" }}>
                {previewWeightKg} кг
              </span>
            </div>
          )}
        </div>

        {/* Notes */}
        <div>
          <label className="text-[10px] font-semibold tracking-wider uppercase mb-2 block" style={{ color: "var(--color-text-tertiary, #9ca3af)", fontFamily: "'DM Sans', sans-serif" }}>
            {t("ПРИМЕЧАНИЕ", "IZOH")}
          </label>
          <input className="w-full px-4 py-3 rounded-xl outline-none transition-all"
            style={{ background: "var(--color-surface-light, #f8f9fb)", color: "var(--color-text-primary, #111827)", border: "2px solid transparent" }}
            onFocus={e => e.currentTarget.style.borderColor = "#818cf8"}
            onBlur={e => e.currentTarget.style.borderColor = "transparent"}
            placeholder={t("Например: возврат от клиента", "Masalan: mijozdan qaytarish")}
            value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button onClick={onClose}
            className="flex-1 py-3 rounded-xl text-sm font-medium transition-all"
            style={{ background: "var(--color-surface-light, #f8f9fb)", color: "var(--color-text-secondary, #6b7280)" }}>
            {t("Отмена", "Bekor")}
          </button>
          <button onClick={() => qty && numQty > 0 && onSave({ productId, quantity: qty, type, notes })}
            disabled={!qty || numQty <= 0 || isPending}
            className="flex-1 py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-40"
            style={{ background: `linear-gradient(135deg, ${currentType.color}, ${currentType.color}cc)`, boxShadow: `0 4px 16px ${currentType.color}30` }}>
            {isPending && <Loader2 size={16} className="animate-spin" />}
            {t("Применить", "Qo'llash")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Movement history ──────────────────────────────────────────────────────────
function MovementHistory({ productId, productName }: { productId: number; productName: string }) {
  const [open, setOpen] = useState(false);
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const { data: movements } = trpc.warehouse.movements.useQuery({ productId }, { enabled: open });

  return (
    <div>
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3 text-xs transition-colors rounded-lg"
        style={{ color: "var(--color-text-tertiary, #9ca3af)" }}>
        <span>{open ? t("Скрыть историю", "Tarixni yashirish") : t("История движений", "Harakat tarixi")}</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="px-5 pb-4">
          <div className="flex justify-end mb-3">
            <button onClick={() => movements && exportToExcel(formatMovementsForExport(movements), `movements-${productName}`)}
              className="text-xs flex items-center gap-1.5 py-1.5 px-3 rounded-lg transition-colors"
              style={{ color: "var(--color-text-tertiary, #9ca3af)" }}>
              <FileDown size={12} /> Excel
            </button>
          </div>
          {!movements?.length ? (
            <p className="text-xs py-3" style={{ color: "var(--color-text-tertiary, #9ca3af)" }}>
              {t("Движений нет", "Harakatlar yo'q")}
            </p>
          ) : (
            <div className="space-y-2">
              {movements.map(m => {
                const mt = MOVE_TYPE[m.type] ?? MOVE_TYPE.adjustment;
                const Icon = mt.icon;
                return (
                  <div key={m.id} className="flex items-start gap-3 py-3 px-4 rounded-xl"
                    style={{ background: "var(--color-surface-light, #f8f9fb)", boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: `${mt.color}15` }}>
                      <Icon size={14} style={{ color: mt.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium" style={{ color: "var(--color-text-primary, #111827)" }}>
                          {lang === "uz" ? mt.labelUz : mt.labelRu}
                        </span>
                        <span className="text-xs" style={{ color: "var(--color-text-tertiary, #9ca3af)", fontFamily: "'DM Sans', sans-serif" }}>
                          {m.createdAt ? format(new Date(m.createdAt), "dd.MM.yy HH:mm") : "—"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <span className="text-base font-bold" style={{ color: mt.color, fontFamily: "'DM Sans', sans-serif" }}>
                          {mt.sign}{Number(m.quantity).toFixed(2)} кг
                        </span>
                        {m.notes && <span className="text-xs truncate" style={{ color: "var(--color-text-tertiary, #9ca3af)" }}>{m.notes}</span>}
                      </div>
                      {m.referenceType && (
                        <span className="text-[10px] mt-0.5 inline-block px-2 py-0.5 rounded"
                          style={{ background: "var(--color-surface, #ffffff)", color: "var(--color-text-tertiary, #9ca3af)" }}>
                          {m.referenceType} #{m.referenceId}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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


  const { data, isLoading } = trpc.warehouse.list.useQuery({ search: search || undefined }) as { data: any; isLoading: boolean };
  const { data: valuation, isLoading: valLoading } = trpc.warehouse.valuation.useQuery() as { data: any; isLoading: boolean };
  const { data: reorderSuggestions } = trpc.warehouse.reorderSuggestions.useQuery() as { data: any };
  const { data: deadStockItems, isLoading: deadStockLoading } = trpc.warehouse.deadStock.useQuery({ days: deadStockDays }) as { data: any; isLoading: boolean };
  const utils = trpc.useUtils();

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

  const summary = data?.summary;
  const lowCount = Number(summary?.lowStockCount ?? 0);

  const kpis = [
    { label: t("ПОЗИЦИЙ", "POZITSIYALAR"), value: summary?.totalSKUs ?? "—", icon: Boxes, gradient: "linear-gradient(135deg, #818cf8, #6366f1)", sub: t("уникальных товаров", "noyob mahsulotlar") },
    { label: t("ВСЕГО КГ", "JAMI KG"), value: Number(summary?.totalWeight ?? 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 }), icon: Scale, gradient: "linear-gradient(135deg, #60a5fa, #22d3ee)", sub: t("общий вес на складе", "ombordagi umumiy") },
    { label: t("СТОИМОСТЬ СКЛАДА", "OMBOR QIYMATI"), value: valLoading ? "—" : fmt(Number(valuation?.totalCostValue ?? 0).toFixed(0)), icon: DollarSign, gradient: "linear-gradient(135deg, #fbbf24, #fb923c)", sub: t("себестоимость остатков", "qoldiq tannarx") },
    { label: t("МЕРТВЫЙ СТОК", "O'LIK STOK"), value: deadStockItems?.length ?? "—", icon: Clock, gradient: deadStockItems && deadStockItems.length > 0 ? "linear-gradient(135deg, #6366f1, #818cf8)" : "linear-gradient(135deg, #4ade80, #22c55e)", sub: t("товаров без продаж", "sotilmasdan mahsulotlar") },
    { label: t("МАЛО СТОКА", "KAM STOK"), value: lowCount, icon: lowCount > 0 ? AlertCircle : Package, gradient: lowCount > 0 ? "linear-gradient(135deg, #f87171, #ef4444)" : "linear-gradient(135deg, #4ade80, #22c55e)", sub: lowCount > 0 ? t("товаров ниже порога", "mahsulot chegaradan past") : t("все в норме", "hammasi yaxshi") },
  ];

  const tabs = [
    { key: "stock" as const, label: t("Остатки", "Qoldiqlar"), count: summary?.totalSKUs ?? 0 },
    { key: "deadstock" as const, label: t("Мёртвый сток", "O'lik stok"), count: deadStockItems?.length ?? 0 },
    { key: "reorder" as const, label: t("Дозаказ", "Qayta buyurtma"), count: reorderSuggestions?.length ?? 0 },
  ];

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

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: "var(--color-text-primary, #111827)", fontFamily: "'DM Sans', sans-serif" }}>
            {t("Склад", "Ombor")}
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--color-text-tertiary, #9ca3af)" }}>
            {t("Управление остатками товаров", "Mahsulot zaxiralarini boshqarish")}
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {activeTab === "stock" && (
            <>
              <button onClick={() => backfillMutation.mutate()} disabled={backfillMutation.isPending}
                className="flex items-center gap-2 text-sm py-2.5 px-4 rounded-xl font-medium transition-all"
                style={{
                  background: "var(--color-surface-light, #f8f9fb)", color: "var(--color-text-secondary, #6b7280)",
                  border: "1px solid #f3f4f6", cursor: "pointer",
                  opacity: backfillMutation.isPending ? 0.5 : 1,
                }}>
                {backfillMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} />}
                {t("Добить стоки", "Stoklarni to'ldirish")}
              </button>
              <button onClick={() => data?.data && exportToExcel(formatWarehouseForExport(data.data), "warehouse-stock", "Склад", t("Остатки склада", "Ombor qoldiqlari"))}
                className="flex items-center gap-2 text-sm py-2.5 px-5 rounded-xl font-medium transition-all"
                style={{ background: "linear-gradient(135deg, #818cf8, #6366f1)", color: "#fff", boxShadow: "0 4px 16px rgba(129,140,248,0.3)" }}>
                <FileDown size={16} /> {t("Остатки", "Qoldiqlar")}
              </button>
              <button onClick={() => data?.data && exportToExcel(formatStockValuationForExport(data.data), "stock-valuation", "Оценка склада", t("Оценка стоимости склада", "Ombor qiymati"))}
                className="flex items-center gap-2 text-sm py-2.5 px-5 rounded-xl font-medium transition-all"
                style={{ background: "linear-gradient(135deg, #fbbf24, #fb923c)", color: "#fff", boxShadow: "0 4px 16px rgba(251,191,36,0.3)" }}>
                <FileDown size={16} /> {t("Оценка", "Qiymat")}
              </button>
            </>
          )}
          {activeTab === "deadstock" && (
            <button onClick={() => deadStockItems?.length && exportToExcel(formatDeadStockForExport(deadStockItems), "dead-stock", "Мёртвый сток", t("Мёртвый сток — товары без продаж", "O'lik stok — sotilmasdan mahsulotlar"))}
              className="flex items-center gap-2 text-sm py-2.5 px-5 rounded-xl font-medium transition-all"
              style={{ background: "linear-gradient(135deg, #6366f1, #818cf8)", color: "#fff", boxShadow: "0 4px 16px rgba(167,139,250,0.3)" }}>
              <FileDown size={16} /> {t("Экспорт", "Eksport")}
            </button>
          )}
          {activeTab === "reorder" && (
            <button onClick={() => reorderSuggestions?.length && exportToExcel(formatReorderForExport(reorderSuggestions), "reorder-suggestions", "Дозаказ", t("Рекомендации по дозаказу", "Qayta buyurtma tavsiyalari"))}
              className="flex items-center gap-2 text-sm py-2.5 px-5 rounded-xl font-medium transition-all"
              style={{ background: "linear-gradient(135deg, #f87171, #ef4444)", color: "#fff", boxShadow: "0 4px 16px rgba(248,113,113,0.3)" }}>
              <FileDown size={16} /> {t("Экспорт", "Eksport")}
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {kpis.map((k, i) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="kpi-hero" style={{ animationDelay: `${i * 0.05}s` }}>
              <div className="flex justify-between items-start mb-4">
                <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: "var(--color-text-tertiary, #9ca3af)", fontFamily: "'DM Sans', sans-serif" }}>
                  {k.label}
                </span>
                <div className="kpi-hero-icon" style={{ background: k.gradient }}>
                  <Icon size={22} color="#fff" />
                </div>
              </div>
              <div className="kpi-hero-value animate-count-up">{k.value}</div>
              <div className="kpi-hero-label mt-1">{k.sub}</div>
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: "var(--color-surface-light, #f8f9fb)" }}>
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className="flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all"
            style={{
              background: activeTab === tab.key ? "var(--color-surface, #ffffff)" : "transparent",
              color: activeTab === tab.key ? "var(--color-text-primary, #111827)" : "var(--color-text-tertiary, #9ca3af)",
              boxShadow: activeTab === tab.key ? "0 1px 3px rgba(0,0,0,.06)" : "none",
            }}>
            {tab.label}
            {tab.count > 0 && (
              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                style={{ background: activeTab === tab.key ? "#818cf8" : "var(--color-border, #f3f4f6)", color: activeTab === tab.key ? "#fff" : "var(--color-text-tertiary, #9ca3af)" }}>
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
            <div className="flex items-center gap-3 px-5 py-4 rounded-2xl"
              style={{ background: "rgba(248,113,113,0.06)", boxShadow: "inset 0 0 0 1px rgba(248,113,113,0.15)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #f87171, #ef4444)" }}>
                <AlertTriangle size={18} color="#fff" />
              </div>
              <p className="text-sm" style={{ color: "var(--color-text-primary, #111827)" }}>
                <b style={{ color: "#f87171" }}>{lowCount}</b> {t("товаров ниже порога — отмечены красным", "ta mahsulot chegaradan past")}
              </p>
            </div>
          )}

          {/* Search */}
          <div style={{ position: "relative" }}>
            <Search size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #9ca3af)", pointerEvents: "none" }} />
            <input className="w-full py-3 pl-10 pr-4 rounded-xl text-sm outline-none transition-all"
              style={{ background: "var(--color-surface-light, #f8f9fb)", color: "var(--color-text-primary, #111827)", border: "2px solid transparent", fontFamily: "'DM Sans', sans-serif" }}
              onFocus={e => { e.currentTarget.style.borderColor = "#818cf8"; e.currentTarget.style.boxShadow = "0 0 0 4px rgba(129,140,248,0.1)"; e.currentTarget.style.background = "var(--color-surface, #ffffff)"; }}
              onBlur={e => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.background = "var(--color-surface-light, #f8f9fb)"; }}
              placeholder={t("Поиск товаров…", "Mahsulot qidirish…")}
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          {/* Table */}
          {isMobile ? (
            <div className="space-y-3">
              {isLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-28 rounded-2xl animate-pulse" style={{ background: "var(--color-surface-light, #f8f9fb)" }} />
                  ))
                : data?.data.map((item: any) => {
                    const low = Number(item.available ?? 0) < Number(item.reorderPoint ?? 0);
                    return (
                      <div key={item.id} className="rounded-2xl overflow-hidden"
                        style={{ background: "var(--color-surface, #ffffff)", boxShadow: "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06))" }}>
                        <div className="flex">
                          {low && <div className="w-1.5 flex-shrink-0" style={{ background: "#f87171" }} />}
                          <div className="flex-1 p-5">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                {low && <AlertTriangle size={14} color="#f87171" />}
                                <p className="text-sm font-semibold" style={{ color: "var(--color-text-primary, #111827)" }}>{item.productName}</p>
                              </div>
                              <button onClick={() => setAdjusting({ id: item.productId, name: item.productName ?? "", stock: Number(item.currentStock ?? 0), unit: item.unit ?? "pcs", unitWeight: Number(item.unitWeight ?? 0) })}
                                className="text-xs py-1.5 px-3 rounded-lg transition-colors" style={{ color: "#818cf8", background: "rgba(129,140,248,0.08)" }}>
                                {t("Скорр.", "Tuzatish")}
                              </button>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                              {[
                                { label: t("Доступно", "Mavjud"), val: item.available, unit: item.unit, danger: low },
                                { label: t("Резерв", "Zahira"), val: item.reserved, unit: item.unit, danger: false },
                                { label: t("Всего", "Jami"), val: item.currentStock, unit: item.unit, danger: false },
                              ].map(col => (
                                <div key={col.label}>
                                  <p className="text-lg font-bold" style={{ color: col.danger ? "#f87171" : "var(--color-text-primary, #111827)", fontFamily: "'DM Sans', sans-serif" }}>
                                    {Number(col.val ?? 0).toFixed(0)} <span className="text-xs font-normal" style={{ color: "var(--color-text-tertiary, #9ca3af)" }}>{unitLabel(col.unit, lang)}</span>
                                  </p>
                                  <p className="text-[10px] mt-0.5" style={{ color: "var(--color-text-tertiary, #9ca3af)" }}>{col.label}</p>
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
                        style={{ color: "var(--color-text-tertiary, #9ca3af)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid #f3f4f6" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i}><td colSpan={9} className="px-5 py-4">
                          <div className="h-5 rounded-lg animate-pulse" style={{ background: "var(--color-surface-light, #f8f9fb)" }} />
                        </td></tr>
                      ))
                    : data?.data.length === 0
                    ? <tr><td colSpan={9} className="text-center py-16 text-sm" style={{ color: "var(--color-text-tertiary, #9ca3af)" }}>
                        {t("Нет товаров на складе","Omborda mahsulot yo'q")}
                      </td></tr>
                    : data?.data.map((item: any) => {
                        const low = Number(item.available ?? 0) < Number(item.reorderPoint ?? 0);
                        return (
                          <tr key={item.id} style={low ? { background: "rgba(248,113,113,0.03)" } : undefined}>
                            <td className="px-5 py-3.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                              <div className="flex items-center gap-2.5">
                                {low && <AlertTriangle size={13} color="#f87171" />}
                                <span className="text-sm font-medium" style={{ color: "var(--color-text-primary, #111827)" }}>{item.productName}</span>
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-xs" style={{ color: "var(--color-text-tertiary, #9ca3af)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid #f3f4f6" }}>
                              {item.productCode}
                            </td>
                            <td className="px-5 py-3.5 text-sm" style={{ color: "var(--color-text-secondary, #6b7280)", borderBottom: "1px solid #f3f4f6" }}>
                              {item.category ?? "—"}
                            </td>
                            <td className="px-5 py-3.5 text-sm font-bold" style={{ color: low ? "#f87171" : "var(--color-text-primary, #111827)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid #f3f4f6" }}>
                              {Number(item.available ?? 0).toFixed(2)} {unitLabel(item.unit ?? undefined, lang)}
                            </td>
                            <td className="px-5 py-3.5 text-sm" style={{ color: "var(--color-text-secondary, #6b7280)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid #f3f4f6" }}>
                              {toKg(item.available, item.unitWeight).toFixed(1)} кг
                            </td>
                            <td className="px-5 py-3.5 text-sm" style={{ color: "var(--color-text-secondary, #6b7280)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid #f3f4f6" }}>
                              {Number(item.reserved ?? 0).toFixed(2)} {unitLabel(item.unit ?? undefined, lang)}
                            </td>
                            <td className="px-5 py-3.5 text-sm" style={{ color: "var(--color-text-primary, #111827)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid #f3f4f6" }}>
                              {Number(item.currentStock ?? 0).toFixed(2)} {unitLabel(item.unit ?? undefined, lang)}
                            </td>
                            <td className="px-5 py-3.5 text-sm" style={{ color: "var(--color-text-tertiary, #9ca3af)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid #f3f4f6" }}>
                              {Number(item.reorderPoint ?? 0).toFixed(0)} {unitLabel(item.unit ?? undefined, lang)}
                            </td>
                            <td className="px-5 py-3.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                              <button onClick={() => setAdjusting({ id: item.productId, name: item.productName ?? "", stock: Number(item.currentStock ?? 0), unit: item.unit ?? "pcs", unitWeight: Number(item.unitWeight ?? 0) })}
                                className="text-xs py-1.5 px-3 rounded-lg transition-all"
                                style={{ color: "#818cf8", background: "rgba(129,140,248,0.08)" }}>
                                {t("Скорректировать", "Tuzatish")}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  {!isLoading && data?.data.map((item: any) => (
                    <tr key={`hist-${item.id}`}>
                      <td colSpan={8} className="p-0" style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <MovementHistory productId={item.productId} productName={item.productName ?? ""} />
                      </td>
                    </tr>
                  ))}
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
            <span className="text-xs font-medium" style={{ color: "var(--color-text-tertiary, #9ca3af)" }}>
              {t("Без продаж более", "Sotilmasdan ko'proq")}:
            </span>
            {[7, 14, 30, 60, 90].map(d => (
              <button key={d} onClick={() => setDeadStockDays(d)}
                className="text-xs py-1.5 px-3 rounded-lg font-medium transition-all"
                style={{
                  background: deadStockDays === d ? "#818cf8" : "var(--color-surface-light, #f8f9fb)",
                  color: deadStockDays === d ? "#fff" : "var(--color-text-tertiary, #9ca3af)",
                }}>
                {d} {t("дн", "kun")}
              </button>
            ))}
          </div>

          {deadStockLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: "var(--color-surface-light, #f8f9fb)" }} />
              ))}
            </div>
          ) : !deadStockItems?.length ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(74,222,128,0.1)" }}>
                <Package size={28} color="#4ade80" />
              </div>
              <p className="text-sm font-medium" style={{ color: "var(--color-text-primary, #111827)" }}>
                {t("Нет мёртвого стока", "O'lik stok yo'q")}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary, #9ca3af)" }}>
                {t("Все товары продаются в течение", "Barcha mahsulotlar sotilmoqda")} {deadStockDays} {t("дней", "kun")}.
              </p>
            </div>
          ) : isMobile ? (
            <div className="space-y-3">
              {deadStockItems.map((item: any, i: any) => {
                const days = Number(item.daysSinceOrder ?? 99999);
                const isUrgent = days > 90;
                const isWarning = days > 30;
                const bgColor = isUrgent ? "rgba(248,113,113,0.06)" : isWarning ? "rgba(251,191,36,0.06)" : "var(--color-surface, #ffffff)";
                const borderColor = isUrgent ? "rgba(248,113,113,0.15)" : isWarning ? "rgba(251,191,36,0.15)" : "var(--color-border, #f3f4f6)";
                const badgeColor = isUrgent ? "#f87171" : isWarning ? "#fbbf24" : "#818cf8";
                return (
                  <div key={item.productId} className="rounded-2xl p-4" style={{ background: bgColor, boxShadow: `inset 0 0 0 1px ${borderColor}`, animation: `slideUp ${0.3 + i * 0.05}s ease forwards` }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Clock size={14} color={badgeColor} />
                        <span className="text-sm font-semibold" style={{ color: "var(--color-text-primary, #111827)" }}>{item.productName}</span>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: `${badgeColor}15`, color: badgeColor }}>
                        {days === 99999 ? t("Никогда", "Hech qachon") : `${days} ${t("дн", "kun")}`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: "var(--color-text-tertiary, #9ca3af)" }}>
                        {t("Остаток:", "Qoldiq:")} {Number(item.currentStock ?? 0).toFixed(2)} {item.unit ?? "кг"}
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
                        style={{ color: "var(--color-text-tertiary, #9ca3af)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid #f3f4f6" }}>
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
                    const rowBg = isUrgent ? "rgba(248,113,113,0.04)" : isWarning ? "rgba(251,191,36,0.04)" : undefined;
                    const badgeColor = isUrgent ? "#f87171" : isWarning ? "#fbbf24" : "#818cf8";
                    return (
                      <tr key={item.productId} style={{ background: rowBg }}>
                        <td className="px-5 py-3.5 text-sm font-medium" style={{ color: "var(--color-text-primary, #111827)", borderBottom: "1px solid #f3f4f6" }}>
                          <div className="flex items-center gap-2">
                            <Clock size={13} color={badgeColor} />
                            {item.productName}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-xs" style={{ color: "var(--color-text-tertiary, #9ca3af)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid #f3f4f6" }}>
                          {item.productCode}
                        </td>
                        <td className="px-5 py-3.5 text-sm" style={{ color: "var(--color-text-secondary, #6b7280)", borderBottom: "1px solid #f3f4f6" }}>
                          {item.category ?? "—"}
                        </td>
                        <td className="px-5 py-3.5 text-sm font-bold" style={{ color: "var(--color-text-primary, #111827)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid #f3f4f6" }}>
                          {Number(item.currentStock ?? 0).toFixed(2)} {unitLabel(item.unit ?? undefined, lang)}
                        </td>
                        <td className="px-5 py-3.5 text-sm font-bold" style={{ color: badgeColor, fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid #f3f4f6" }}>
                          {fmt(Number(item.value ?? 0).toFixed(0))}
                        </td>
                        <td className="px-5 py-3.5 text-xs" style={{ color: "var(--color-text-tertiary, #9ca3af)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid #f3f4f6" }}>
                          {item.lastOrderDate ? format(new Date(item.lastOrderDate), "dd.MM.yyyy") : t("Никогда", "Hech qachon")}
                        </td>
                        <td className="px-5 py-3.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
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
            <div className="flex items-center justify-between text-xs px-2" style={{ color: "var(--color-text-tertiary, #9ca3af)" }}>
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
                <ShoppingCart size={28} color="#4ade80" />
              </div>
              <p className="text-sm font-medium" style={{ color: "var(--color-text-primary, #111827)" }}>
                {t("Все товары в наличии", "Barcha mahsulotlar mavjud")}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary, #9ca3af)" }}>
                {t("Нет товаров, требующих дозаказа", "Qayta buyurtma kerak bo'lgan mahsulot yo'q")}
              </p>
            </div>
          ) : isMobile ? (
            <div className="space-y-3">
              {reorderSuggestions.map((item: any, i: any) => {
                const daysLeft = Number(item.daysUntilStockout ?? 999);
                const isUrgent = daysLeft <= 3;
                const isWarning = daysLeft <= 7;
                const badgeColor = isUrgent ? "#f87171" : isWarning ? "#fbbf24" : "#818cf8";
                return (
                  <div key={item.productId} className="rounded-2xl overflow-hidden" style={{ animation: `slideUp ${0.3 + i * 0.05}s ease forwards` }}>
                    <div className="flex">
                      <div className="w-1.5 flex-shrink-0" style={{ background: badgeColor }} />
                      <div className="flex-1 p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold" style={{ color: "var(--color-text-primary, #111827)" }}>{item.productName}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: `${badgeColor}15`, color: badgeColor }}>
                            {daysLeft} {t("дн до конца", "kun qoldi")}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs" style={{ color: "var(--color-text-tertiary, #9ca3af)" }}>
                          <span>{t("Остаток:", "Qoldiq:")} {Number(item.currentStock ?? 0).toFixed(1)} / {Number(item.reorderPoint ?? 0).toFixed(0)} {item.unit ?? "кг"}</span>
                          <span className="font-semibold" style={{ color: badgeColor }}>+{item.suggestedQty} {item.unit ?? "кг"}</span>
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
                        style={{ color: "var(--color-text-tertiary, #9ca3af)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid #f3f4f6" }}>
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
                    const badgeColor = isUrgent ? "#f87171" : isWarning ? "#fbbf24" : "#818cf8";
                    const rowBg = isUrgent ? "rgba(248,113,113,0.04)" : isWarning ? "rgba(251,191,36,0.04)" : undefined;
                    return (
                      <tr key={item.productId} style={{ background: rowBg }}>
                        <td className="px-5 py-3.5 text-sm font-medium" style={{ color: "var(--color-text-primary, #111827)", borderBottom: "1px solid #f3f4f6" }}>
                          <div className="flex items-center gap-2">
                            {isUrgent && <AlertTriangle size={13} color="#f87171" />}
                            {item.productName}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-sm font-bold" style={{ color: badgeColor, fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid #f3f4f6" }}>
                          {Number(item.currentStock ?? 0).toFixed(1)} {item.unit ?? "кг"}
                        </td>
                        <td className="px-5 py-3.5 text-sm" style={{ color: "var(--color-text-tertiary, #9ca3af)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid #f3f4f6" }}>
                          {Number(item.reorderPoint ?? 0).toFixed(0)} {item.unit ?? "кг"}
                        </td>
                        <td className="px-5 py-3.5 text-sm" style={{ color: "var(--color-text-secondary, #6b7280)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid #f3f4f6" }}>
                          {item.avgDailySales}
                        </td>
                        <td className="px-5 py-3.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                          <span className="text-xs px-2.5 py-1 rounded-full font-semibold"
                            style={{ background: `${badgeColor}15`, color: badgeColor }}>
                            {daysLeft} {t("дн", "kun")}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-sm font-bold" style={{ color: badgeColor, fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid #f3f4f6" }}>
                          +{item.suggestedQty} {item.unit ?? "кг"}
                        </td>
                        <td className="px-5 py-3.5 text-sm font-bold" style={{ color: "var(--color-text-primary, #111827)", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid #f3f4f6" }}>
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
            <div className="flex items-center justify-between text-xs px-2" style={{ color: "var(--color-text-tertiary, #9ca3af)" }}>
              <span>{reorderSuggestions.length} {t("товаров", "mahsulot")}</span>
              <span>{t("Общая стоимость дозаказа:", "Umumiy buyurtma qiymati:")} {fmt(reorderSuggestions.reduce((acc: number, r: any) => acc + Number(r.suggestedCost ?? 0), 0).toFixed(0))}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
