import { useAuth } from "@/hooks/useAuth";
import { Lock, LogOut } from "lucide-react";
import { useLang, useTranslate } from "@/i18n";
import { trpc } from "@/providers/trpc";
import { FieldPlanCard } from "@/components/billing/FieldPlanCard";
import { GrandfatherNotice } from "@/components/billing/GrandfatherNotice";
import { usePlanRequest } from "@/components/billing/usePlanRequest";

/**
 * Подписка кончилась — продлить можно прямо здесь.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Кнопка вела на /settings/billing, внутрь общего Layout. Тот сразу
 * спрашивает уведомления, поддержку и «Справку» — а эти ручки закрыты
 * подпиской (api/middleware.ts), и отказ возвращал обратно сюда. Круг: ни
 * тарифов, ни кнопки заявки. Организация, которая хотела заплатить, не могла.
 *
 * ── Как теперь ──────────────────────────────────────────────────────────────
 *
 * Тарифы и заявка — на этом же экране, вне Layout, и зовут только billing.*:
 * эти ручки открыты при истёкшей подписке. Уходить отсюда некуда и не нужно.
 * Заявку подаёт директор (billing.requestUpgrade — только ему); остальным
 * сказано, к кому идти.
 */
export default function SubscriptionBlocked() {
  const { user, logout } = useAuth();
  const { t: tk } = useLang();
  const t = useTranslate();
  const isCeo = user?.role === "ceo";
  const { data: billing } = trpc.billing.status.useQuery(undefined, { enabled: isCeo });
  const { request, sent } = usePlanRequest();

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="neo-card w-full max-w-md p-10 text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-danger/10 flex items-center justify-center mx-auto">
          <Lock size={28} className="text-danger"/>
        </div>

        <div>
          <h1 className="font-display text-2xl font-bold text-primary">
            {tk("auth.subscriptionBlocked.title")}
          </h1>
          <p className="text-secondary text-sm mt-2">
            {tk("auth.subscriptionBlocked.hint")}
          </p>
          <p className="text-secondary text-sm mt-2">
            {isCeo
              ? t("Оставьте заявку ниже — оператор свяжется с вами и включит подписку.", "Quyida so'rov qoldiring — operator siz bilan bog'lanib, obunani yoqadi.")
              : t("Продлить подписку может руководитель организации.", "Obunani tashkilot rahbari uzaytira oladi.")}
          </p>
        </div>

        {sent && (
          <p role="status" data-testid="plan-request-sent" className="text-sm font-semibold text-success">
            {sent}
          </p>
        )}

        <button
          onClick={() => logout()}
          className="neo-btn w-full flex items-center justify-center gap-2 py-3"
        >
          <LogOut size={18}/>
          {tk("auth.subscriptionBlocked.logout")}
        </button>
      </div>

      {/*
        Продлить прямо здесь: «Стандарт» за полевых, а прежнему тарифу — ещё
        и продление по прежней цене, пока он действует (contracts/pricing.ts).
      */}
      {billing && (
        <div className="w-full max-w-2xl flex flex-col gap-4">
          {billing.pricing.model === "legacy" && billing.plans.find(p => p.legacy) && (
            <GrandfatherNotice
              planName={billing.plans.find(p => p.legacy)!.name}
              pricing={billing.pricing}
              isPending={request.isPending}
              onRenew={() => request.mutate({ plan: billing.plans.find(p => p.legacy)!.key as "basic" | "pro" | "exclusive", period: "month" })}
              t={t}
            />
          )}
          <FieldPlanCard
            fieldUsers={billing.fieldUsers}
            byRole={billing.fieldByRole}
            mode={billing.pricing.model === "legacy" ? "switch" : billing.effectivePlan === "standard" ? "renew" : "connect"}
            isPending={request.isPending}
            onRequest={period => request.mutate({ plan: "standard", period })}
            t={t}
            compact
          />
        </div>
      )}
    </div>
  );
}
