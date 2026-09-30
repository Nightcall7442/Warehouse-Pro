import { holdReasonText } from "@contracts/hold-reason";

/**
 * Заказ ждёт офиса: причина — на виду, чтобы директор подтверждал не вслепую.
 *
 * Причина лежит в базе русской строкой (contracts/hold-reason.ts): скидка
 * выше порога, просроченный долг или обе через «; ». Узбекскому экрану она
 * переводится здесь, по тем же шаблонам, какими собиралась.
 *
 * Подсказку «переведите в „новый“» видит только тот, кто может это сделать —
 * директор и оператор (order.updateStatus).
 */
export function HoldReasonBanner({ status, holdReason, lang, canConfirm }: {
  status: string;
  holdReason: string | null | undefined;
  lang: string;
  canConfirm: boolean;
}) {
  if (status !== "pending" || !holdReason) return null;
  return (
    <div className="neo-card neo-card-static" style={{ borderRadius: "16px", padding: "10px 14px", fontSize: "13px", color: "var(--color-warning-text)" }} data-testid="order-hold-reason">
      <b>{lang === "uz" ? "Ofis tasdig'ini kutmoqda" : "Ждёт подтверждения офиса"}</b>: {holdReasonText(holdReason, lang)}
      {canConfirm && (lang === "uz" ? " — tasdiqlash uchun holatni «yangi»ga o'tkazing" : " — чтобы подтвердить, переведите в «новый»")}
    </div>
  );
}
