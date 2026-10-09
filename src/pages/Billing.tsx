import { CreditCard } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { usePlanRequest } from "@/components/billing/usePlanRequest";
import { HeroStatusCard } from "@/components/billing/HeroStatusCard";
import { UsageSection } from "@/components/billing/UsageSection";
import { FieldPlanCard } from "@/components/billing/FieldPlanCard";
import { GrandfatherNotice } from "@/components/billing/GrandfatherNotice";
import { PaymentMethodsCard } from "@/components/billing/PaymentMethodsCard";
import { ExtraLimitsCard } from "@/components/billing/ExtraLimitsCard";
import { SkeletonBlock } from "@/components/billing/SkeletonBlock";

/**
 * Подписка.
 *
 * ── 05.10.2026: цена за полевого сотрудника ──────────────────────────────────
 *
 * Выбирать из трёх тарифов больше нечего: продаётся «Стандарт» — 119 000 сум
 * за агента, курьера или мерчендайзера в месяц, офис бесплатно, пределов нет
 * (contracts/pricing.ts). Экран отвечает на два вопроса директора: сколько
 * людей у меня в поле и сколько это стоит в месяц и за год.
 *
 * Прежний тариф (Basic / Pro / Exclusive) до GRANDFATHER_UNTIL живёт как
 * жил: сверху — сколько ещё по прежней цене и во что он превратится, его
 * пределы и надбавка остаются на месте. Перейти на «Стандарт» раньше — можно.
 *
 * ── Что было раньше ─────────────────────────────────────────────────────────
 *
 * Раздел жил по своей системе оформления (designTokens.ts) с тенями на
 * ступень мимо и цветами светлой палитры числами; сервер отдавал дату
 * окончания и цену, а экран их выбрасывал. Это остаётся исправленным:
 * HeroStatusCard показывает и дату, и сумму.
 */
export default function BillingPage() {
  const { data: billing, isLoading } = trpc.billing.status.useQuery();
  const { lang } = useLang();
  const { request: upgrade } = usePlanRequest();

  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);

  if (isLoading) {
    return (
      <div style={{ maxWidth: "820px", margin: "0 auto", width: "100%" }}>
        <SkeletonBlock height={128} style={{ marginBottom: "24px" }} />
        <SkeletonBlock height={200} style={{ marginBottom: "24px" }} />
        <SkeletonBlock height={420} />
      </div>
    );
  }

  if (!billing) return null;

  const grandfathered = billing.pricing.model === "legacy";
  const legacy = billing.plans.find(p => p.legacy);

  return (
    <div className="animate-fade-up" style={{ maxWidth: "820px", margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", gap: "24px" }}>

      {/* ── Шапка ────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        <div style={{
          width: "46px", height: "46px", borderRadius: "16px", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "linear-gradient(135deg, var(--color-primary), var(--accent-teal, #3a9a8a))",
          color: "var(--color-on-primary)", boxShadow: "var(--shadow-sm)",
        }}>
          <CreditCard size={21} />
        </div>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: "21px", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--color-text-primary)", lineHeight: 1.2 }}>
            {t("Подписка и тарифы", "Obuna va tariflar")}
          </h1>
          <p style={{ fontSize: "12.5px", color: "var(--color-text-secondary)", marginTop: "3px" }}>
            {t("Платите только за тех, кто в поле", "Faqat dalada ishlaydiganlar uchun to'laysiz")}
          </p>
        </div>
      </div>

      <HeroStatusCard
        daysLeft={billing.daysLeft}
        isExpired={!!billing.isExpired}
        trialActive={!!billing.trialActive}
        planName={lang === "uz" ? billing.planNameUz : billing.planNameRu}
        price={billing.price}
        endsAt={billing.trialActive ? billing.trialEndsAt : billing.planExpiresAt}
        lang={lang}
        t={t}
      />

      {grandfathered && legacy && (
        <GrandfatherNotice
          planName={legacy.name}
          pricing={billing.pricing}
          isPending={upgrade.isPending}
          onRenew={() => upgrade.mutate({ plan: legacy.key as "basic" | "pro" | "exclusive", period: "month" })}
          t={t}
        />
      )}

      <FieldPlanCard
        fieldUsers={billing.fieldUsers}
        byRole={billing.fieldByRole}
        mode={grandfathered ? "switch" : billing.effectivePlan === "standard" ? "renew" : "connect"}
        isPending={upgrade.isPending}
        onRequest={period => upgrade.mutate({ plan: "standard", period })}
        t={t}
      />

      {/*
        Пределы и надбавка — только у прежнего тарифа, пока он действует: у
        «Стандарта» и пробного пределов нет, полосы «13 / ∞» ничего не говорят.
      */}
      {grandfathered && (
        <>
          <UsageSection usage={billing.usage} limits={billing.limits} extra={billing.extra} t={t} />
          <ExtraLimitsCard t={t} />
        </>
      )}

      <PaymentMethodsCard t={t} />
    </div>
  );
}
