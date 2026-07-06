import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useSearchParams } from "react-router";
import { useEffect } from "react";
import {
  CheckCircle2, AlertTriangle, Zap, ExternalLink, Loader2,
} from "lucide-react";
import { format } from "date-fns";

const PLAN_FEATURES: Record<string, string[]> = {
  basic:     ["5 пользователей", "50 товаров", "Базовая аналитика", "Складской учёт", "Email-поддержка"],
  pro:       ["20 пользователей", "100 товаров", "Полная аналитика", "GPS-трекинг", "Интеграция с 1С", "Приоритетная поддержка"],
  exclusive: ["Безлимит пользователей", "Безлимит товаров", "API доступ", "White-label", "Выделенный сервер", "24/7 поддержка"],
};

export default function BillingSettings() {
  const [searchParams] = useSearchParams();
  const { data: sub, isLoading, refetch } = trpc.stripe.getSubscription.useQuery();
  trpc.stripe.getPlans.useQuery();

  const checkout = trpc.stripe.createCheckoutSession.useMutation({
    onSuccess: (d) => { window.location.href = d.url; },
    onError:   (e) => notify.error(e.message),
  });

  const portal = trpc.stripe.createBillingPortalSession.useMutation({
    onSuccess: (d) => { window.location.href = d.url; },
    onError:   (e) => notify.error(e.message),
  });

  useEffect(() => {
    if (searchParams.get("success") === "1") {
      notify.success("Подписка подключена!");
      refetch();
    }
    if (searchParams.get("canceled") === "1") {
      notify.info("Оплата отменена.");
    }
  }, [searchParams, refetch]);

  if (isLoading) return <div className="h-64 bg-surface-light animate-pulse rounded"/>;
  if (!sub)      return null;

  const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
    trialing:   { label: "Пробный период",    color: "text-info",    icon: CheckCircle2   },
    active:     { label: "Активна",           color: "text-success", icon: CheckCircle2   },
    past_due:   { label: "Ошибка оплаты",     color: "text-danger",  icon: AlertTriangle  },
    canceled:   { label: "Отменена",          color: "text-danger",  icon: AlertTriangle  },
    incomplete: { label: "Не завершена",      color: "text-warning", icon: AlertTriangle  },
  };

  const cfg     = STATUS_CONFIG[sub.status] ?? STATUS_CONFIG.canceled;
  const Icon    = cfg.icon;
  const hasStripe = !!sub.stripeSubscriptionId;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="font-display text-2xl font-bold text-text-primary tracking-tight">
        Подписка
      </h1>

      {/* Current status */}
      <div className="panel p-6">
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
            sub.isActive ? "bg-success/15" : "bg-danger/15"
          }`}>
            <Icon size={22} className={cfg.color}/>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="font-display text-lg font-semibold text-text-primary">
                {sub.plan.charAt(0).toUpperCase() + sub.plan.slice(1)}
              </h2>
              <span className={`status-badge ${
                sub.isActive ? "bg-success/15 text-success border-success/30" : "bg-danger/15 text-danger border-danger/30"
              }`}>
                {cfg.label}
              </span>
            </div>
            {sub.isTrialing && sub.daysLeft !== null && (
              <p className="text-sm text-text-secondary mt-1">
                Пробный период заканчивается через <b className={sub.daysLeft <= 3 ? "text-danger" : "text-text-primary"}>
                  {sub.daysLeft} дн.
                </b>
                {sub.trialEndsAt && ` (${format(new Date(sub.trialEndsAt), "dd.MM.yyyy")})`}
              </p>
            )}
            {sub.currentPeriodEnds && !sub.isTrialing && (
              <p className="text-sm text-text-secondary mt-1">
                Следующее списание: {format(new Date(sub.currentPeriodEnds), "dd.MM.yyyy")}
              </p>
            )}
          </div>
          {hasStripe && (
            <button
              onClick={() => portal.mutate()}
              disabled={portal.isPending}
              className="btn-secondary flex items-center gap-2 text-sm py-2 flex-shrink-0"
            >
              {portal.isPending ? <Loader2 size={14} className="animate-spin"/> : <ExternalLink size={14}/>}
              Управление
            </button>
          )}
        </div>
      </div>

      {/* Plans */}
      <div>
        <h2 className="font-label text-text-secondary tracking-wider text-xs mb-4">ТАРИФЫ</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { key: "basic",     name: "Basic",     price: "299 000 сум/мес",  highlight: false },
            { key: "pro",       name: "Pro",       price: "599 000 сум/мес",  highlight: true  },
            { key: "exclusive", name: "Exclusive", price: "1 299 000 сум/мес", highlight: false },
          ].map(plan => {
            const isCurrent = sub.plan === plan.key && sub.isActive;
            const features  = PLAN_FEATURES[plan.key] ?? [];
            return (
              <div key={plan.key}
                className={`panel p-5 flex flex-col gap-4 ${plan.highlight ? "border-primary" : ""} ${isCurrent ? "bg-primary/5" : ""}`}>
                {plan.highlight && (
                  <span className="self-start status-badge bg-primary/15 text-primary border-primary/30 text-[10px]">
                    ПОПУЛЯРНЫЙ
                  </span>
                )}
                <div>
                  <p className="font-display text-lg font-bold text-text-primary">{plan.name}</p>
                  <p className="font-data text-2xl font-bold text-primary mt-1">{plan.price}</p>
                </div>
                <ul className="space-y-2 flex-1">
                  {features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-sm text-text-secondary">
                      <CheckCircle2 size={14} className="text-success flex-shrink-0"/>
                      {f}
                    </li>
                  ))}
                </ul>
                {isCurrent ? (
                  <div className="btn-secondary w-full text-center py-2 text-sm opacity-60 cursor-default">
                    Текущий тариф
                  </div>
                ) : (
                  <button
                    onClick={() => checkout.mutate({ plan: plan.key as "basic" | "pro" | "exclusive" })}
                    disabled={checkout.isPending}
                    className="btn-primary w-full flex items-center justify-center gap-2 py-2 text-sm"
                  >
                    {checkout.isPending ? <Loader2 size={14} className="animate-spin"/> : <Zap size={14}/>}
                    {sub.isTrialing ? "Подключить" : "Перейти"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Trial features */}
      {sub.isTrialing && (
        <div className="panel p-5 border-info/30 bg-info/5">
          <p className="font-label text-info text-xs tracking-wider mb-3">В ПРОБНОМ ПЕРИОДЕ ДОСТУПНО</p>
          <ul className="space-y-1.5">
            {PLAN_FEATURES.trial.map(f => (
              <li key={f} className="flex items-center gap-2 text-sm text-text-secondary">
                <CheckCircle2 size={14} className="text-info"/>
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
