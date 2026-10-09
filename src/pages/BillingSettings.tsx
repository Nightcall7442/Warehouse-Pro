import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { Navigate, useSearchParams } from "react-router";
import { useEffect } from "react";
import {
  CheckCircle2, AlertTriangle, Zap, ExternalLink, Loader2,
} from "lucide-react";
import { format } from "date-fns";
import { PLANS } from '../../contracts/constants';
import { FIELD_PRICE_UZS, GRANDFATHER_UNTIL, LEGACY_PRICES_UZS, formatDay, formatSum, isGrandfathered, isLegacyPlan } from '../../contracts/pricing';
import { labelled, SUBSCRIPTION_STATUS_LABEL } from "@/lib/entity-labels";
import type { Label } from "@/lib/entity-labels";
import { useLang, useTranslate } from "@/i18n";
import { errorText } from "@/lib/error-text";

/*
  Карточный путь (Stripe, доллары) — те же тарифы, что на /billing.

  С 05.10.2026 продаётся один «Стандарт»: цена за полевого сотрудника, в
  Stripe — цена ЗА МЕСТО, количество ставит сервер (stripe-router). Прежний
  тариф показывается рядом, только пока он действует (GRANDFATHER_UNTIL), —
  чтобы его можно было продлить. Числа — из contracts/pricing.ts.
*/
const STANDARD_FEATURES: Label[] = [
  { ru: "Все функции включены", uz: "Barcha funksiyalar kiritilgan" },
  { ru: "Без ограничений по заказам, товарам и сотрудникам", uz: "Buyurtma, mahsulot va xodimlar cheklovsiz" },
  { ru: "Офис, склад, супервайзеры и директор — бесплатно", uz: "Ofis, ombor, supervayzer va direktor — bepul" },
];

