import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { Store, AlertTriangle } from "lucide-react";
import { calcDiscount, calcSubtotal } from "@/lib/order-calculations";
import { formatQty } from "@/lib/format";
import { PAYMENT_METHODS, unitLabel } from "./types";
import type { OrderItem, PaymentMethod } from "./types";
import { colorMix } from "@/lib/color-mix";
import { PremiumSelect } from "@/components/PremiumSelect";

interface OrderReviewProps {
  shopName: string;
  /*
    Кому засчитать продажу.

    Показывается только тем, кто оформляет заказы за других: директору,
    оператору, супервайзеру. Агент оформляет на себя, и выбор ему не нужен —
    лишнее поле в форме, которую он заполняет по двадцать раз в день.
  */
  agents?: { id: number; name: string }[];
  agentId?: number;
  onAgentChange?: (id: number) => void;
  items: OrderItem[];
  notes: string;
  onNotesChange: (v: string) => void;
  /*
    Когда обещали привезти. Значение из <input type="datetime-local">, то есть
    местное время без пояса; в момент отправки оно превращается в мгновение.

    Пусто — законно и означает «срок не называли». Подставлять сюда что-либо
    по умолчанию нельзя: это обещание магазину от лица агента, и придумать его
    за него значило бы придумать и срыв, когда срок не выдержат.
  */
  promisedAt: string;
  onPromisedAtChange: (v: string) => void;
  discount: string;
  onDiscountChange: (v: string) => void;
  paymentMethod: PaymentMethod;
  onPaymentMethodChange: (v: PaymentMethod) => void;
}

export function OrderReview({
  shopName, items, notes, onNotesChange,
  promisedAt, onPromisedAtChange,
  discount, onDiscountChange,
  paymentMethod, onPaymentMethodChange,
  agents, agentId, onAgentChange,
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
        <div className="flex items-center gap-2.5 pb-3" style={{ borderBottom: "1px solid var(--color-border, #d8d5cd)" }}>
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
        {/*
          За кем числится продажа.

          Заказ всегда приписывался ТОМУ, КТО ЕГО СОЗДАЛ. У арендатора, где
          заказы оформляет директор, весь KPI агентов оказывался пуст: продажи
          есть, а числятся за тем, кто нажал кнопку. Комиссия считается
          процентом от оформленного — значит и зарплата агентов выходила нулём.
        */}
        {agents && agents.length > 0 && onAgentChange && (
          <div className="pt-3" style={{ borderTop: "1px solid var(--color-border)" }}>
            <p className="font-label" style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: "8px" }}>
              {t("Продажа засчитывается", "Sotuv hisobga olinadi")}
            </p>
            <PremiumSelect
              value={String(agentId ?? "")}
              onChange={v => onAgentChange(Number(v))}
              width="100%"
              aria-label={t("Кому засчитать продажу", "Sotuvni kimga hisoblash")}
              options={agents.map(a => ({ value: String(a.id), label: a.name }))}
            />
            <p style={{ fontSize: "11.5px", color: "var(--color-text-tertiary)", marginTop: "6px", lineHeight: 1.45 }}>
              {t("По этому выбору считаются KPI и комиссия. По умолчанию — вы.",
                 "Shu tanlov bo'yicha KPI va komissiya hisoblanadi. Odatda — siz.")}
            </p>
          </div>
        )}

        <div className="space-y-2 pt-3" style={{ borderTop: "1px solid var(--color-border, #d8d5cd)" }}>
          <div className="flex justify-between text-sm">
            <span className="text-secondary">{t("Подитого", "Jami")}</span>
            <span className="font-data text-primary">{fmt(subtotal.toFixed(2))}</span>
          </div>
          {/* Discount field */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-secondary flex-shrink-0">{t("Скидка, %", "Chegirma, %")}</span>
            <div className="relative w-28">
              <input
                className="neo-input text-right font-data py-1.5 text-sm"
                type="number"
                min="0"
                max={100}
                step="0.01"
                placeholder="0"
                value={discount}
                onChange={e => onDiscountChange(e.target.value)}
              />
            </div>
          </div>
          {disc > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-secondary">{t("Сумма скидки", "Chegirma summasi")}</span>
              <span className="font-data text-secondary">−{fmt(disc.toFixed(2))}</span>
            </div>
          )}
          <div className="flex justify-between pt-1">
            <span className="font-semibold text-primary">{t("ИТОГО", "JAMI")}</span>
            <span className="font-data text-xl font-bold text-primary">{fmt(total.toFixed(2))}</span>
          </div>
          {totalWeightKg > 0 && (
            <div className="flex justify-between pt-1">
              <span className="text-sm text-secondary">{t("Общий вес", "Umumiy og'irlik")}</span>
              <span className="font-data text-sm font-semibold text-primary">{formatQty(totalWeightKg)} {t("кг", "kg")}</span>
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

      {/* Обещанный срок доставки */}
      <div>
        <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
          {t("КОГДА ОБЕЩАЛИ ПРИВЕЗТИ", "QACHONGA VA'DA QILINDI")}
        </label>
        <input
          type="datetime-local"
          className="neo-input w-full"
          value={promisedAt}
          onChange={e => onPromisedAtChange(e.target.value)}
        />
        <p className="text-[11px] text-secondary mt-1.5">
          {t(
            "Не называли срок — оставьте пустым. Пустое поле честнее выдуманной даты.",
            "Muddat aytilmagan bo'lsa — bo'sh qoldiring. Bo'sh maydon o'ylab topilgan sanadan halolroq.",
          )}
        </p>
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
                  border: isActive ? `2px solid ${method.color}` : "2px solid var(--color-border, #d8d5cd)",
                  background: isActive ? colorMix(method.color, 6) : "var(--color-surface, #efedea)",
                  cursor: "pointer", transition: "all 0.15s ease",
                  boxShadow: isActive ? `0 2px 8px ${colorMix(method.color, 13)}` : "none",
                }}
              >
                <div style={{
                  width: "32px", height: "32px", borderRadius: "8px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: isActive ? method.color : "var(--color-surface-light, #f6f4f0)",
                  flexShrink: 0,
                }}>
                  {/* Цвет значка на заливке — из палитры: белым словом на
                      золотой заливке тёмной темы выходит 2.4:1 при норме 4.5. */}
                  <Icon size={16} style={{ color: isActive ? "var(--color-on-primary)" : "var(--color-text-secondary)" }} />
                </div>
                <span style={{
                  fontSize: "13px", fontWeight: isActive ? 600 : 500,
                  color: isActive ? method.color : "var(--color-text-primary, #2b2a28)",
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
            // Было rgba(232,168,48,…) числом — янтарь, которого нет в палитре
            // и который в тёмной теме оставался прежним.
            background: "var(--color-warning-subtle)",
            border: `1px solid ${colorMix("var(--color-warning)", 22)}`,
          }}>
            <AlertTriangle size={14} style={{ color: "var(--color-warning-text)", flexShrink: 0 }} />
            <span style={{ fontSize: "12px", color: "var(--color-warning-text)", fontWeight: 500 }}>
              {t("Сумма заказа будет добавлена к долгу магазина", "Buyurtma summasi do'kon qarziga qo'shiladi")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
