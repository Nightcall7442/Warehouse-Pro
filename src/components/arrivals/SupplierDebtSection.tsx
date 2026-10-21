import { useCallback, useState } from "react";
import { format } from "@/lib/business-time";
import { Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { PremiumSelect } from "@/components/PremiumSelect";
import { labelled, PAYMENT_METHOD_LABEL } from "@/lib/entity-labels";
import { errorText } from "@/lib/error-text";

/** Заказ поставщику, по которому заведён приход (arrival.getById → purchaseOrder). */
export interface LinkedOrder { id: number; number: string; supplierName: string; paymentTermsDays: number | null }

// ── Supplier Debt Section ────────────────────────────────────────────────────
//
// Показывается внутри карточки прихода, если к нему привязана поставка
// (arrival.create принимал поле supplier). Для приходов без поставщика —
// подавляющее большинство существующих — не рендерит ничего: возврат null
// ниже по компоненту.
//
// Приход по заказу поставщику поставки до проведения не имеет: долг
// рождается при проведении и на принятое (ADR 0013). Блок не пропадает
// молча — он называет поставщика заказа и говорит, когда появится долг.
export function SupplierDebtSection({ arrivalId, order, completed }: { arrivalId: number; order?: LinkedOrder | null; completed?: boolean }) {
  // useCurrency() не используется: у долга поставщику своя валюта (может
  // быть долларовой), а не валюта организации, которую отдаёт fmt().
  const { lang } = useLang();
  const t = useCallback((ru: string, uz: string) => lang === "uz" ? uz : ru, [lang]);
  const utils = trpc.useUtils();
  const { data: supply, isLoading } = trpc.supplier.getSupplyByArrival.useQuery({ arrivalId });

  const [showPayForm, setShowPayForm] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "card" | "transfer">("transfer");
  const [payNotes, setPayNotes] = useState("");
  // Пересоздаётся после каждого платежа: тот же ключ на втором платеже подряд
  // отвечал бы «уже записан» вместо того, чтобы записать новый.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const payMutation = trpc.supplier.pay.useMutation({
    onSuccess: () => {
      utils.supplier.getSupplyByArrival.invalidate({ arrivalId });
      utils.supplier.list.invalidate();
      setShowPayForm(false);
      setPayAmount("");
      setPayNotes("");
      setIdempotencyKey(crypto.randomUUID());
      notify.success(t("Платёж записан", "To'lov yozildi"));
    },
    onError: (e) => notify.error(errorText(e)),
  });

  if (isLoading) return null;
  if (!supply && order) {
    const terms = order.paymentTermsDays;
    return (
      <div style={{ marginTop: "20px" }} data-testid="supplier-debt-by-order">
        <p style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-tertiary)", marginBottom: "12px" }}>
          {t("Долг поставщику", "Yetkazib beruvchiga qarz")}
        </p>
        <div style={{ padding: "16px", borderRadius: "12px", background: "var(--color-surface-light)" }}>
          <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>{order.supplierName}</p>
          <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "2px 0 8px" }}>{t(`По заказу ${order.number}`, `${order.number} buyurtma bo'yicha`)}</p>
          <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", margin: 0 }}>
            {completed
              // Проведён, а поставки нет: принятое стоит ноль — долга нет и не будет.
              ? t("Долга по приходу нет: принятое по цене — ноль.", "Kirim bo'yicha qarz yo'q: qabul qilingan narxi — nol.")
              : terms != null
                ? t(`Долг появится, когда приход проведут: на принятое количество, срок — через ${terms} дн.`, `Qarz kirim yakunlanganda paydo bo'ladi: qabul qilingan miqdorga, muddat — ${terms} kundan keyin.`)
                : t("Долг появится, когда приход проведут: на принятое количество.", "Qarz kirim yakunlanganda paydo bo'ladi: qabul qilingan miqdorga.")}
          </p>
        </div>
      </div>
    );
  }
  if (!supply) return null;

  const currencyFmt = (n: number) => `${n.toLocaleString("ru-RU")} ${supply.currency}`;
  const hasDebt = supply.debt > 0.005;

  return (
    <div style={{ marginTop: "20px" }}>
      <p style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-tertiary)", marginBottom: "12px" }}>
        {t("Долг поставщику", "Yetkazib beruvchiga qarz")}
      </p>
      <div style={{ padding: "16px", borderRadius: "12px", background: "var(--color-surface-light)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
          <div>
            <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>{supply.supplierName}</p>
            <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>{supply.supplyNumber}</p>
          </div>
          {supply.overdue && (
            <span style={{ fontSize: "11px", fontWeight: 600, padding: "4px 10px", borderRadius: "8px", background: "color-mix(in srgb, var(--color-danger) 10%, transparent)", color: "var(--color-danger-text)" }}>
              {t("Просрочено", "Muddati o'tgan")}
            </span>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: hasDebt || showPayForm ? "12px" : 0 }}>
          <div>
            <p style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: "4px" }}>{t("Сумма", "Summa")}</p>
            <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>{currencyFmt(supply.amount)}</p>
          </div>
          <div>
            <p style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: "4px" }}>{t("Оплачено", "To'landi")}</p>
            <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-success-text, #16a34a)", margin: 0 }}>{currencyFmt(supply.paid)}</p>
          </div>
          <div>
            <p style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: "4px" }}>{t("Остаток", "Qoldiq")}</p>
            <p style={{ fontSize: "14px", fontWeight: 700, color: hasDebt ? "var(--color-danger-text)" : "var(--color-text-primary)", margin: 0 }}>{currencyFmt(supply.debt)}</p>
          </div>
        </div>

        {supply.payments.length > 0 && (
          <div style={{ marginBottom: hasDebt || showPayForm ? "12px" : 0 }}>
            {supply.payments.map((p) => (
              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid var(--color-border)", fontSize: "12px" }}>
                <span style={{ color: "var(--color-text-secondary)" }}>
                  {format(new Date(p.paidAt), "dd.MM.yyyy")} · {labelled(PAYMENT_METHOD_LABEL, p.paymentMethod, lang)}
                </span>
                <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{currencyFmt(Number(p.amount))}</span>
              </div>
            ))}
          </div>
        )}

        {hasDebt && !showPayForm && (
          <button onClick={() => { setPayAmount(supply.debt.toFixed(2)); setShowPayForm(true); }} className="neo-btn-primary neo-btn-sm">
            {t("Записать платёж", "To'lov yozish")}
          </button>
        )}

        {hasDebt && showPayForm && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-label text-[10px] text-secondary mb-1.5 block">{t("Сумма", "Summa")} ({supply.currency})</label>
                <DecimalInput className="neo-input" style={{ textAlign: "right" }} value={payAmount} onValueChange={setPayAmount} />
              </div>
              <div>
                <label className="font-label text-[10px] text-secondary mb-1.5 block">{t("Способ", "Usul")}</label>
                <PremiumSelect value={payMethod} onChange={v => setPayMethod(v as "cash" | "card" | "transfer")}
                  options={[
                    { value: "cash", label: PAYMENT_METHOD_LABEL.cash[lang] },
                    { value: "card", label: PAYMENT_METHOD_LABEL.card[lang] },
                    { value: "transfer", label: PAYMENT_METHOD_LABEL.transfer[lang] },
                  ]} width="100%" />
              </div>
            </div>
            <input className="neo-input" placeholder={t("Примечание (необязательно)", "Izoh (ixtiyoriy)")} value={payNotes} onChange={e => setPayNotes(e.target.value)} />
            <div className="flex gap-2">
              <button
                onClick={() => Number(payAmount) > 0 && payMutation.mutate({
                  supplyId: supply.id, amount: payAmount, paymentMethod: payMethod,
                  notes: payNotes || undefined, idempotencyKey,
                })}
                disabled={payMutation.isPending || !(Number(payAmount) > 0)}
                className="neo-btn-primary neo-btn-sm flex-1"
                style={{ opacity: payMutation.isPending || !(Number(payAmount) > 0) ? 0.5 : 1 }}
              >
                {payMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : t("Сохранить", "Saqlash")}
              </button>
              <button onClick={() => setShowPayForm(false)} className="neo-btn neo-btn-sm flex-1">{t("Отмена", "Bekor qilish")}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
