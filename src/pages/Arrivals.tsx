import { memo, useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { format } from "date-fns";
import {
  Plus, X, Search, FileDown, ChevronDown, ChevronUp, Loader2,
  ArrowUpRight, ArrowDownRight, Minus, Truck, Package, CheckCircle2, Clock,
} from "lucide-react";
import { exportToExcel, formatArrivalsForExport } from "@/lib/excel";
import { notify } from "@/lib/toast";
import { PremiumSelect } from "@/components/PremiumSelect";

const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };
const COLORS = {
  primary: "#4b6cf6", success: "#34c473",
  warning: "#e8a830", danger: "#e85050",
  surface: "var(--color-surface, #ffffff)", surfaceLight: "var(--color-surface-light, #f0f3f8)",
  textPrimary: "var(--color-text-primary, #2b3450)", textSecondary: "var(--color-text-secondary, #6a7290)",
  textTertiary: "var(--color-text-tertiary, #98a0b8)", border: "var(--color-border, #f0f3f8)",
};
const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

function KpiCard({ label, value, delta, icon, gradient, delay }: {
  label: string; value: string; delta: number | null;
  icon: React.ReactNode; gradient: string; delay: number;
}) {
  const isPositive = delta !== null && delta > 0;
  const isNegative = delta !== null && delta < 0;
  return (
    <div className="kpi-hero" style={{
      borderRadius: "24px", padding: "24px",
      position: "relative", overflow: "hidden",
      animation: `slideUp ${0.5 + delay}s ease forwards`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>
          {label}
        </span>
        <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {icon}
        </div>
      </div>
      <div style={{ fontFamily: F.display, fontSize: "32px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, letterSpacing: "-0.03em" }}>
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

const UNIT_LABELS: Record<string, string> = { kg: "кг", l: "л", pcs: "шт", box: "ящ", pack: "упак", m: "м" };
function unitLabel(unit: string | undefined): string { return UNIT_LABELS[unit ?? "pcs"] ?? "шт"; }

const STATUS: Record<string, { ru: string; uz: string; color: string }> = {
  pending:   { ru: "Ожидает", uz: "Kutilmoqda", color: "#e8a830" },
  unloading: { ru: "Разгрузка", uz: "Tushirilmoqda", color: "#60a5fa" },
  completed: { ru: "Завершён", uz: "Yakunlandi", color: "#34c473" },
};

const StatusBadge = memo(function StatusBadge({ status, lang }: { status: string; lang: "ru" | "uz" }) {
  const s = STATUS[status] ?? STATUS.pending;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 12px",
      borderRadius: "24px", fontSize: "11px", fontWeight: 600,
      background: `${s.color}12`, color: s.color, fontFamily: F.body,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color }} />
      {lang === "uz" ? s.uz : s.ru}
    </span>
  );
});

// ── Arrival Form ─────────────────────────────────────────────────────────────
function ArrivalForm({ onSave, onClose, isPending }: { onSave: (d: Record<string, unknown> & { items: Array<Record<string, string | number>> }) => void; onClose: () => void; isPending: boolean }) {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const { data: products } = trpc.product.list.useQuery({ page: 1, pageSize: 200 }) as { data: any };

  const [form, setForm] = useState({
    truckId: "", driverName: "", driverPhone: "",
    arrivalDate: new Date().toISOString().split("T")[0],
    fuelCost: "0", tollCost: "0", otherCost: "0", notes: "",
  });
  const [items, setItems] = useState<{ productId: number; quantity: string; costPrice: string; condition: string; unit: string; unitWeight: number }[]>([
    { productId: 0, quantity: "", costPrice: "", condition: "Хорошее", unit: "pcs", unitWeight: 0 },
  ]);

  const totalExpense = Number(form.fuelCost) + Number(form.tollCost) + Number(form.otherCost);
  const totalWeight = items.reduce((s, i) => s + Number(i.quantity || 0) * (i.unitWeight || 1), 0);
  const totalCost = items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.costPrice || 0), 0);

  const addItem = () => setItems(p => [...p, { productId: 0, quantity: "", costPrice: "", condition: "Хорошее", unit: "pcs", unitWeight: 0 }]);
  const removeItem = (i: number) => setItems(p => p.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: string, val: string | number) => {
    setItems(p => p.map((item, idx) => {
      if (idx !== i) return item;
      const updated = { ...item, [field]: val };
      if (field === "productId") {
        const product = products?.data?.find((pr: any) => pr.id === Number(val));
        if (product) {
          updated.unit = product.unit ?? "pcs";
          updated.unitWeight = Number(product.unitWeight ?? 0);
          updated.costPrice = product.costPrice ?? "";
        }
      }
      return updated;
    }));
  };

  const inputCls = "neo-input";
  const sectionLabel = "font-label text-[10px] tracking-wider uppercase mb-3 block";

  return createPortal(
    <>
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, backgroundColor: "rgba(0,0,0,0.75)" }} onClick={onClose} />

    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 overflow-y-auto">

      {/* Modal */}
      <div className="relative w-full max-w-[720px] max-h-[90vh] overflow-y-auto neo-card animate-scale-in" style={{ borderRadius: "24px", boxShadow: "0 25px 80px -12px rgba(0,0,0,0.35)" }}>

        {/* Gradient header */}
        <div className="relative overflow-hidden" style={{ background: "var(--color-primary, #4b6cf6)", borderRadius: "24px 24px 0 0", padding: "28px 32px 24px" }}>
          <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }} />
          <div className="absolute -bottom-8 -left-8 w-24 h-24 rounded-full" style={{ background: "rgba(255,255,255,0.05)" }} />
          <div className="relative flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white mb-0.5">{t("Новый приход", "Yangi kelish")}</h2>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.7)" }}>{t("Поступление товаров на склад", "Omborga mahsulot kiritish")}</p>
            </div>
            <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-110" style={{ background: "rgba(255,255,255,0.15)", color: "#fff", border: "none", cursor: "pointer" }}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-8 space-y-7">
          {/* Truck data */}
          <div>
            <p className={sectionLabel}>{t("Данные машины", "Mashina ma'lumotlari")}</p>
            <div className="grid grid-cols-3 gap-3">
              <input className="neo-input" placeholder={t("Номер машины", "Mashina raqami")} value={form.truckId} onChange={e => setForm(p => ({ ...p, truckId: e.target.value }))} />
              <input className="neo-input" placeholder={t("Имя водителя", "Haydovchi ismi")} value={form.driverName} onChange={e => setForm(p => ({ ...p, driverName: e.target.value }))} />
              <input className="neo-input" placeholder={t("Телефон", "Telefon")} value={form.driverPhone} onChange={e => setForm(p => ({ ...p, driverPhone: e.target.value }))} />
            </div>
          </div>

          {/* Date & expenses */}
          <div>
            <p className={sectionLabel}>{t("Дата и расходы", "Sana va xarajatlar")}</p>
            <div className="grid grid-cols-4 gap-3 mb-3">
              <div>
                <label className="font-label text-[10px] text-text-secondary mb-1.5 block">{t("Дата", "Sana")}</label>
                <input type="date" className="neo-input" value={form.arrivalDate} onChange={e => setForm(p => ({ ...p, arrivalDate: e.target.value }))} />
              </div>
              {[
                { key: "fuelCost", label: t("Топливо", "Yo'qilgi") },
                { key: "tollCost", label: t("Дорога", "Yo'l") },
                { key: "otherCost", label: t("Прочее", "Boshqa") },
              ].map(f => (
                <div key={f.key}>
                  <label className="font-label text-[10px] text-text-secondary mb-1.5 block">{f.label}</label>
                  <input type="number" step="0.01" className="neo-input" style={{ textAlign: "right" }} placeholder="0" value={(form as Record<string, unknown>)[f.key] as string} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: "var(--color-primary-subtle, rgba(75,108,246,.10))" }}>
              <span className="text-sm text-text-secondary font-medium">{t("Итого расходов:", "Jami xarajatlar:")}</span>
              <span className="text-lg font-bold text-primary font-data">{fmt(totalExpense.toFixed(0))}</span>
            </div>
          </div>

          {/* Products */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className={sectionLabel} style={{ marginBottom: 0 }}>{t("Товары", "Tovarlar")}</p>
              <div className="flex gap-4">
                {totalWeight > 0 && <span className="text-xs font-semibold text-text-secondary">{totalWeight.toFixed(2)} кг</span>}
                {totalCost > 0 && <span className="text-xs font-semibold text-primary font-data">{fmt(totalCost.toFixed(0))}</span>}
              </div>
            </div>
            <div className="space-y-3">
              {items.map((item, i) => (
                <div key={i} className="neo-card-sm p-4 space-y-3" style={{ border: "1px solid var(--color-border, #f0f3f8)", borderRadius: "16px" }}>
                  <PremiumSelect value={String(item.productId)} onChange={v => updateItem(i, "productId", Number(v))}
                    options={[{ value: "0", label: t("Выберите товар…", "Mahsulot tanlang…") }, ...(products?.data ?? []).map((p: any) => ({ value: String(p.id), label: `${p.name} · ${fmt(p.unitPrice)}/${unitLabel(p.unit)}` }))]}
                    width="100%" />
                  <div className="grid grid-cols-4 gap-3 items-end">
                    <div>
                      <label className="font-label text-[10px] text-text-secondary mb-1.5 block">{t("Кол-во", "Miqdor")}</label>
                      <div className="flex items-center gap-2">
                        <input type="number" className="neo-input" style={{ width: 72, textAlign: "center", padding: "8px 10px" }} placeholder="0" value={item.quantity} onChange={e => updateItem(i, "quantity", e.target.value)} />
                        <span className="text-xs text-text-tertiary">{unitLabel(item.unit)}</span>
                      </div>
                    </div>
                    <div>
                      <label className="font-label text-[10px] text-text-secondary mb-1.5 block">{t("Себестоимость", "Tannarx")}</label>
                      <input type="number" step="0.01" className="neo-input" style={{ textAlign: "right", padding: "8px 10px" }} placeholder={t("цена/ед", "narx/dona")} value={item.costPrice} onChange={e => updateItem(i, "costPrice", e.target.value)} />
                    </div>
                    <div>
                      <label className="font-label text-[10px] text-text-secondary mb-1.5 block">{t("Состояние", "Holat")}</label>
                      <input className="neo-input" style={{ padding: "8px 10px" }} placeholder={t("Хорошее", "Yaxshi")} value={item.condition} onChange={e => updateItem(i, "condition", e.target.value)} />
                    </div>
                    <div className="flex justify-end">
                      {items.length > 1 && (
                        <button onClick={() => removeItem(i)} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-red-50" style={{ border: "none", background: "transparent", color: "#e85050", cursor: "pointer" }}>
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={addItem} className="mt-3 w-full py-3 rounded-xl border-2 border-dashed flex items-center justify-center gap-2 text-sm font-medium transition-all hover:border-primary hover:text-primary hover:bg-primary/5" style={{ borderColor: "var(--color-border-strong, #d1d5db)", color: "var(--color-text-secondary, #6a7290)", background: "transparent", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
              <Plus size={16} /> {t("Добавить товар", "Mahsulot qo'shish")}
            </button>
          </div>

          {/* Notes */}
          <div>
            <label className={sectionLabel}>{t("Примечания", "Izohlar")}</label>
            <textarea className="neo-input" style={{ resize: "none", minHeight: 60 }} rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder={t("Дополнительная информация…", "Qo'shimcha ma'lumot…")} />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button onClick={() => form.arrivalDate && onSave({ ...form, items: items.filter(i => i.productId > 0 && Number(i.quantity) > 0).map(i => ({ productId: i.productId, quantity: i.quantity, costPrice: i.costPrice, condition: i.condition })) })}
              disabled={isPending || !form.arrivalDate}
              className="neo-btn-primary flex-1 h-12 text-sm flex items-center justify-center gap-2"
              style={{ opacity: isPending || !form.arrivalDate ? 0.5 : 1 }}>
              {isPending && <Loader2 size={15} className="animate-spin" />}
              {t("Сохранить", "Saqlash")}
            </button>
            <button onClick={onClose} className="neo-btn flex-1 h-12 text-sm">
              {t("Отмена", "Bekor qilish")}
            </button>
          </div>
        </div>
      </div>
    </div>
    </>,
    document.body
  );
}

// ── Receipt ──────────────────────────────────────────────────────────────────
function ArrivalReceipt({ arrival }: { arrival: { id: number } }) {
  const [open, setOpen] = useState(false);
  useCurrency();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const { data: detail } = trpc.arrival.getById.useQuery({ id: arrival.id }, { enabled: open }) as { data: any };

  return (
    <div>
      <button onClick={() => setOpen(v => !v)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", border: "none", background: "transparent", cursor: "pointer", color: COLORS.textTertiary, fontSize: "12px", fontFamily: F.body }}>
        <span>{t("Накладная", "Hujjat")}</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && detail?.items && (
        <div style={{ padding: "0 20px 16px" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>{[t("Товар", "Mahsulot"), t("Код", "Kod"), t("Кол-во", "Miqdor"), t("Состояние", "Holat")].map(h => (
                <th key={h} style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: COLORS.textTertiary, padding: "8px 12px", textAlign: "left", borderBottom: `1px solid ${COLORS.border}` }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {detail.items.map((raw: any, i: number) => {
                const item = raw as Record<string, unknown>;
                return (
                <tr key={i}>
                  <td style={{ padding: "10px 12px", fontSize: "13px", color: COLORS.textPrimary, borderBottom: `1px solid ${COLORS.border}` }}>{String(item.productName)}</td>
                  <td style={{ padding: "10px 12px", fontSize: "12px", color: COLORS.textTertiary, borderBottom: `1px solid ${COLORS.border}` }}>{String(item.productCode)}</td>
                  <td style={{ padding: "10px 12px", fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary, borderBottom: `1px solid ${COLORS.border}` }}>{Number(item.quantity).toFixed(2)}</td>
                  <td style={{ padding: "10px 12px", fontSize: "13px", color: COLORS.textSecondary, borderBottom: `1px solid ${COLORS.border}` }}>{String(item.condition ?? "—")}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function Arrivals() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [showForm, setShowForm] = useState(false);
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const t = useCallback((ru: string, uz: string) => lang === "uz" ? uz : ru, [lang]);

  const { data, isLoading } = trpc.arrival.list.useQuery({ page, pageSize: 25, status: (status || undefined) as any }) as { data: any; isLoading: boolean };
  const { data: all } = trpc.arrival.list.useQuery({ page: 1, pageSize: 500 }) as { data: any };
  const utils = trpc.useUtils();

  const createMutation = trpc.arrival.create.useMutation({
    onSuccess: () => { utils.arrival.list.invalidate(); setShowForm(false); notify.success(t("Приход добавлен", "Kelish qo'shildi")); },
    onError: (e) => notify.error(e.message),
  });
  const updateStatus = trpc.arrival.update.useMutation({
    onSuccess: () => { utils.arrival.list.invalidate(); notify.success(t("Статус обновлён", "Holat yangilandi")); },
    onError: (e) => notify.error(e.message),
  });

  const arrivals = data?.data ?? [];
  const kpis = useMemo(() => {
    const total = arrivals.length;
    const totalExpenses = arrivals.reduce((s: number, a: any) => s + Number(a.totalExpense ?? 0), 0);
    const completed = arrivals.filter((a: any) => a.status === "completed").length;
    const pending = arrivals.filter((a: any) => a.status === "pending").length;
    return { total, totalExpenses, completed, pending };
  }, [arrivals]);

  const thStyle: React.CSSProperties = {
    fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase",
    letterSpacing: "0.08em", color: COLORS.textTertiary, padding: "14px 16px",
    borderBottom: `1px solid ${COLORS.border}`, textAlign: "left",
  };
  const tdStyle: React.CSSProperties = {
    padding: "14px 16px", borderBottom: `1px solid ${COLORS.border}`,
    fontSize: "13px", fontFamily: F.body, color: COLORS.textPrimary,
  };

  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ height: "28px", width: "200px", borderRadius: "8px", background: COLORS.surfaceLight, marginBottom: "8px" }} />
            <div style={{ height: "16px", width: "280px", borderRadius: "6px", background: COLORS.surfaceLight }} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ height: "140px", borderRadius: "24px", background: COLORS.surfaceLight, animation: `slideUp ${0.4 + i * 0.05}s ease forwards` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {showForm && <ArrivalForm onSave={(d: any) => createMutation.mutate(d)} onClose={() => setShowForm(false)} isPending={createMutation.isPending} />}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.025em", margin: 0 }}>
            {t("Приходы", "Kelishlar")}
          </h1>
          <p style={{ fontSize: "13px", color: COLORS.textSecondary, margin: "4px 0 0" }}>
            {t("Поступление товаров на склад", "Omborga mahsulot kelishi")}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button onClick={() => all?.data && exportToExcel(formatArrivalsForExport(all.data), "arrivals")} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
            fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
            border: `1px solid ${COLORS.border}`, cursor: "pointer",
            background: COLORS.surface, color: COLORS.textSecondary,
          }}>
            <FileDown size={14} /> Excel
          </button>
          <button onClick={() => setShowForm(true)} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 16px",
            fontSize: "13px", fontWeight: 600, fontFamily: F.body, borderRadius: "10px",
            border: "none", cursor: "pointer", color: "#fff",
            background: "linear-gradient(135deg, #4b6cf6, #8b5cf6)",
            boxShadow: "0 4px 16px rgba(75,108,246,0.3)",
          }}>
            <Plus size={15} /> {t("Новый приход", "Yangi kelish")}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
        <KpiCard
          label={t("ВСЕГО ПРИХОДОВ", "JAMI KELISHLAR")}
          value={String(kpis.total)}
          delta={null}
          icon={<Package size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #4b6cf6, #4b6cf6)"
          delay={0}
        />
        <KpiCard
          label={t("РАСХОДЫ", "XARAJATLAR")}
          value={fmt(kpis.totalExpenses)}
          delta={null}
          icon={<Truck size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #fb923c, #f97316)"
          delay={0.05}
        />
        <KpiCard
          label={t("ЗАВЕРШЕНЫ", "YAKUNLANDI")}
          value={String(kpis.completed)}
          delta={null}
          icon={<CheckCircle2 size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #16a34a, #22c47a)"
          delay={0.1}
        />
        <KpiCard
          label={t("ОЖИДАНИЕ", "KUTILMOQDA")}
          value={String(kpis.pending)}
          delta={null}
          icon={<Clock size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #e8a830, #f59e0b)"
          delay={0.15}
        />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: COLORS.textTertiary }} />
          <input style={{
            padding: "10px 14px 10px 36px", borderRadius: "12px", fontSize: "13px",
            background: COLORS.surfaceLight, border: "none", color: COLORS.textPrimary,
            outline: "none", width: "100%", fontFamily: F.body,
          }} placeholder={t("Поиск приходов…", "Kelishlarni qidirish…")} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <PremiumSelect value={status} onChange={v => { setStatus(v); setPage(1); }}
          options={[{ value: "", label: t("Все статусы", "Barcha holatlar") }, { value: "pending", label: t("Ожидает", "Kutilmoqda") }, { value: "unloading", label: t("Разгрузка", "Tushirilmoqda") }, { value: "completed", label: t("Завершён", "Yakunlandi") }]}
          width="180px" />
      </div>

      {/* Table */}
      <div style={{ background: COLORS.surface, borderRadius: "24px", boxShadow: SHADOW, overflow: "hidden", animation: "slideUp 0.5s ease forwards" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr>
              {[t("ПРИХОД", "KELISH"), t("ДАТА", "SANA"), t("МАШИНА", "MASHINA"), t("ВОДИТЕЛЬ", "HAYDOVCHI"), t("РАСХОДЫ", "XARAJAT"), t("СТАТУС", "HOLAT")].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}><td colSpan={6} style={{ padding: "16px" }}><div style={{ height: 16, background: COLORS.surfaceLight, borderRadius: 8, width: "60%" }} /></td></tr>
            )) : arrivals.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: "center", padding: "48px 16px", color: COLORS.textTertiary, fontSize: "14px" }}>{t("Нет приходов", "Kelishlar yo'q")}</td></tr>
            ) : arrivals.map((a: any) => (
              <tr key={a.id} style={{ transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(75,108,246,0.02)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                <td style={{ ...tdStyle, fontWeight: 500 }}>{a.arrivalNumber}</td>
                <td style={{ ...tdStyle, color: COLORS.textSecondary }}>{a.arrivalDate ? format(new Date(a.arrivalDate), "dd.MM.yyyy") : "—"}</td>
                <td style={{ ...tdStyle, color: COLORS.textSecondary }}>{a.truckId ?? "—"}</td>
                <td style={{ ...tdStyle, color: COLORS.textSecondary }}>{a.driverName ?? "—"}</td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{fmt(a.totalExpense ?? 0)}</td>
                <td style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <StatusBadge status={a.status ?? "pending"} lang={lang as "ru" | "uz"} />
                    {a.status === "pending" && <button onClick={() => updateStatus.mutate({ id: a.id, status: "unloading" })} style={{ padding: "6px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: 600, fontFamily: F.body, color: COLORS.primary, background: "rgba(75,108,246,0.08)", border: "none", cursor: "pointer" }}>{t("Разгрузка", "Tushirish")}</button>}
                    {a.status === "unloading" && <button onClick={() => updateStatus.mutate({ id: a.id, status: "completed" })} style={{ padding: "6px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: 600, fontFamily: F.body, color: "#fff", background: "linear-gradient(135deg, #4b6cf6, #8b5cf6)", border: "none", cursor: "pointer" }}>{t("Завершить", "Yakunlash")}</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Receipt rows */}
        {!isLoading && (data?.data ?? []).map((a: any) => (
          <div key={`r-${a.id}`} style={{ borderTop: "1px solid var(--color-border, #f0f3f8)" }}>
            <ArrivalReceipt arrival={a} />
          </div>
        ))}
      </div>

      {/* Pagination */}
      {data && data.total > 25 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "13px", color: COLORS.textSecondary }}>{data.total} {t("всего", "jami")}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{
              padding: "8px 16px", borderRadius: "10px", fontSize: "13px", fontFamily: F.body,
              color: COLORS.textSecondary, border: "none", cursor: "pointer",
              background: COLORS.surfaceLight, opacity: page === 1 ? 0.5 : 1,
            }}>{t("Назад", "Orqaga")}</button>
            <button onClick={() => setPage(p => p + 1)} disabled={page * 25 >= data.total} style={{
              padding: "8px 16px", borderRadius: "10px", fontSize: "13px", fontFamily: F.body,
              color: COLORS.textSecondary, border: "none", cursor: "pointer",
              background: COLORS.surfaceLight, opacity: page * 25 >= data.total ? 0.5 : 1,
            }}>{t("Далее", "Keyingi")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
