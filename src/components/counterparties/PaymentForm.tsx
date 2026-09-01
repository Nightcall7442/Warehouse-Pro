import { useState } from "react";
import { Loader2 } from "lucide-react";
import { AppModal, modalFieldLabel } from "@/components/ui/AppModal";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { PremiumSelect } from "@/components/PremiumSelect";
import { COLORS, money, PAYMENT_METHODS } from "./constants";

export interface PayableSupply {
  id: number;
  supplyNumber: string;
  supplierName: string;
  currency: string;
  debt: number;
}

export interface PaymentValues {
  supplyId: number;
  amount: string;
  paymentMethod: "cash" | "card" | "transfer";
  notes?: string;
  idempotencyKey: string;
}

/**
 * Запись платежа контрагенту.
 *
 * Сумма подставляется полным остатком: чаще всего платят именно его, а если
 * платят часть — поправить одно поле легче, чем набрать длинное число заново.
 *
 * Переплату не пропускает не только сервер, но и форма: сообщить о превышении
 * до отправки честнее, чем принять ввод и вернуть отказ. На сервере проверка
 * всё равно остаётся — форма её дублирует для удобства, а не заменяет.
 */
export function PaymentForm({ open, supply, isPending, lang, onPay, onClose }: {
  open: boolean;
  supply: PayableSupply | null;
  isPending: boolean;
  lang: string;
  onPay: (values: PaymentValues) => void;
  onClose: () => void;
}) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [amount, setAmount] = useState(() => (supply ? supply.debt.toFixed(2) : ""));
  const [method, setMethod] = useState<"cash" | "card" | "transfer">("transfer");
  const [notes, setNotes] = useState("");
  // Пересоздаётся вместе с окном: тот же ключ на втором платеже подряд
  // получил бы ответ «уже записан» вместо новой записи.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  if (!supply) return null;

  const value = Number(amount);
  const tooMuch = value > supply.debt + 0.005;
  const canPay = value > 0 && !tooMuch && !isPending;

  return (
    <AppModal
      open={open}
      onClose={onClose}
      maxWidth={480}
      title={t("Платёж контрагенту", "Kontragentga to'lov")}
      subtitle={`${supply.supplierName} · ${supply.supplyNumber}`}
      footer={
        <>
          <button
            data-testid="payment-submit"
            onClick={() => canPay && onPay({
              supplyId: supply.id, amount, paymentMethod: method,
              notes: notes || undefined, idempotencyKey,
            })}
            disabled={!canPay}
            className="neo-btn-primary flex-1 h-11 text-sm flex items-center justify-center gap-2"
            style={{ opacity: canPay ? 1 : 0.5 }}
          >
            {isPending && <Loader2 size={15} className="animate-spin" />}
            {t("Записать платёж", "To'lovni yozish")}
          </button>
          <button onClick={onClose} className="neo-btn flex-1 h-11 text-sm">{t("Отмена", "Bekor qilish")}</button>
        </>
      }
    >
      <div className="space-y-4">
        <div style={{ padding: "14px 16px", borderRadius: "12px", background: COLORS.surfaceLight, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "13px", color: COLORS.textSecondary }}>{t("Остаток долга", "Qarz qoldig'i")}</span>
          <span style={{ fontSize: "18px", fontWeight: 700, color: COLORS.dangerText }}>{money(supply.debt, supply.currency)}</span>
        </div>

        <div>
          <label className={modalFieldLabel}>{t("Сумма платежа", "To'lov summasi")} ({supply.currency})</label>
          <DecimalInput
            data-testid="payment-amount"
            className="neo-input"
            style={{ width: "100%", textAlign: "right", fontSize: "17px", fontWeight: 600 }}
            value={amount}
            onValueChange={setAmount}
          />
          {tooMuch && (
            <p style={{ fontSize: "12px", color: COLORS.dangerText, margin: "6px 0 0" }}>
              {t("Больше остатка — платёж не пройдёт", "Qoldiqdan ko'p — to'lov o'tmaydi")}
            </p>
          )}
        </div>

        {/* Частые доли остатка одним нажатием: половина и «всё». Именно так
            обычно и платят — «половину сейчас, остальное потом». */}
        <div style={{ display: "flex", gap: "8px" }}>
          {[
            { label: "50%", value: supply.debt / 2 },
            { label: t("Весь остаток", "Butun qoldiq"), value: supply.debt },
          ].map(preset => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setAmount(preset.value.toFixed(2))}
              className="neo-btn"
              style={{ flex: 1, height: "36px", fontSize: "12px" }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div>
          <label className={modalFieldLabel}>{t("Способ оплаты", "To'lov usuli")}</label>
          <PremiumSelect
            value={method}
            onChange={v => setMethod(v as "cash" | "card" | "transfer")}
            options={(["cash", "card", "transfer"] as const).map(k => ({
              value: k, label: PAYMENT_METHODS[k][lang === "uz" ? "uz" : "ru"],
            }))}
            width="100%"
          />
        </div>

        <div>
          <label className={modalFieldLabel}>{t("Примечание", "Izoh")}</label>
          <input
            className="neo-input"
            style={{ width: "100%" }}
            placeholder={t("Необязательно", "Ixtiyoriy")}
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>
      </div>
    </AppModal>
  );
}
