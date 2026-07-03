import { memo, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { format } from "date-fns";
import { Plus, X, Search, FileDown, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { exportToExcel, formatArrivalsForExport } from "@/lib/excel";
import { notify } from "@/lib/toast";
import { PremiumSelect } from "@/components/PremiumSelect";

const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };
const SHADOW = "0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04)";

const UNIT_LABELS: Record<string, string> = { kg: "кг", l: "л", pcs: "шт", box: "ящ", pack: "упак", m: "м" };
function unitLabel(unit: string | undefined): string { return UNIT_LABELS[unit ?? "pcs"] ?? "шт"; }

const STATUS: Record<string, { ru: string; uz: string; color: string }> = {
  pending:   { ru: "Ожидает", uz: "Kutilmoqda", color: "#F59E0B" },
  unloading: { ru: "Разгрузка", uz: "Tushirilmoqda", color: "#3B82F6" },
  completed: { ru: "Завершён", uz: "Yakunlandi", color: "#10B981" },
};

const StatusBadge = memo(function StatusBadge({ status, lang }: { status: string; lang: "ru" | "uz" }) {
  const s = STATUS[status] ?? STATUS.pending;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 12px",
      borderRadius: "20px", fontSize: "11px", fontWeight: 600,
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

  const inputCls = "input-field";
  const sectionLabel = "font-label text-[10px] tracking-wider uppercase mb-3 block";

  return createPortal(
    <>
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, backgroundColor: "rgba(0,0,0,0.75)" }} onClick={onClose} />

    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 overflow-y-auto">

      {/* Modal */}
      <div className="relative w-full max-w-[720px] max-h-[90vh] overflow-y-auto glass-modal animate-scale-in" style={{ borderRadius: "24px", boxShadow: "0 25px 80px -12px rgba(0,0,0,0.35)" }}>

        {/* Gradient header */}
        <div className="relative overflow-hidden" style={{ background: "linear-gradient(135deg, #5558e8, #7c3aed, #a78bfa)", borderRadius: "24px 24px 0 0", padding: "28px 32px 24px" }}>
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
              <input className={inputCls} placeholder={t("Номер машины", "Mashina raqami")} value={form.truckId} onChange={e => setForm(p => ({ ...p, truckId: e.target.value }))} />
              <input className={inputCls} placeholder={t("Имя водителя", "Haydovchi ismi")} value={form.driverName} onChange={e => setForm(p => ({ ...p, driverName: e.target.value }))} />
              <input className={inputCls} placeholder={t("Телефон", "Telefon")} value={form.driverPhone} onChange={e => setForm(p => ({ ...p, driverPhone: e.target.value }))} />
            </div>
          </div>

          {/* Date & expenses */}
          <div>
            <p className={sectionLabel}>{t("Дата и расходы", "Sana va xarajatlar")}</p>
            <div className="grid grid-cols-4 gap-3 mb-3">
              <div>
                <label className="font-label text-[10px] text-text-secondary mb-1.5 block">{t("Дата", "Sana")}</label>
                <input type="date" className={inputCls} value={form.arrivalDate} onChange={e => setForm(p => ({ ...p, arrivalDate: e.target.value }))} />
              </div>
              {[
                { key: "fuelCost", label: t("Топливо", "Yo'qilgi") },
                { key: "tollCost", label: t("Дорога", "Yo'l") },
                { key: "otherCost", label: t("Прочее", "Boshqa") },
              ].map(f => (
                <div key={f.key}>
                  <label className="font-label text-[10px] text-text-secondary mb-1.5 block">{f.label}</label>
                  <input type="number" step="0.01" className={inputCls} style={{ textAlign: "right" }} placeholder="0" value={(form as Record<string, unknown>)[f.key] as string} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: "var(--color-primary-subtle)" }}>
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
                <div key={i} className="panel-flat p-4 space-y-3" style={{ border: "1px solid var(--color-border-subtle)", borderRadius: "16px" }}>
                  <PremiumSelect value={String(item.productId)} onChange={v => updateItem(i, "productId", Number(v))}
                    options={[{ value: "0", label: t("Выберите товар…", "Mahsulot tanlang…") }, ...(products?.data ?? []).map((p: any) => ({ value: String(p.id), label: `${p.name} · ${fmt(p.unitPrice)}/${unitLabel(p.unit)}` }))]}
                    width="100%" />
                  <div className="grid grid-cols-4 gap-3 items-end">
                    <div>
                      <label className="font-label text-[10px] text-text-secondary mb-1.5 block">{t("Кол-во", "Miqdor")}</label>
                      <div className="flex items-center gap-2">
                        <input type="number" className={inputCls} style={{ width: 72, textAlign: "center", padding: "8px 10px" }} placeholder="0" value={item.quantity} onChange={e => updateItem(i, "quantity", e.target.value)} />
                        <span className="text-xs text-text-tertiary">{unitLabel(item.unit)}</span>
                      </div>
                    </div>
                    <div>
                      <label className="font-label text-[10px] text-text-secondary mb-1.5 block">{t("Себестоимость", "Tannarx")}</label>
                      <input type="number" step="0.01" className={inputCls} style={{ textAlign: "right", padding: "8px 10px" }} placeholder={t("цена/ед", "narx/dona")} value={item.costPrice} onChange={e => updateItem(i, "costPrice", e.target.value)} />
                    </div>
                    <div>
                      <label className="font-label text-[10px] text-text-secondary mb-1.5 block">{t("Состояние", "Holat")}</label>
                      <input className={inputCls} style={{ padding: "8px 10px" }} placeholder={t("Хорошее", "Yaxshi")} value={item.condition} onChange={e => updateItem(i, "condition", e.target.value)} />
                    </div>
                    <div className="flex justify-end">
                      {items.length > 1 && (
                        <button onClick={() => removeItem(i)} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-red-50" style={{ border: "none", background: "transparent", color: "#dc2626", cursor: "pointer" }}>
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={addItem} className="mt-3 w-full py-3 rounded-xl border-2 border-dashed flex items-center justify-center gap-2 text-sm font-medium transition-all hover:border-primary hover:text-primary hover:bg-primary/5" style={{ borderColor: "var(--color-border-strong)", color: "var(--color-text-secondary)", background: "transparent", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
              <Plus size={16} /> {t("Добавить товар", "Mahsulot qo'shish")}
            </button>
          </div>

          {/* Notes */}
          <div>
            <label className={sectionLabel}>{t("Примечания", "Izohlar")}</label>
            <textarea className={inputCls} style={{ resize: "none", minHeight: 60 }} rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder={t("Дополнительная информация…", "Qo'shimcha ma'lumot…")} />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button onClick={() => form.arrivalDate && onSave({ ...form, items: items.filter(i => i.productId > 0 && Number(i.quantity) > 0).map(i => ({ productId: i.productId, quantity: i.quantity, costPrice: i.costPrice, condition: i.condition })) })}
              disabled={isPending || !form.arrivalDate}
              className="btn-primary flex-1 h-12 text-sm flex items-center justify-center gap-2"
              style={{ opacity: isPending || !form.arrivalDate ? 0.5 : 1 }}>
              {isPending && <Loader2 size={15} className="animate-spin" />}
              {t("Сохранить", "Saqlash")}
            </button>
            <button onClick={onClose} className="btn-secondary flex-1 h-12 text-sm">
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
      <button onClick={() => setOpen(v => !v)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", border: "none", background: "transparent", cursor: "pointer", color: "var(--color-text-tertiary)", fontSize: "12px", fontFamily: F.body }}>
        <span>{t("Накладная", "Hujjat")}</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && detail?.items && (
        <div style={{ padding: "0 20px 16px" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>{[t("Товар", "Mahsulot"), t("Код", "Kod"), t("Кол-во", "Miqdor"), t("Состояние", "Holat")].map(h => (
                <th key={h} style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-tertiary)", padding: "8px 12px", textAlign: "left", borderBottom: "1px solid var(--color-border-subtle)" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {detail.items.map((raw: any, i: number) => {
                const item = raw as Record<string, unknown>;
                return (
                <tr key={i}>
                  <td style={{ padding: "10px 12px", fontSize: "13px", color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border-subtle)" }}>{String(item.productName)}</td>
                  <td style={{ padding: "10px 12px", fontSize: "12px", color: "var(--color-text-tertiary)", borderBottom: "1px solid var(--color-border-subtle)" }}>{String(item.productCode)}</td>
                  <td style={{ padding: "10px 12px", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border-subtle)" }}>{Number(item.quantity).toFixed(2)}</td>
                  <td style={{ padding: "10px 12px", fontSize: "13px", color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border-subtle)" }}>{String(item.condition ?? "—")}</td>
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: "24px 0" }}>
      {showForm && <ArrivalForm onSave={(d: any) => createMutation.mutate(d)} onClose={() => setShowForm(false)} isPending={createMutation.isPending} />}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, padding: "0 24px" }}>
        <div>
          <h1 style={{ fontSize: "26px", fontWeight: 800, color: "var(--color-text-primary)", margin: 0, letterSpacing: "-0.02em" }}>{t("Приходы", "Kelishlar")}</h1>
          <p style={{ fontSize: "13px", color: "var(--color-text-tertiary)", margin: "4px 0 0" }}>{t("Поступление товаров на склад", "Omborga mahsulot kelishi")}</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => all?.data && exportToExcel(formatArrivalsForExport(all.data), "arrivals")} style={{ padding: "10px 16px", borderRadius: "12px", fontSize: "13px", fontWeight: 500, fontFamily: F.body, color: "var(--color-text-secondary)", border: "none", cursor: "pointer", background: "var(--color-surface-light)", display: "flex", alignItems: "center", gap: 6 }}>
            <FileDown size={15} /> Excel
          </button>
          <button onClick={() => setShowForm(true)} style={{ padding: "10px 20px", borderRadius: "12px", fontSize: "13px", fontWeight: 600, fontFamily: F.body, color: "#fff", border: "none", cursor: "pointer", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", boxShadow: "0 4px 16px rgba(99,102,241,0.3)", display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={16} /> {t("Новый приход", "Yangi kelish")}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "0 24px" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
          <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary)" }} />
          <input style={{ padding: "10px 14px 10px 36px", borderRadius: "12px", fontSize: "13px", background: "var(--color-surface-light)", border: "none", color: "var(--color-text-primary)", outline: "none", width: "100%", fontFamily: F.body }} placeholder={t("Поиск приходов…", "Kelishlarni qidirish…")} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <PremiumSelect value={status} onChange={v => { setStatus(v); setPage(1); }}
          options={[{ value: "", label: t("Все статусы", "Barcha holatlar") }, { value: "pending", label: t("Ожидает", "Kutilmoqda") }, { value: "unloading", label: t("Разгрузка", "Tushirilmoqda") }, { value: "completed", label: t("Завершён", "Yakunlandi") }]}
          width="180px" />
      </div>

      {/* Table */}
      <div style={{ background: "var(--color-surface)", borderRadius: "20px", boxShadow: SHADOW, overflow: "hidden", margin: "0 24px" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr>
              {[t("ПРИХОД", "KELISH"), t("ДАТА", "SANA"), t("МАШИНА", "MASHINA"), t("ВОДИТЕЛЬ", "HAYDOVCHI"), t("РАСХОДЫ", "XARAJAT"), t("СТАТУС", "HOLAT")].map(h => (
                <th key={h} style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary)", padding: "14px 16px", textAlign: "left", borderBottom: "1px solid var(--color-border-subtle)", fontFamily: F.body }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}><td colSpan={6} style={{ padding: "16px" }}><div style={{ height: 16, background: "var(--color-surface-light)", borderRadius: 8, width: "60%" }} /></td></tr>
            )) : (data?.data ?? []).length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: "center", padding: "48px 16px", color: "var(--color-text-tertiary)", fontSize: "14px" }}>{t("Нет приходов", "Kelishlar yo'q")}</td></tr>
            ) : (data?.data ?? []).map((a: any) => (
              <tr key={a.id} style={{ transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(99,102,241,0.02)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                <td style={{ padding: "14px 16px", fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border-subtle)" }}>{a.arrivalNumber}</td>
                <td style={{ padding: "14px 16px", fontSize: "13px", color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border-subtle)" }}>{a.arrivalDate ? format(new Date(a.arrivalDate), "dd.MM.yyyy") : "—"}</td>
                <td style={{ padding: "14px 16px", fontSize: "13px", color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border-subtle)" }}>{a.truckId ?? "—"}</td>
                <td style={{ padding: "14px 16px", fontSize: "13px", color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border-subtle)" }}>{a.driverName ?? "—"}</td>
                <td style={{ padding: "14px 16px", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border-subtle)" }}>{fmt(a.totalExpense ?? 0)}</td>
                <td style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border-subtle)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <StatusBadge status={a.status ?? "pending"} lang={lang as "ru" | "uz"} />
                    {a.status === "pending" && <button onClick={() => updateStatus.mutate({ id: a.id, status: "unloading" })} style={{ padding: "6px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: 600, fontFamily: F.body, color: "var(--color-primary)", background: "rgba(99,102,241,0.08)", border: "none", cursor: "pointer" }}>{t("Разгрузка", "Tushirish")}</button>}
                    {a.status === "unloading" && <button onClick={() => updateStatus.mutate({ id: a.id, status: "completed" })} style={{ padding: "6px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: 600, fontFamily: F.body, color: "#fff", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", border: "none", cursor: "pointer" }}>{t("Завершить", "Yakunlash")}</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Receipt rows */}
        {!isLoading && (data?.data ?? []).map((a: any) => (
          <div key={`r-${a.id}`} style={{ borderTop: "1px solid var(--color-border-subtle)" }}>
            <ArrivalReceipt arrival={a} />
          </div>
        ))}
      </div>

      {/* Pagination */}
      {data && data.total > 25 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px" }}>
          <span style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>{data.total} {t("всего", "jami")}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ padding: "8px 16px", borderRadius: "10px", fontSize: "13px", fontFamily: F.body, color: "var(--color-text-secondary)", border: "none", cursor: "pointer", background: "var(--color-surface-light)", opacity: page === 1 ? 0.5 : 1 }}>{t("Назад", "Orqaga")}</button>
            <button onClick={() => setPage(p => p + 1)} disabled={page * 25 >= data.total} style={{ padding: "8px 16px", borderRadius: "10px", fontSize: "13px", fontFamily: F.body, color: "var(--color-text-secondary)", border: "none", cursor: "pointer", background: "var(--color-surface-light)", opacity: page * 25 >= data.total ? 0.5 : 1 }}>{t("Далее", "Keyingi")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
