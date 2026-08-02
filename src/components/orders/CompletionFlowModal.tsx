import { useState, useEffect } from "react";
import {
  X, Package, CreditCard, RotateCcw, CheckCircle, AlertTriangle,
  DollarSign, Repeat, Banknote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useLang } from "@/i18n";

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
  const { t, lang } = useLang();
  const [itemStates, setItemStates] = useState<ItemReturnState[]>([]);
  const [paidAmount, setPaidAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "transfer">("cash");
  const [notes, setNotes] = useState("");

  useEffect(() => {
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
    }
  }, [open, items]);

  if (!open) return null;

  const showReturnItems = mode === "partial_return" || mode === "combined";
  const showPayment = mode === "partial_payment" || mode === "combined";
  const total = Number(orderTotal);
  const debt = Math.max(0, total - Number(paidAmount || 0));

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
    setItemStates(prev => prev.map((it, i) => i === idx ? { ...it, returnedQty: qty } : it));
  }

  function setReason(idx: number, reason: string) {
    setItemStates(prev => prev.map((it, i) => i === idx ? { ...it, reason } : it));
  }

  function handleSave() {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-background rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden border">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              {mode === "partial_return" ? <RotateCcw size={20} className="text-primary" /> :
               mode === "combined" ? <Package size={20} className="text-primary" /> :
               <CreditCard size={20} className="text-primary" />}
            </div>
            <div>
              <h2 className="font-display text-lg font-bold">
                {mode === "partial_return" ? t("Частичный возврат", "Qisman qaytarish") :
                 mode === "partial_payment" ? t("Частичная оплата", "Qisman to'lov") :
                 t("Доставка и оплата", "Yetkazib berish va to'lov")}
              </h2>
              <p className="text-xs text-secondary">{t("Заказ", "Buyurtma")} {orderNumber}</p>
            </div>
          </div>
          <button onClick={onClose} className="neo-btn p-2">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* ── Return items section ── */}
          {showReturnItems && (
            <div className="neo-card p-4 space-y-3">
              <p className="font-label text-secondary text-xs tracking-wider flex items-center gap-2">
                <Package size={14}/> {t("ТОВАРЫ", "MAHSULOTLAR")} ({itemStates.length})
              </p>
              <Separator />
              <div className="space-y-3">
                {itemStates.map((it, idx) => {
                  const unitLabel = UNIT_LABELS[it.unit ?? "pcs"]?.[lang] ?? "шт";
                  const kept = it.orderedQty - it.returnedQty;
                  return (
                    <div key={it.itemId} className={`p-3 rounded-lg border transition-colors ${it.isReturned ? "border-danger/30 bg-danger/5" : "border-border-subtle bg-muted/20"}`}>
                      {/* Item header */}
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-primary truncate">{it.productName}</p>
                          {it.productCode && <p className="text-xs text-secondary font-data">{it.productCode}</p>}
                          <p className="text-xs text-secondary mt-1">
                            {t("Заказано", "Buyurtma")}: {it.orderedQty} {unitLabel} × {cleanNum(it.unitPrice)} {currency}
                          </p>
                        </div>
                        <button
                          onClick={() => toggleReturned(idx)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            it.isReturned
                              ? "bg-danger/15 text-danger border border-danger/30"
                              : "bg-success/15 text-success border border-success/30"
                          }`}
                        >
                          {it.isReturned ? t("Возврат", "Qaytarish") : t("Оставил", "Oldi")}
                        </button>
                      </div>

                      {it.isReturned ? (
                        <div className="space-y-2 mt-2">
                          <div className="flex items-center gap-2 text-xs text-danger">
                            <RotateCcw size={12} />
                            <span className="font-medium">{t("Магазин вернул этот товар", "Do'kon bu tovarni qaytardi")}</span>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="text-[10px] text-secondary mb-1 block">{t("Кол-во", "Miqdor")}</label>
                              <Input
                                type="number" min={0} max={it.orderedQty}
                                value={it.returnedQty}
                                onChange={e => setReturnedQty(idx, Number(e.target.value))}
                                className="h-8 text-sm"
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="text-[10px] text-secondary mb-1 block">{t("Причина", "Sabab")}</label>
                              <Input
                                value={it.reason}
                                onChange={e => setReason(idx, e.target.value)}
                                placeholder={t("Необязательно", "Ixtiyoriy")}
                                className="h-8 text-sm"
                              />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mt-2 text-xs text-success">
                          <CheckCircle size={12} />
                          <span>{t("Магазин оставил", "Do'kon oldi")}: <b>{kept}</b> {unitLabel}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Summary */}
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-success/10 text-center">
                  <p className="text-[10px] text-secondary">{t("Оставлено", "Olingan")}</p>
                  <p className="text-xl font-bold text-success">{totalKept}</p>
                </div>
                <div className="p-3 rounded-lg bg-danger/10 text-center">
                  <p className="text-[10px] text-secondary">{t("Возврат", "Qaytarilgan")}</p>
                  <p className="text-xl font-bold text-danger">{totalReturned}</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Payment section ── */}
          {showPayment && (
            <div className="neo-card p-4 space-y-3">
              <p className="font-label text-secondary text-xs tracking-wider flex items-center gap-2">
                <CreditCard size={14}/> {t("ОПЛАТА", "TO'LOV")}
              </p>
              <Separator />

              {/* Order total */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                <span className="text-sm text-secondary">{t("Сумма заказа", "Buyurtma summasi")}</span>
                <span className="font-data text-lg font-bold">{cleanNum(total)} {currency}</span>
              </div>

              {/* Paid amount */}
              <div>
                <label className="text-xs text-secondary mb-1 block">{t("Сумма оплаты", "To'lov summasi")}</label>
                <Input
                  type="number" min={0} max={total}
                  value={paidAmount}
                  onChange={e => setPaidAmount(e.target.value)}
                  placeholder="0"
                  className="h-10 text-base font-data font-bold"
                />
              </div>

              {/* Debt warning */}
              {paidAmount && Number(paidAmount) > 0 && Number(paidAmount) < total && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-warning/10 border border-warning/20">
                  <AlertTriangle size={16} className="text-warning flex-shrink-0" />
                  <div>
                    <p className="text-xs text-secondary">{t("В долг", "Qarzga")}</p>
                    <p className="text-base font-bold text-warning">{cleanNum(debt)} {currency}</p>
                  </div>
                </div>
              )}

              {/* Payment method */}
              <div>
                <label className="text-xs text-secondary mb-2 block">{t("Способ оплаты", "To'lov usuli")}</label>
                <div className="grid grid-cols-3 gap-2">
                  {PM_OPTIONS.map(pm => {
                    const Icon = pm.icon;
                    const active = paymentMethod === pm.value;
                    return (
                      <button
                        key={pm.value}
                        onClick={() => setPaymentMethod(pm.value)}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all ${
                          active
                            ? "border-primary bg-primary/10 shadow-sm"
                            : "border-border-subtle hover:border-primary/30"
                        }`}
                      >
                        <Icon size={18} className={active ? "text-primary" : "text-secondary"} />
                        <span className={`text-xs ${active ? "font-semibold text-primary" : "text-secondary"}`}>
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
          <div className="neo-card p-4 space-y-3">
            <p className="font-label text-secondary text-xs tracking-wider">
              {t("ПРИМЕЧАНИЯ", "ESLATMALAR")}
            </p>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={t("Комментарий к завершению...", "Tugatish bo'yicha izoh...")}
              rows={2}
              className="text-sm"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t flex gap-3">
          <Button variant="outline" onClick={onClose} className="flex-1">
            {t("Отмена", "Bekor qilish")}
          </Button>
          <Button onClick={handleSave} disabled={saving} className="flex-1">
            {saving ? t("Сохранение...", "Saqlanmoqda...") : t("Завершить заказ", "Buyurtmani tugatish")}
          </Button>
        </div>
      </div>
    </div>
  );
}
