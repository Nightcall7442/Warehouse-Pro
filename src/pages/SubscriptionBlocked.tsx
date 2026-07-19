import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { Lock, CreditCard, LogOut } from "lucide-react";
import { useLang } from "@/i18n";

export default function SubscriptionBlocked() {
  const { logout } = useAuth();
  const navigate   = useNavigate();
  const { t } = useLang();

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-4">
      <div className="neo-card w-full max-w-md p-10 text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-danger/10 flex items-center justify-center mx-auto">
          <Lock size={28} className="text-danger"/>
        </div>

        <div>
          <h1 className="font-display text-2xl font-bold text-primary">
            {t("auth.subscriptionBlocked.title")}
          </h1>
          <p className="text-secondary text-sm mt-2">
            {t("auth.subscriptionBlocked.hint")}
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => navigate("/settings/billing")}
            className="neo-btn-primary w-full flex items-center justify-center gap-2 py-3"
          >
            <CreditCard size={18}/>
            {t("auth.subscriptionBlocked.upgrade")}
          </button>
          <button
            onClick={() => logout()}
            className="neo-btn w-full flex items-center justify-center gap-2 py-3"
          >
            <LogOut size={18}/>
            {t("auth.subscriptionBlocked.logout")}
          </button>
        </div>
      </div>
    </div>
  );
}
