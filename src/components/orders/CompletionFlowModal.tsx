import { useState } from "react";
import {
  Package, CreditCard, RotateCcw, CheckCircle, AlertTriangle,
  Banknote, Repeat,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslate, useLang } from "@/i18n";
import { AppModal, modalSectionLabel, modalFieldLabel } from "@/components/ui/AppModal";
import { colorMix } from "@/lib/color-mix";

export type CompletionMode = "partial_return" | "partial_payment" | "combined";

interface OrderItem {
  id: number;
  productName: string;
  productCode?: string;
  quantity: number;
  unitPrice: number | string;
  unit?: string;
  subtotal: number | string;
  deliveredQuantity?: number | null;
  returnReason?: string | null;
}

interface ItemReturnState {
  itemId: number;
  productName: string;
  productCode?: string;
  orderedQty: number;
  unit?: string;
  unitPrice: number;
  returnedQty: number;
  isReturned: boolean;
  reason: string;
}

export interface CompletionData {
  items: Array<{
    itemId: number;
    deliveredQuantity: number;
    returnReason?: string;
  }>;
  paidAmount?: string;
  paymentMethod?: "cash" | "card" | "transfer";
  debtAmount?: string;
  notes?: string;
}

const UNIT_LABELS: Record<string, { ru: string; uz: string }> = {
  kg: { ru: "кг", uz: "kg" },
  l: { ru: "л", uz: "l" },
  pcs: { ru: "шт", uz: "dona" },
  box: { ru: "блок", uz: "blok" },
  pack: { ru: "упак", uz: "upk" },
  m: { ru: "м", uz: "m" },
  block: { ru: "блок", uz: "blok" },
};

const PM_OPTIONS = [
  { value: "cash" as const, label: { ru: "Наличные", uz: "Naqd" }, icon: Banknote },
  { value: "card" as const, label: { ru: "Карта", uz: "Plastik" }, icon: CreditCard },
  { value: "transfer" as const, label: { ru: "Перечисление", uz: "O'tkazma" }, icon: Repeat },
];

