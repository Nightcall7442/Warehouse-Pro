import { memo, useState } from "react";
import { X, TrendingUp, TrendingDown, ArrowUpDown, Scale, Loader2 } from "lucide-react";
import { useLang } from "@/i18n";
import { toKg } from "./warehouse-utils";

export const AdjustModal = memo(function AdjustModal({ productId, productName, currentStock, unit, unitWeight, onSave, onClose, isPending }: {
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
    { value: "in" as const, icon: TrendingUp, labelRu: "Приход", labelUz: "Kirim", color: "#34c473", descRu: "Добавить на склад", descUz: "Omborga qo'shish" },
    { value: "out" as const, icon: TrendingDown, labelRu: "Расход", labelUz: "Chiqim", color: "#d45050", descRu: "Списать со склада", descUz: "Ombordan chiqarish" },
    { value: "adjustment" as const, icon: ArrowUpDown, labelRu: "Корректировка", labelUz: "Tuzatish", color: "#d4973a", descRu: "Установить точное кол-во", descUz: "Aniq miqdorni o'rnatish" },
  ];

  const currentType = types.find(t => t.value === type)!;
  const numQty = Number(qty) || 0;
  const newStock = type === "in" ? currentStock + numQty : type === "out" ? currentStock - numQty : numQty;
  const unitLabelLocal = unit === "kg" ? "кг" : unit === "l" ? "л" : unit === "pcs" ? "шт" : unit === "box" ? "ящ" : unit === "pack" ? "упак" : unit === "м" ? "м" : unit;
  const previewWeightKg = unitWeight > 0 ? (numQty * unitWeight).toFixed(1) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(12px)" }}>
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl p-6 space-y-5 animate-fade-up"
        style={{ background: "var(--color-surface, #ffffff)", boxShadow: "0 -25px 60px -15px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05) inset" }}>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: "var(--color-text-primary, #2b3450)", fontFamily: "'DM Sans', sans-serif" }}>
              {t("Движение товара", "Mahsulot harakati")}
            </h2>
            <p className="text-sm mt-0.5" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>{productName}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
            style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
            <X size={18} style={{ color: "var(--color-text-secondary, #6a7290)" }} />
          </button>
        </div>

        {/* Current stock badge */}
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
          <Scale size={16} style={{ color: "var(--color-text-tertiary, #98a0b8)" }} />
          <span className="text-xs font-medium" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
            {t("Текущий остаток", "Joriy qoldiq")}
          </span>
          <span className="ml-auto text-sm font-bold" style={{ color: "var(--color-text-primary, #2b3450)", fontFamily: "'DM Sans', sans-serif" }}>
            {currentStock.toFixed(2)}
            {unitWeight > 0 && <span className="text-xs font-normal" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}> ({toKg(currentStock, unitWeight).toFixed(1)} кг)</span>}
          </span>
        </div>

        {/* Type selector */}
        <div>
          <label className="text-[10px] font-semibold tracking-wider uppercase mb-3 block" style={{ color: "var(--color-text-tertiary, #98a0b8)", fontFamily: "'DM Sans', sans-serif" }}>
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
                    background: active ? `${opt.color}15` : "var(--color-surface-light, #f0f3f8)",
                    border: `2px solid ${active ? opt.color : "transparent"}`,
                    boxShadow: active ? `0 0 0 1px ${opt.color}20` : "none",
                  }}>
                  <Icon size={20} style={{ color: opt.color, margin: "0 auto 6px" }} />
                  <p className="text-xs font-semibold" style={{ color: active ? opt.color : "var(--color-text-primary, #2b3450)" }}>
                    {lang === "uz" ? opt.labelUz : opt.labelRu}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
                    {lang === "uz" ? opt.descUz : opt.descRu}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Quantity input */}
        <div>
          <label className="text-[10px] font-semibold tracking-wider uppercase mb-2 block" style={{ color: "var(--color-text-tertiary, #98a0b8)", fontFamily: "'DM Sans', sans-serif" }}>
            {t("КОЛИЧЕСТВО", "MIQDOR")}
          </label>
          <input type="number" step="0.01" min="0" autoFocus
            className="w-full px-4 py-3 rounded-xl text-xl font-bold outline-none transition-all"
            style={{ background: "var(--color-surface-light, #f0f3f8)", color: "var(--color-text-primary, #2b3450)", fontFamily: "'DM Sans', sans-serif", border: "2px solid transparent" }}
            onFocus={e => e.currentTarget.style.borderColor = currentType.color}
            onBlur={e => e.currentTarget.style.borderColor = "transparent"}
            placeholder="0.00" value={qty} onChange={e => setQty(e.target.value)} />
          {numQty > 0 && (
            <div className="flex items-center justify-between mt-2 px-1">
              <span className="text-xs" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
                {t("Новый остаток", "Yangi qoldiq")}
              </span>
              <span className="text-sm font-bold" style={{ color: newStock >= 0 ? "#34c473" : "#d45050", fontFamily: "'DM Sans', sans-serif" }}>
                {newStock.toFixed(2)}
                {unitWeight > 0 && <span className="text-xs font-normal" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}> ({toKg(newStock, unitWeight).toFixed(1)} кг)</span>}
              </span>
            </div>
          )}
          {numQty > 0 && previewWeightKg && (
            <div className="flex items-center justify-between mt-1 px-1">
              <span className="text-xs" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
                {t("Вес", "Og'irlik")}
              </span>
              <span className="text-xs font-medium" style={{ color: "var(--color-text-secondary, #6a7290)" }}>
                {previewWeightKg} кг
              </span>
            </div>
          )}
        </div>

        {/* Notes */}
        <div>
          <label className="text-[10px] font-semibold tracking-wider uppercase mb-2 block" style={{ color: "var(--color-text-tertiary, #98a0b8)", fontFamily: "'DM Sans', sans-serif" }}>
            {t("ПРИМЕЧАНИЕ", "IZOH")}
          </label>
          <input className="w-full px-4 py-3 rounded-xl outline-none transition-all"
            style={{ background: "var(--color-surface-light, #f0f3f8)", color: "var(--color-text-primary, #2b3450)", border: "2px solid transparent" }}
            onFocus={e => e.currentTarget.style.borderColor = "#5b6d8a"}
            onBlur={e => e.currentTarget.style.borderColor = "transparent"}
            placeholder={t("Например: возврат от клиента", "Masalan: mijozdan qaytarish")}
            value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button onClick={onClose}
            className="flex-1 py-3 rounded-xl text-sm font-medium transition-all"
            style={{ background: "var(--color-surface-light, #f0f3f8)", color: "var(--color-text-secondary, #6a7290)" }}>
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
});
