import { memo, useState } from "react";
import { TrendingUp, TrendingDown, ArrowUpDown, Scale, Loader2 } from "lucide-react";
import { useLang } from "@/i18n";
import { toKg } from "./warehouse-utils";
import { formatQty } from "@/lib/format";
import { colorMix } from "@/lib/color-mix";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import { AppModal, modalFieldLabel } from "@/components/ui/AppModal";

/*
  Движение товара — на общем окне (AppModal): замок прокрутки, Escape,
  прокрутка внутри на маленьком экране, шапка и футер как у всех окон.
  Раньше — своя копия с bottom-sheet без прокрутки: на телефоне с открытой
  клавиатурой кнопки уезжали за край, а страница под окном ехала.
*/
export const AdjustModal = memo(function AdjustModal({ productId, productName, currentStock, unitWeight, warehouseId, onSave, onClose, isPending }: {
  productId: number; productName: string; currentStock: number;
  unitWeight: number; warehouseId?: number;
  onSave: (d: unknown) => void; onClose: () => void; isPending: boolean;
}) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [qty, setQty] = useState("");
  const [type, setType] = useState<"in" | "out" | "adjustment">("in");
  const [notes, setNotes] = useState("");

  const types = [
    { value: "in" as const, icon: TrendingUp, labelRu: "Приход", labelUz: "Kirim", color: "var(--color-success-text)", descRu: "Добавить на склад", descUz: "Omborga qo'shish" },
    { value: "out" as const, icon: TrendingDown, labelRu: "Расход", labelUz: "Chiqim", color: "var(--color-danger-text)", descRu: "Списать со склада", descUz: "Ombordan chiqarish" },
    { value: "adjustment" as const, icon: ArrowUpDown, labelRu: "Корректировка", labelUz: "Tuzatish", color: "var(--color-warning-text)", descRu: "Установить точное кол-во", descUz: "Aniq miqdorni o'rnatish" },
  ];
  const numQty = Number(qty) || 0;
  const newStock = type === "in" ? currentStock + numQty : type === "out" ? currentStock - numQty : numQty;
  const previewWeightKg = unitWeight > 0 ? formatQty(numQty * unitWeight) : null;
  // Списать больше, чем есть, нельзя — сервер откажет; здесь кнопка гаснет с подписью.
  const overdraft = type === "out" && numQty > currentStock;
  const valid = numQty > 0 && !overdraft;

  return (
    <AppModal open onClose={onClose} dirty={qty !== "" || notes !== ""} maxWidth={520}
      title={t("Движение товара", "Mahsulot harakati")} subtitle={productName}
      footer={<>
        <button type="button" onClick={onClose} className="neo-btn flex-1">{t("Отмена", "Bekor")}</button>
        <button type="button" data-testid="adjust-submit"
          onClick={() => valid && onSave({ productId, warehouseId, quantity: qty, type, notes })}
          disabled={!valid || isPending}
          className="neo-btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-40">
          {isPending && <Loader2 size={16} className="animate-spin" />}
          {t("Применить", "Qo'llash")}
        </button>
      </>}
    >
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: "var(--color-surface-light, #f6f4f0)" }}>
        <Scale size={16} style={{ color: "var(--color-text-tertiary, #6b6760)" }} />
        <span className="text-xs font-medium" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>{t("Текущий остаток", "Joriy qoldiq")}</span>
        <span className="ml-auto text-sm font-bold font-data" style={{ color: "var(--color-text-primary, #2b2a28)" }}>
          {formatQty(currentStock)}
          {unitWeight > 0 && <span className="text-xs font-normal" style={{ color: "var(--color-text-tertiary, #6b6760)" }}> ({formatQty(toKg(currentStock, unitWeight))} кг)</span>}
        </span>
      </div>

      <div>
        <label className={modalFieldLabel}>{t("Тип операции", "Operatsiya turi")}</label>
        <div className="grid grid-cols-3 gap-2">
          {types.map(opt => {
            const Icon = opt.icon;
            const active = type === opt.value;
            return (
              <button key={opt.value} type="button" onClick={() => setType(opt.value)} data-testid={`adjust-type-${opt.value}`}
                className="p-3 rounded-xl text-center transition-all"
                style={{
                  background: active ? colorMix(opt.color, 8) : "var(--color-surface-light, #f6f4f0)",
                  border: `2px solid ${active ? opt.color : "transparent"}`,
                  boxShadow: active ? `0 0 0 1px ${colorMix(opt.color, 13)}` : "none",
                }}>
                <Icon size={20} style={{ color: opt.color, margin: "0 auto 6px" }} />
                <p className="text-xs font-semibold" style={{ color: active ? opt.color : "var(--color-text-primary, #2b2a28)" }}>{lang === "uz" ? opt.labelUz : opt.labelRu}</p>
                <p className="text-[10px] mt-0.5" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>{lang === "uz" ? opt.descUz : opt.descRu}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className={modalFieldLabel}>{t("Количество", "Miqdor")}</label>
        <input type="text" inputMode="decimal" autoFocus data-testid="adjust-qty"
          className="neo-input w-full font-data text-xl font-bold"
          placeholder="0" value={qty} onChange={e => setQty(normalizeDecimalInput(e.target.value))} />
        {numQty > 0 && (
          <div className="flex items-center justify-between mt-2 px-1">
            <span className="text-xs" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>{t("Новый остаток", "Yangi qoldiq")}</span>
            <span className="text-sm font-bold font-data" style={{ color: overdraft ? "var(--color-danger-text)" : "var(--color-success-text)" }}>
              {formatQty(newStock)}
              {unitWeight > 0 && <span className="text-xs font-normal" style={{ color: "var(--color-text-tertiary, #6b6760)" }}> ({formatQty(toKg(newStock, unitWeight))} кг)</span>}
            </span>
          </div>
        )}
        {overdraft && <p className="text-xs mt-1 px-1" style={{ color: "var(--color-danger-text)" }} data-testid="adjust-overdraft">{t("Больше, чем есть на складе", "Ombordagidan ko'p")}</p>}
        {numQty > 0 && previewWeightKg && (
          <div className="flex items-center justify-between mt-1 px-1">
            <span className="text-xs" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>{t("Вес", "Og'irlik")}</span>
            <span className="text-xs font-medium" style={{ color: "var(--color-text-secondary, #5e5b54)" }}>{previewWeightKg} {t("кг", "kg")}</span>
          </div>
        )}
      </div>

      <div>
        <label className={modalFieldLabel}>{t("Примечание", "Izoh")}</label>
        <input className="neo-input w-full" placeholder={t("Например: возврат от клиента", "Masalan: mijozdan qaytarish")}
          value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
    </AppModal>
  );
});