export default function BillingSettings() {
  const { lang } = useLang();
  // useTranslate, а не своя стрелка: у неё постоянная личность, и её можно
  // держать в зависимостях эффекта, не перезапуская его на каждый рендер.
  const t = useTranslate();
  const [searchParams] = useSearchParams();
  const { data: sub, isLoading, refetch } = trpc.stripe.getSubscription.useQuery();
  trpc.stripe.getPlans.useQuery();

  const checkout = trpc.stripe.createCheckoutSession.useMutation({
    onSuccess: (d) => { window.location.href = d.url; },
    onError:   (e) => notify.error(errorText(e)),
  });

  const portal = trpc.stripe.createBillingPortalSession.useMutation({
    onSuccess: (d) => { window.location.href = d.url; },
    onError:   (e) => notify.error(errorText(e)),
  });

  useEffect(() => {
    if (searchParams.get("success") === "1") {
      notify.success(t("Подписка подключена!", "Obuna ulandi!"));
      refetch();
    }
    if (searchParams.get("canceled") === "1") {
      notify.info(t("Оплата отменена.", "To'lov bekor qilindi."));
    }
  }, [searchParams, refetch, t]);

  if (isLoading) return <div className="h-64 bg-surface-light animate-pulse rounded"/>;
  if (!sub)      return null;
  /*
    Этот экран — оплата картой через Stripe (доллары). Он есть, только если
    Stripe правда настроен; иначе каждая «Подключить» здесь отвечала «STRIPE_
    SECRET_KEY is not configured». Тарифы в сумах и заявка живут на /billing —
    туда и уводим того, кто пришёл по старой ссылке или закладке.
  */
  if (!sub.stripeReady) return <Navigate to="/billing" replace />;

  const STATUS_STYLE: Record<string, { color: string; icon: typeof CheckCircle2 }> = {
    trialing:   { color: "text-info",    icon: CheckCircle2   },
    active:     { color: "text-success", icon: CheckCircle2   },
    past_due:   { color: "text-danger",  icon: AlertTriangle  },
    canceled:   { color: "text-danger",  icon: AlertTriangle  },
    incomplete: { color: "text-warning", icon: AlertTriangle  },
  };

  /*
    Незнакомое состояние подписки не выдаётся за отменённую.

    Здесь стояло `?? STATUS_CONFIG.canceled`. Платёжная система заводит новые
    состояния сама, без нашего участия, и подмена показала бы владельцу
    «Отменена» — то есть заставила бы его звонить и разбираться с тем, чего
    не было.
  */
  const style   = STATUS_STYLE[sub.status] ?? { color: "text-secondary", icon: AlertTriangle };
  const cfg     = { ...style, label: labelled(SUBSCRIPTION_STATUS_LABEL, sub.status, lang) };
  const Icon    = cfg.icon;
  const hasStripe = !!sub.stripeSubscriptionId;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="hidden md:block font-display text-2xl font-bold text-primary tracking-tight">
        {t("Подписка", "Obuna")}
      </h1>

      {/* Current status */}
      <div className="neo-card p-6">
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
            sub.isActive ? "bg-success/15" : "bg-danger/15"
          }`}>
            <Icon size={22} className={cfg.color}/>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="font-display text-lg font-semibold text-primary">
                {sub.plan.charAt(0).toUpperCase() + sub.plan.slice(1)}
              </h2>
              <span className={`status-badge ${
                sub.isActive ? "bg-success/15 text-success border-success/30" : "bg-danger/15 text-danger border-danger/30"
              }`}>
                {cfg.label}
              </span>
            </div>
            {sub.isTrialing && sub.daysLeft !== null && (
              <p className="text-sm text-secondary mt-1">
                {t("Пробный период заканчивается через", "Sinov muddati tugashiga")} <b className={sub.daysLeft <= 3 ? "text-danger" : "text-primary"}>
                  {sub.daysLeft} {t("дн.", "kun")}
                </b>{t("", " qoldi")}
                {sub.trialEndsAt && ` (${format(new Date(sub.trialEndsAt), "dd.MM.yyyy")})`}
              </p>
            )}
            {sub.currentPeriodEnds && !sub.isTrialing && (
              <p className="text-sm text-secondary mt-1">
                {t("Следующее списание", "Keyingi to'lov")}: {format(new Date(sub.currentPeriodEnds), "dd.MM.yyyy")}
              </p>
            )}
          </div>
          {hasStripe && (
            <button
              onClick={() => portal.mutate()}
              disabled={portal.isPending}
              className="neo-btn flex items-center gap-2 text-sm py-2 flex-shrink-0"
            >
              {portal.isPending ? <Loader2 size={14} className="animate-spin"/> : <ExternalLink size={14}/>}
              {t("Управление", "Boshqarish")}
            </button>
          )}
        </div>
      </div>

      {/* Plans */}
      <div>
        <h2 className="font-label text-secondary tracking-wider text-xs mb-4">{t("ТАРИФЫ", "TARIFLAR")}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { key: "standard", name: PLANS.standard.nameRu, price: `${formatSum(FIELD_PRICE_UZS)} ${t("сум/мес за полевого", "so'm/oy har bir dala xodimi")}`, highlight: true, features: STANDARD_FEATURES },
            ...(isLegacyPlan(sub.plan) && isGrandfathered(sub.plan, new Date())
              ? [{ key: sub.plan, name: PLANS[sub.plan].name, price: `${formatSum(LEGACY_PRICES_UZS[sub.plan])} ${t("сум/мес", "so'm/oy")}`, highlight: false, features: [{ ru: `Прежний тариф — продление до ${formatDay(GRANDFATHER_UNTIL)}`, uz: `Avvalgi tarif — ${formatDay(GRANDFATHER_UNTIL)} gacha uzaytirish` }] as Label[] }]
              : []),
          ].map(plan => {
            const isCurrent = sub.plan === plan.key && sub.isActive;
            const features  = plan.features;
            return (
              <div key={plan.key}
                className={`panel p-5 flex flex-col gap-4 ${plan.highlight ? "border-primary" : ""} ${isCurrent ? "bg-primary/5" : ""}`}>
                {plan.highlight && (
                  <span className="self-start status-badge bg-primary/15 text-primary border-primary/30 text-[10px]">
                    {t("ПОПУЛЯРНЫЙ", "OMMABOP")}
                  </span>
                )}
                <div>
                  <p className="font-display text-lg font-bold text-primary">{plan.name}</p>
                  <p className="font-data text-2xl font-bold text-primary mt-1">{plan.price}</p>
                </div>
                <ul className="space-y-2 flex-1">
                  {features.map(f => (
                    <li key={f.ru} className="flex items-center gap-2 text-sm text-secondary">
                      <CheckCircle2 size={14} className="text-success flex-shrink-0"/>
                      {f[lang]}
                    </li>
                  ))}
                </ul>
                {isCurrent ? (
                  <div className="neo-btn w-full text-center py-2 text-sm opacity-60 cursor-default">
                    {t("Текущий тариф", "Joriy tarif")}
                  </div>
                ) : (
                  <button
                    onClick={() => checkout.mutate({ plan: plan.key as "standard" | "basic" | "pro" | "exclusive" })}
                    disabled={checkout.isPending}
                    className="neo-btn-primary w-full flex items-center justify-center gap-2 py-2 text-sm"
                  >
                    {checkout.isPending ? <Loader2 size={14} className="animate-spin"/> : <Zap size={14}/>}
                    {sub.isTrialing ? t("Подключить", "Ulash") : t("Перейти", "O'tish")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Trial features */}
      {sub.isTrialing && (
        <div className="neo-card p-5 border-info/30 bg-info/5">
          <p className="font-label text-info text-xs tracking-wider mb-3">{t("В ПРОБНОМ ПЕРИОДЕ ДОСТУПНО", "SINOV DAVRIDA MAVJUD")}</p>
          <ul className="space-y-1.5">
            {STANDARD_FEATURES.map(f => (
              <li key={f.ru} className="flex items-center gap-2 text-sm text-secondary">
                <CheckCircle2 size={14} className="text-info"/>
                {f[lang]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
