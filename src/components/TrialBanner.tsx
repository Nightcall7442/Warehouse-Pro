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
    <div style={{
      width: "100%", padding: "10px 16px", display: "flex", alignItems: "center", gap: "12px",
      fontSize: "13px", fontFamily: "'DM Sans', sans-serif",
      background: urgent ? "var(--color-danger, #e85050)" : "var(--color-warning-subtle, #fffbeb)",
      color: urgent ? "#fff" : "var(--color-warning, #d97706)",
      borderBottom: urgent ? "none" : "1px solid rgba(217,119,6,0.2)",
    }}>
      <AlertTriangle size={16} style={{ flexShrink: 0 }}/>
      <span style={{ flex: 1 }}>{message}</span>
      <button
        onClick={() => navigate("/settings/billing")}
        style={{
          display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", fontWeight: 600,
          padding: "6px 12px", borderRadius: "6px", border: "none", cursor: "pointer",
          fontFamily: "'DM Sans', sans-serif",
          background: urgent ? "rgba(255,255,255,0.2)" : "#e8a830",
          color: urgent ? "#fff" : "#fff",
          flexShrink: 0,
        }}
      >
        <Zap size={12}/>Подключить
      </button>
      {!urgent && (
        <button onClick={() => setDismissed(true)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.6, flexShrink: 0 }}>
          <X size={16}/>
        </button>
      )}
    </div>
  );
}
