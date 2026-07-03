import { trpc } from "@/providers/trpc";
import { useNavigate } from "react-router";
import { AlertTriangle, X, Zap } from "lucide-react";
import { useState } from "react";

export function TrialBanner() {
  const { data: sub }       = trpc.stripe.getSubscription.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();

  if (!sub || dismissed) return null;

  // Active paid plan — no banner
  if (sub.status === "active" && !sub.isTrialing) return null;

  // Trialing with >3 days left — no banner (not urgent)
  if (sub.isTrialing && (sub.daysLeft ?? 0) > 3) return null;

  // Canceled — always show
  const isCanceled   = sub.isCanceled;
  const isPastDue    = sub.isPastDue;
  const trialExpired = sub.isTrialing && (sub.daysLeft ?? 0) === 0;
  const trialUrgent  = sub.isTrialing && (sub.daysLeft ?? 0) <= 3 && (sub.daysLeft ?? 0) > 0;

  let message = "";
  let urgent  = false;

  if (isCanceled || trialExpired) {
    message = "Подписка неактивна. Обновите тариф чтобы продолжить работу.";
    urgent  = true;
  } else if (isPastDue) {
    message = "Ошибка оплаты. Обновите платёжные данные.";
    urgent  = true;
  } else if (trialUrgent) {
    message = `Пробный период заканчивается через ${sub.daysLeft} дн.`;
    urgent  = (sub.daysLeft ?? 0) <= 1;
  }

  if (!message) return null;

  return (
    <div className={`w-full px-4 py-2.5 flex items-center gap-3 text-sm ${
      urgent
        ? "bg-danger text-white"
        : "bg-warning/15 text-warning border-b border-warning/30"
    }`}>
      <AlertTriangle size={16} className="flex-shrink-0"/>
      <span className="flex-1">{message}</span>
      <button
        onClick={() => navigate("/settings/billing")}
        className={`flex items-center gap-1.5 font-label text-xs px-3 py-1.5 rounded transition-colors flex-shrink-0 ${
          urgent
            ? "bg-white/20 hover:bg-white/30 text-white"
            : "bg-warning text-white hover:bg-warning/90"
        }`}
      >
        <Zap size={12}/>Подключить
      </button>
      {!urgent && (
        <button onClick={() => setDismissed(true)} className="text-current opacity-60 hover:opacity-100 flex-shrink-0">
          <X size={16}/>
        </button>
      )}
    </div>
  );
}