function cleanNum(val: string | number | null | undefined): string {
  const n = Number(val ?? 0);
  if (n === 0) return "0";
  if (n === Math.floor(n)) return n.toLocaleString("ru-RU");
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

interface Props {
  open: boolean;
  onClose: () => void;
  mode: CompletionMode;
  orderNumber: string;
  orderTotal: string;
  items: OrderItem[];
  currency: string;
  saving: boolean;
  onSave: (data: CompletionData) => void;
}

export function CompletionFlowModal({
  open, onClose, mode, orderNumber, orderTotal, items, currency, saving, onSave,
}: Props) {
  const t = useTranslate();
  const { lang } = useLang();
  const [itemStates, setItemStates] = useState<ItemReturnState[]>([]);
  const [paidAmount, setPaidAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "transfer">("cash");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const showReturnItems = mode === "partial_return" || mode === "combined";
  const showPayment = mode === "partial_payment" || mode === "combined";
  const total = Number(orderTotal);
  const debt = Math.max(0, total - Number(paidAmount || 0));

  /**
   * Какие именно позиции сейчас в окне.
   *
   * Сброс формы завязан на этот ключ, а не на сам массив. Родительский экран
   * собирает список через .map() и отдаёт НОВЫЙ массив на каждый свой рендер,
   * а рендер случается, когда любой сотрудник создаёт заказ: список заказов
   * обновляется по событию с сервера.
   *
   * В итоге оператор отмечал возвраты, вводил сумму оплаты — и всё стиралось
   * без предупреждения, потому что где-то в поле агент оформил заказ. Не
   * заметив, он нажимал «Завершить», и уходила оплата 0 с полным долгом на
   * магазин.
   *
   * Ключ из идентификаторов меняется только когда в окне действительно другой
   * набор позиций, то есть другой заказ.
   */
  const itemsKey = items.map(item => item.id).join(",");

  // Сброс полей, когда окно открывают — и когда в нём оказывается другой
  // заказ.
  //
  // Условная запись при отрисовке вместо эффекта: эффект выполняется после
  // кадра, поэтому открытое окно успевало показать поля предыдущего заказа —
  // отмеченные возвраты и введённую сумму — и только потом очищалось.
  // Условие сравнения собрано из тех же величин, от которых зависел эффект,
  // так что сброс происходит в тот же момент, что и раньше.
  const resetKey = open ? itemsKey : null;
  const [lastResetKey, setLastResetKey] = useState<string | null>(resetKey);
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    if (open) {
      setItemStates(items.map(item => ({
        itemId: item.id,
        productName: item.productName,
        productCode: item.productCode,
        orderedQty: Number(item.quantity),
        unit: item.unit,
        unitPrice: Number(item.unitPrice) || 0,
        returnedQty: 0,
        isReturned: false,
        reason: "",
      })));
      setPaidAmount("");
      setPaymentMethod("cash");
      setNotes("");
      setError(null);
    }
  }

  const totalReturned = itemStates.reduce((s, it) => s + it.returnedQty, 0);
  const totalKept = itemStates.reduce((s, it) => s + (it.orderedQty - it.returnedQty), 0);

  function toggleReturned(idx: number) {
    setItemStates(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const nowReturned = !it.isReturned;
      return { ...it, isReturned: nowReturned, returnedQty: nowReturned ? it.orderedQty : 0 };
    }));
  }

  function setReturnedQty(idx: number, qty: number) {
    setItemStates(prev => prev.map((it, i) => i === idx ? { ...it, returnedQty: Math.max(0, Math.min(qty, it.orderedQty)) } : it));
  }

  function setReason(idx: number, reason: string) {
    setItemStates(prev => prev.map((it, i) => i === idx ? { ...it, reason } : it));
  }

  function validate(): string | null {
    if (showReturnItems) {
      const allKept = itemStates.every(it => !it.isReturned && it.returnedQty === 0);
      if (allKept && mode === "partial_return") {
        return lang === "uz" ? "Hech bo'lmaganda bitta tovarni qaytaring" : "Отметьте хотя бы один товар для возврата";
      }
      const invalidQty = itemStates.some(it => it.isReturned && (it.returnedQty < 0 || it.returnedQty > it.orderedQty));
      if (invalidQty) {
        return lang === "uz" ? "Noto'g'ri miqdor" : "Некорректное количество возврата";
      }
    }
    if (showPayment) {
      const paid = Number(paidAmount || 0);
      if (paidAmount && (isNaN(paid) || paid < 0)) {
        return lang === "uz" ? "Noto'g'ri to'lov summasi" : "Некорректная сумма оплаты";
      }
      if (paid > total) {
        return lang === "uz" ? "To'lov summasi buyurtma summasidan oshmasligi kerak" : "Сумма оплаты не может превышать сумму заказа";
      }
    }
    return null;
  }

  function handleSave() {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);

    const deliveredItems = itemStates.map(it => ({
      itemId: it.itemId,
      deliveredQuantity: it.isReturned ? 0 : it.orderedQty - it.returnedQty,
      returnReason: it.isReturned || it.returnedQty > 0 ? (it.reason || undefined) : undefined,
    }));

    const data: CompletionData = { items: deliveredItems, notes: notes || undefined };
    if (showPayment) {
      data.paidAmount = paidAmount || "0";
      data.paymentMethod = paymentMethod;
      data.debtAmount = String(debt);
    }
    onSave(data);
  }

  const TITLE_MAP: Record<CompletionMode, { ru: string; uz: string }> = {
    partial_return: { ru: "Частичный возврат", uz: "Qisman qaytarish" },
    partial_payment: { ru: "Частичная оплата", uz: "Qisman to'lov" },
    combined: { ru: "Доставка и оплата", uz: "Yetkazib berish va to'lov" },
  };

  const footer = (
    <>
      <button type="button" onClick={handleSave} disabled={saving} className="neo-btn-primary flex-1 h-12 text-sm">
        {saving ? t("Сохранение...", "Saqlanmoqda...") : t("Завершить заказ", "Buyurtmani tugatish")}
      </button>
      <button type="button" onClick={onClose} disabled={saving} className="neo-btn flex-1 h-12 text-sm">
        {t("Отмена", "Bekor qilish")}
      </button>
    </>
  );

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={TITLE_MAP[mode][lang === "uz" ? "uz" : "ru"]}
      subtitle={`${t("Заказ", "Buyurtma")} ${orderNumber}`}
      maxWidth={640}
      footer={footer}
    >
      {/* Error banner */}
      {error && (
        <div
          className="flex items-center gap-2 px-3 py-3 rounded-xl text-sm"
          style={{
            background: colorMix("var(--color-danger)", 7),
            border: `1px solid ${colorMix("var(--color-danger)", 19)}`,
            color: "var(--color-danger-text)",
          }}
        >
          <AlertTriangle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {/* ── Return items section ── */}
      {showReturnItems && (
        <div className="neo-card-sm" style={{ padding: "16px" }}>
          <p className={modalSectionLabel} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Package size={14} /> {t("ТОВАРЫ", "MAHSULOTLAR")} ({itemStates.length})
          </p>
          <div className="flex flex-col gap-2.5">
            {itemStates.map((it, idx) => {
              const unitLabel = UNIT_LABELS[it.unit ?? "pcs"]?.[lang] ?? "шт";
              const kept = it.orderedQty - it.returnedQty;
              return (
                <div
                  key={it.itemId}
                  className="rounded-xl"
                  style={{
                    padding: "12px",
                    border: `1px solid ${it.isReturned ? colorMix("var(--color-danger)", 40) : "var(--color-border, #d8d5cd)"}`,
                    background: it.isReturned ? colorMix("var(--color-danger)", 3) : "var(--color-surface-light)",
                    transition: "background 0.15s",
                  }}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate" style={{ color: "var(--color-text-primary)" }}>{it.productName}</p>
                      {it.productCode && <p className="text-[10px] font-data" style={{ color: "var(--color-text-tertiary)" }}>{it.productCode}</p>}
                      <p className="text-[11px] mt-1" style={{ color: "var(--color-text-secondary)" }}>
                        {t("Заказано", "Buyurtma")}: {it.orderedQty} {unitLabel} × {cleanNum(it.unitPrice)} {currency}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleReturned(idx)}
                      className="text-[11px] font-semibold rounded-full shrink-0"
                      style={{
                        padding: "6px 12px",
                        background: it.isReturned ? colorMix("var(--color-danger)", 8) : colorMix("var(--color-success)", 8),
                        color: it.isReturned ? "var(--color-danger-text)" : "var(--color-success-text)",
                        border: `1px solid ${colorMix(it.isReturned ? "var(--color-danger)" : "var(--color-success)", 19)}`,
                      }}
                    >
                      {it.isReturned ? t("Возврат", "Qaytarish") : t("Оставил", "Oldi")}
                    </button>
                  </div>

                  {it.isReturned ? (
                    <div className="flex flex-col gap-2 mt-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "var(--color-danger-text)" }}>
                        <RotateCcw size={12} />
                        <span>{t("Магазин вернул этот товар", "Do'kon bu tovarni qaytardi")}</span>
                      </div>
                      <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 2fr" }}>
                        <div>
                          <label htmlFor={`ret-qty-${it.itemId}`} className={modalFieldLabel}>{t("Кол-во", "Miqdor")}</label>
                          <Input
                            id={`ret-qty-${it.itemId}`}
                            type="number" min={0} max={it.orderedQty}
                            value={it.returnedQty}
                            onChange={e => setReturnedQty(idx, Number(e.target.value))}
                            className="h-8 text-sm"
                          />
                        </div>
                        <div>
                          <label htmlFor={`ret-reason-${it.itemId}`} className={modalFieldLabel}>{t("Причина", "Sabab")}</label>
                          <Input
                            id={`ret-reason-${it.itemId}`}
                            value={it.reason}
                            onChange={e => setReason(idx, e.target.value)}
                            placeholder={t("Необязательно", "Ixtiyoriy")}
                            className="h-8 text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 mt-2 text-[11px]" style={{ color: "var(--color-success-text)" }}>
                      <CheckCircle size={12} />
                      <span>{t("Магазин оставил", "Do'kon oldi")}: <b>{kept}</b> {unitLabel}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-2.5 mt-3">
            <div className="rounded-xl text-center" style={{ padding: "10px", background: colorMix("var(--color-success)", 5) }}>
              <p className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>{t("Оставлено", "Olingan")}</p>
              <p className="text-lg font-bold font-data" style={{ color: "var(--color-success-text)" }}>{totalKept}</p>
            </div>
            <div className="rounded-xl text-center" style={{ padding: "10px", background: colorMix("var(--color-danger)", 5) }}>
              <p className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>{t("Возврат", "Qaytarilgan")}</p>
              <p className="text-lg font-bold font-data" style={{ color: "var(--color-danger-text)" }}>{totalReturned}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Payment section ── */}
      {showPayment && (
        <div className="neo-card-sm" style={{ padding: "16px" }}>
          <p className={modalSectionLabel} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <CreditCard size={14} /> {t("ОПЛАТА", "TO'LOV")}
          </p>

          <div className="flex items-center justify-between rounded-xl mb-3" style={{ padding: "12px", background: "var(--color-surface-light)" }}>
            <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>{t("Сумма заказа", "Buyurtma summasi")}</span>
            <span className="text-[17px] font-bold font-data" style={{ color: "var(--color-text-primary)" }}>{cleanNum(total)} {currency}</span>
          </div>

          <div className="mb-3">
            <label htmlFor="paid-amount" className={modalFieldLabel}>{t("Сумма оплаты", "To'lov summasi")}</label>
            <Input
              id="paid-amount"
              type="number" min={0} max={total}
              value={paidAmount}
              onChange={e => { setPaidAmount(e.target.value); setError(null); }}
              placeholder="0"
              className="h-10 text-base font-bold font-data"
            />
          </div>

          {paidAmount && Number(paidAmount) > 0 && Number(paidAmount) < total && (
            <div
              className="flex items-center gap-2.5 rounded-xl mb-3"
              style={{
                padding: "12px",
                background: colorMix("var(--color-warning)", 7),
                border: `1px solid ${colorMix("var(--color-warning)", 19)}`,
              }}
            >
              <AlertTriangle size={16} style={{ color: "var(--color-warning)" }} className="shrink-0" />
              <div>
                <p className="text-[11px]" style={{ color: "var(--color-text-secondary)" }}>{t("В долг", "Qarzga")}</p>
                <p className="text-[15px] font-bold font-data" style={{ color: "var(--color-warning-text)" }}>{cleanNum(debt)} {currency}</p>
              </div>
            </div>
          )}

          <div>
            <p className="text-[11px] mb-2" style={{ color: "var(--color-text-secondary)" }}>{t("Способ оплаты", "To'lov usuli")}</p>
            <div className="grid grid-cols-3 gap-2">
              {PM_OPTIONS.map(pm => {
                const Icon = pm.icon;
                const active = paymentMethod === pm.value;
                return (
                  <button
                    key={pm.value}
                    type="button"
                    onClick={() => setPaymentMethod(pm.value)}
                    className="flex flex-col items-center gap-1.5 rounded-xl"
                    style={{
                      padding: "12px",
                      border: `1.5px solid ${active ? "var(--color-primary)" : "var(--color-border, #d8d5cd)"}`,
                      background: active ? colorMix("var(--color-primary)", 5) : "transparent",
                      transition: "all 0.15s",
                    }}
                  >
                    <Icon size={18} style={{ color: active ? "var(--color-primary)" : "var(--color-text-secondary)" }} />
                    <span className="text-[11px]" style={{ fontWeight: active ? 600 : 400, color: active ? "var(--color-primary-text)" : "var(--color-text-secondary)" }}>
                      {lang === "uz" ? pm.label.uz : pm.label.ru}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Notes ── */}
      <div>
        <label htmlFor="completion-notes" className={modalSectionLabel}>{t("ПРИМЕЧАНИЯ", "ESLATMALAR")}</label>
        <Textarea
          id="completion-notes"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder={t("Комментарий к завершению...", "Tugatish bo'yicha izoh...")}
          rows={2}
          className="text-sm"
        />
      </div>
    </AppModal>
  );
}
