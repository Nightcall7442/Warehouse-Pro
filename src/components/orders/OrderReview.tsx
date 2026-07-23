import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { Store, AlertTriangle } from "lucide-react";
import { calcDiscount, calcSubtotal } from "@/lib/order-calculations";
import { PAYMENT_METHODS, unitLabel } from "./types";
import type { OrderItem, PaymentMethod } from "./types";

interface OrderReviewProps {
  shopName: string;
  items: OrderItem[];
  notes: string;
  onNotesChange: (v: string) => void;
  discount: string;
  onDiscountChange: (v: string) => void;
  paymentMethod: PaymentMethod;
  onPaymentMethodChange: (v: PaymentMethod) => void;
}

export function OrderReview({
  shopName, items, notes, onNotesChange,
  discount, onDiscountChange,
  paymentMethod, onPaymentMethodChange,
}: OrderReviewProps) {
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const validItems = items.filter(i => i.productId > 0 && Number(i.quantity) > 0);
  const subtotal = calcSubtotal(validItems);
  const disc = calcDiscount(discount, subtotal);
  const total = subtotal - disc;
  const totalWeightKg = validItems.reduce((s, i) => s + Number(i.quantity) * (i.unitWeight || 1), 0);

  return (
    <div className="space-y-4 animate-fade-up">
      <p className="font-label text-[10px] text-secondary tracking-wider">
        {t("ПОДТВЕРЖДЕНИЕ ЗАКАЗА", "BUYURTMANI TASDIQLASH")}
      </p>

      <div className="neo-card p-4 space-y-3">
        {/* Shop */}
        <div className="flex items-center gap-2.5 pb-3" style={{ borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
          <Store size={14} className="text-secondary flex-shrink-0"/>
          <span className="text-sm text-primary font-medium">{shopName}</span>
        </div>

        {/* Items */}
        <div className="space-y-2.5">
          {validItems.map((item, i) => (
            <div key={i} className="flex items-center justify-between text-sm gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-primary truncate">{item.productName}</p>
                <p className="text-xs text-secondary font-data mt-0.5">
                  {item.quantity} {unitLabel(item.unit, lang)} × {fmt(item.unitPrice)}
                </p>
              </div>
              <span className="font-data text-primary font-medium flex-shrink-0">
                {fmt((Number(item.unitPrice) * Number(item.quantity)).toFixed(2))}
              </span>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="space-y-2 pt-3" style={{ borderTop: "1px solid var(--color-border, #f0f3f8)" }}>
          <div className="flex justify-between text-sm">
            <span className="text-secondary">{t("Подитого", "Jami")}</span>
            <span className="font-data text-primary">{fmt(subtotal.toFixed(2))}</span>
          </div>
          {/* Discount field */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-secondary flex-shrink-0">{t("Скидка", "Chegirma")}</span>
            <div className="relative w-28">
              <input
                className="neo-input text-right font-data py-1.5 text-sm"
                type="number"
                min="0"
                max={subtotal}
                step="0.01"
                placeholder="0.00"
                value={discount}
                onChange={e => onDiscountChange(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-between pt-1">
            <span className="font-semibold text-primary">{t("ИТОГО", "JAMI")}</span>
            <span className="font-data text-xl font-bold text-primary">{fmt(total.toFixed(2))}</span>
          </div>
          {totalWeightKg > 0 && (
            <div className="flex justify-between pt-1">
              <span className="text-sm text-secondary">{t("Общий вес", "Umumiy og'irlik")}</span>
              <span className="font-data text-sm font-semibold text-primary">{totalWeightKg.toFixed(2)} кг</span>
            </div>
          )}
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
          {t("ПРИМЕЧАНИЯ (ОПЦИОНАЛЬНО)", "ESLATMALAR (IXTIYORIY)")}
        </label>
        <textarea
          className="neo-input w-full resize-none"
          rows={3}
          placeholder={t("Особые инструкции…", "Maxsus ko'rsatmalar…")}
          value={notes}
          onChange={e => onNotesChange(e.target.value)}
        />
      </div>

      {/* Payment Method */}
      <div>
        <label className="font-label text-[10px] text-secondary tracking-wider block mb-2">
          {t("МЕТОД ОПЛАТЫ *", "TO'LOV USULI *")}
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          {(Object.entries(PAYMENT_METHODS) as [PaymentMethod, typeof PAYMENT_METHODS[PaymentMethod]][]).map(([key, method]) => {
            const Icon = method.icon;
            const isActive = paymentMethod === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onPaymentMethodChange(key)}
                style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "12px 14px", borderRadius: "12px",
                  border: isActive ? `2px solid ${method.color}` : "2px solid var(--color-border, #f0f3f8)",
                  background: isActive ? `${method.color}10` : "var(--color-surface, #ffffff)",
                  cursor: "pointer", transition: "all 0.15s ease",
                  boxShadow: isActive ? `0 2px 8px ${method.color}20` : "none",
                }}
              >
                <div style={{
                  width: "32px", height: "32px", borderRadius: "8px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: isActive ? method.color : "var(--color-surface-light, #f0f3f8)",
                  flexShrink: 0,
                }}>
                  <Icon size={16} style={{ color: isActive ? "#fff" : "var(--color-text-secondary, #6a7290)" }} />
                </div>
                <span style={{
                  fontSize: "13px", fontWeight: isActive ? 600 : 500,
                  color: isActive ? method.color : "var(--color-text-primary, #2b3450)",
                  fontFamily: "'DM Sans', sans-serif",
                }}>
                  {lang === "uz" ? method.uz : method.ru}
                </span>
              </button>
            );
          })}
        </div>
        {paymentMethod === "debt" && (
          <div style={{
            display: "flex", alignItems: "center", gap: "8px", marginTop: "10px",
            padding: "10px 14px", borderRadius: "10px",
            background: "rgba(232,168,48,0.08)", border: "1px solid rgba(232,168,48,0.2)",
          }}>
            <AlertTriangle size={14} style={{ color: "#d4973a", flexShrink: 0 }} />
            <span style={{ fontSize: "12px", color: "#d4973a", fontWeight: 500 }}>
              {t("Сумма заказа будет добавлена к долгу магазина", "Buyurtma summasi do'kon qarziga qo'shiladi")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
