import { trpc } from "@/providers/trpc";
import { useNavigate } from "react-router";
import { AlertTriangle, X, Zap } from "lucide-react";
import { useState } from "react";
import { useTranslate } from "@/i18n";

/*
  Сколько дней до конца срока полоса уже видна. Оплаченному — за неделю:
  продлевают заявкой, и между «нажал» и «включили» проходит звонок и перевод.
  Письма уходят за 7, 3 и 1 день (api/cron/trial-reminders.ts).
*/
const TRIAL_WARN_DAYS = 3;
const PAID_WARN_DAYS  = 7;

export function TrialBanner() {
  const t = useTranslate();
  const { data: sub }       = trpc.stripe.getSubscription.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();

  if (!sub || dismissed) return null;

  /*
    Оплаченный срок — по дате, как пробный.

    Раньше «active» значило «молчать» всегда: у платящей организации полоса
    не появлялась ни за неделю, ни в последний день, и о конце срока она
    узнавала по запертому входу. Stripe продлевает списанием сам — там
    по-прежнему тихо.
  */
  const days      = sub.daysLeft ?? 0;
  const paid      = sub.status === "active" && !sub.stripeSubscriptionId;
  if (sub.status === "active" && !paid) return null;
  if (sub.isTrialing && days > TRIAL_WARN_DAYS) return null;
  if (paid && days > PAID_WARN_DAYS) return null;

  // Canceled — always show
  const isCanceled   = sub.isCanceled;
  const isPastDue    = sub.isPastDue;
  const expired      = (sub.isTrialing || paid) && days === 0;
  const trialUrgent  = sub.isTrialing && days > 0;
  const paidEnding   = paid && days > 0;

  let message = "";
  let urgent  = false;

  if (isCanceled || expired) {
    message = t("Подписка неактивна. Обновите тариф чтобы продолжить работу.", "Obuna faol emas. Ishni davom ettirish uchun tarifni yangilang.");
    urgent  = true;
  } else if (isPastDue) {
    message = t("Ошибка оплаты. Обновите платёжные данные.", "To'lovda xatolik. To'lov ma'lumotlarini yangilang.");
    urgent  = true;
  } else if (trialUrgent) {
    message = t(`Пробный период заканчивается через ${days} дн.`, `Sinov muddati tugashiga ${days} kun qoldi`);
    urgent  = days <= 1;
  } else if (paidEnding) {
    message = t(`Оплаченный срок заканчивается через ${days} дн.`, `To'langan muddat tugashiga ${days} kun qoldi`);
    urgent  = days <= 1;
  }

  if (!message) return null;

  return (
    <div style={{
      width: "100%", padding: "10px 16px", display: "flex", alignItems: "center", gap: "12px",
      fontSize: "13px", fontFamily: "'Manrope', sans-serif",
      background: urgent ? "var(--color-danger)" : "var(--color-warning-subtle, #fffbeb)",
      color: urgent ? "#fff" : "var(--color-warning, #d4973a)",
      borderBottom: urgent ? "none" : "1px solid rgba(217,119,6,0.2)",
    }}>
      <AlertTriangle size={16} style={{ flexShrink: 0 }}/>
      <span style={{ flex: 1 }}>{message}</span>
      {/* Тарифы в сумах и заявка. /settings/billing — Stripe в долларах,
          который здесь не настроен: «Подключить» там отвечало ошибкой. */}
      <button
        onClick={() => navigate("/billing")}
        style={{
          display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", fontWeight: 600,
          padding: "6px 12px", borderRadius: "6px", border: "none", cursor: "pointer",
          fontFamily: "'Manrope', sans-serif",
          background: urgent ? "rgba(255,255,255,0.2)" : "var(--color-warning)",
          color: urgent ? "#fff" : "#fff",
          flexShrink: 0,
        }}
      >
        <Zap size={12}/>{paid ? t("Продлить", "Uzaytirish") : t("Подключить", "Ulash")}
      </button>
      {!urgent && (
        <button onClick={() => setDismissed(true)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.6, flexShrink: 0 }}>
          <X size={16}/>
        </button>
      )}
    </div>
  );
}
