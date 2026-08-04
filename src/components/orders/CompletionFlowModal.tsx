import { useState, useEffect } from "react";
import {
  X, Package, CreditCard, RotateCcw, CheckCircle, AlertTriangle,
  Banknote, Repeat,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslate, useLang } from "@/i18n";
import { F, COLORS, InfoCard, PillButton } from "./theme";

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

  // Reset state when modal opens
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
      setError(null);
    }
  }, [open, items]);

  // Keyboard: Escape to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open]);

  if (!open) return null;

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

  const modeIcon = mode === "partial_return" ? RotateCcw : mode === "combined" ? Package : CreditCard;
  const ModeIcon = modeIcon;

  return (
    <div
      className="pointer-events-auto"
      style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}
      role="dialog"
      aria-modal="true"
      aria-label={TITLE_MAP[mode][lang === "uz" ? "uz" : "ru"]}
    >
      {/* Backdrop — clicks here close modal only, not Sheet */}
      <div className="pointer-events-auto" style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }} onClick={onClose} />

      {/* Modal content */}
      <div
        className="pointer-events-auto"
        style={{
          position: "relative", zIndex: 10, width: "100%", maxWidth: "640px", maxHeight: "85vh",
          display: "flex", flexDirection: "column",
          borderRadius: "20px", background: COLORS.surface, border: `1px solid ${COLORS.border}`,
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header — fixed */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px", borderBottom: `1px solid ${COLORS.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: `${COLORS.primary}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ModeIcon size={20} color={COLORS.primary} />
            </div>
            <div>
              <h2 style={{ fontFamily: F.display, fontSize: "17px", fontWeight: 700, color: COLORS.textPrimary }}>{TITLE_MAP[mode][lang === "uz" ? "uz" : "ru"]}</h2>
              <p style={{ fontFamily: F.body, fontSize: "11px", color: COLORS.textSecondary }}>{t("Заказ", "Buyurtma")} {orderNumber}</p>
            </div>
          </div>
          <button
            onClick={onClose} aria-label={t("Закрыть", "Yopish")}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "32px", height: "32px", borderRadius: "10px", border: "none", background: COLORS.surfaceLight, color: COLORS.textSecondary, cursor: "pointer" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body — scrollable */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: "18px", minHeight: 0 }}>

          {/* Error banner */}
          {error && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px", borderRadius: "10px", background: `${COLORS.danger}12`, border: `1px solid ${COLORS.danger}30`, fontFamily: F.body, fontSize: "13px", color: COLORS.danger }}>
              <AlertTriangle size={16} style={{ flexShrink: 0 }} />
              {error}
            </div>
          )}

          {/* ── Return items section ── */}
          {showReturnItems && (
            <div style={{ padding: "16px", borderRadius: "14px", border: `1px solid ${COLORS.border}`, display: "flex", flexDirection: "column", gap: "12px" }}>
              <p style={{ display: "flex", alignItems: "center", gap: "6px", fontFamily: F.body, fontSize: "11px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: COLORS.textTertiary }}>
                <Package size={14}/> {t("ТОВАРЫ", "MAHSULOTLAR")} ({itemStates.length})
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {itemStates.map((it, idx) => {
                  const unitLabel = UNIT_LABELS[it.unit ?? "pcs"]?.[lang] ?? "шт";
                  const kept = it.orderedQty - it.returnedQty;
                  return (
                    <div key={it.itemId} style={{
                      padding: "12px", borderRadius: "12px",
                      border: `1px solid ${it.isReturned ? COLORS.danger + "40" : COLORS.border}`,
                      background: it.isReturned ? `${COLORS.danger}08` : COLORS.surfaceLight,
                      transition: "background 0.15s",
                    }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "8px" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontFamily: F.body, fontSize: "13px", fontWeight: 500, color: COLORS.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.productName}</p>
                          {it.productCode && <p style={{ fontFamily: F.display, fontSize: "10px", color: COLORS.textTertiary }}>{it.productCode}</p>}
                          <p style={{ fontFamily: F.body, fontSize: "11px", color: COLORS.textSecondary, marginTop: "4px" }}>
                            {t("Заказано", "Buyurtma")}: {it.orderedQty} {unitLabel} × {cleanNum(it.unitPrice)} {currency}
                          </p>
                        </div>
                        <button
                          onClick={() => toggleReturned(idx)}
                          style={{
                            padding: "6px 12px", borderRadius: "9999px", fontFamily: F.body, fontSize: "11px", fontWeight: 600, cursor: "pointer",
                            background: it.isReturned ? `${COLORS.danger}15` : `${COLORS.success}15`,
                            color: it.isReturned ? COLORS.danger : COLORS.success,
                            border: `1px solid ${it.isReturned ? COLORS.danger : COLORS.success}30`,
                          }}
                        >
                          {it.isReturned ? t("Возврат", "Qaytarish") : t("Оставил", "Oldi")}
                        </button>
                      </div>

                      {it.isReturned ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontFamily: F.body, fontSize: "11px", fontWeight: 500, color: COLORS.danger }}>
                            <RotateCcw size={12} />
                            <span>{t("Магазин вернул этот товар", "Do'kon bu tovarni qaytardi")}</span>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "8px" }}>
                            <div>
                              <label htmlFor={`ret-qty-${it.itemId}`} style={{ display: "block", fontFamily: F.body, fontSize: "10px", color: COLORS.textSecondary, marginBottom: "4px" }}>{t("Кол-во", "Miqdor")}</label>
                              <Input
                                id={`ret-qty-${it.itemId}`}
                                type="number" min={0} max={it.orderedQty}
                                value={it.returnedQty}
                                onChange={e => setReturnedQty(idx, Number(e.target.value))}
                                className="h-8 text-sm"
                              />
                            </div>
                            <div>
                              <label htmlFor={`ret-reason-${it.itemId}`} style={{ display: "block", fontFamily: F.body, fontSize: "10px", color: COLORS.textSecondary, marginBottom: "4px" }}>{t("Причина", "Sabab")}</label>
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
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px", fontFamily: F.body, fontSize: "11px", color: COLORS.success }}>
                          <CheckCircle size={12} />
                          <span>{t("Магазин оставил", "Do'kon oldi")}: <b>{kept}</b> {unitLabel}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div style={{ padding: "10px", borderRadius: "10px", background: `${COLORS.success}0d`, textAlign: "center" }}>
                  <p style={{ fontFamily: F.body, fontSize: "10px", color: COLORS.textSecondary }}>{t("Оставлено", "Olingan")}</p>
                  <p style={{ fontFamily: F.display, fontSize: "18px", fontWeight: 700, color: COLORS.success }}>{totalKept}</p>
                </div>
                <div style={{ padding: "10px", borderRadius: "10px", background: `${COLORS.danger}0d`, textAlign: "center" }}>
                  <p style={{ fontFamily: F.body, fontSize: "10px", color: COLORS.textSecondary }}>{t("Возврат", "Qaytarilgan")}</p>
                  <p style={{ fontFamily: F.display, fontSize: "18px", fontWeight: 700, color: COLORS.danger }}>{totalReturned}</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Payment section ── */}
          {showPayment && (
            <div style={{ padding: "16px", borderRadius: "14px", border: `1px solid ${COLORS.border}`, display: "flex", flexDirection: "column", gap: "12px" }}>
              <p style={{ display: "flex", alignItems: "center", gap: "6px", fontFamily: F.body, fontSize: "11px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: COLORS.textTertiary }}>
                <CreditCard size={14}/> {t("ОПЛАТА", "TO'LOV")}
              </p>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px", borderRadius: "10px", background: COLORS.surfaceLight }}>
                <span style={{ fontFamily: F.body, fontSize: "13px", color: COLORS.textSecondary }}>{t("Сумма заказа", "Buyurtma summasi")}</span>
                <span style={{ fontFamily: F.display, fontSize: "17px", fontWeight: 700, color: COLORS.textPrimary }}>{cleanNum(total)} {currency}</span>
              </div>

              <div>
                <label htmlFor="paid-amount" style={{ display: "block", fontFamily: F.body, fontSize: "11px", color: COLORS.textSecondary, marginBottom: "4px" }}>{t("Сумма оплаты", "To'lov summasi")}</label>
                <Input
                  id="paid-amount"
                  type="number" min={0} max={total}
                  value={paidAmount}
                  onChange={e => { setPaidAmount(e.target.value); setError(null); }}
                  placeholder="0"
                  className="h-10 text-base font-bold"
                  style={{ fontFamily: F.display }}
                />
              </div>

              {paidAmount && Number(paidAmount) > 0 && Number(paidAmount) < total && (
                <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px", borderRadius: "10px", background: `${COLORS.warning}12`, border: `1px solid ${COLORS.warning}30` }}>
                  <AlertTriangle size={16} color={COLORS.warning} style={{ flexShrink: 0 }} />
                  <div>
                    <p style={{ fontFamily: F.body, fontSize: "11px", color: COLORS.textSecondary }}>{t("В долг", "Qarzga")}</p>
                    <p style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 700, color: COLORS.warning }}>{cleanNum(debt)} {currency}</p>
                  </div>
                </div>
              )}

              <div>
                <p style={{ fontFamily: F.body, fontSize: "11px", color: COLORS.textSecondary, marginBottom: "8px" }}>{t("Способ оплаты", "To'lov usuli")}</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                  {PM_OPTIONS.map(pm => {
                    const Icon = pm.icon;
                    const active = paymentMethod === pm.value;
                    return (
                      <button
                        key={pm.value}
                        type="button"
                        onClick={() => setPaymentMethod(pm.value)}
                        style={{
                          display: "flex", flexDirection: "column", alignItems: "center", gap: "6px",
                          padding: "12px", borderRadius: "10px", cursor: "pointer",
                          border: `1.5px solid ${active ? COLORS.primary : COLORS.border}`,
                          background: active ? `${COLORS.primary}0d` : "transparent",
                          transition: "all 0.15s",
                        }}
                      >
                        <Icon size={18} color={active ? COLORS.primary : COLORS.textSecondary} />
                        <span style={{ fontFamily: F.body, fontSize: "11px", fontWeight: active ? 600 : 400, color: active ? COLORS.primary : COLORS.textSecondary }}>
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
          <InfoCard label={t("ПРИМЕЧАНИЯ", "ESLATMALAR")} icon={null}>
            <Textarea
              id="completion-notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={t("Комментарий к завершению...", "Tugatish bo'yicha izoh...")}
              rows={2}
              className="text-sm"
              style={{ marginTop: "4px" }}
            />
          </InfoCard>
        </div>

        {/* Footer — fixed */}
        <div style={{ display: "flex", gap: "10px", padding: "20px", borderTop: `1px solid ${COLORS.border}`, flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <PillButton tone="neutral" onClick={onClose} disabled={saving}>
              {t("Отмена", "Bekor qilish")}
            </PillButton>
          </div>
          <div style={{ flex: 1 }}>
            <PillButton tone="success" onClick={handleSave} disabled={saving}>
              {saving ? t("Сохранение...", "Saqlanmoqda...") : t("Завершить заказ", "Buyurtmani tugatish")}
            </PillButton>
          </div>
        </div>
      </div>
    </div>
  );
}
