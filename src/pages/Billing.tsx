import { trpc } from "@/providers/trpc";

import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { ANIMATIONS } from "@/components/billing/designTokens";
import { HeroStatusCard } from "@/components/billing/HeroStatusCard";
import { UsageSection } from "@/components/billing/UsageSection";
import { SubscriptionPlanCard } from "@/components/billing/SubscriptionPlanCard";
import { PaymentMethodsCard } from "@/components/billing/PaymentMethodsCard";
import { SkeletonBlock } from "@/components/billing/SkeletonBlock";

export default function BillingPage() {
  const { data: billing, isLoading } = trpc.billing.status.useQuery();
  const { lang } = useLang();
  const upgrade = trpc.billing.requestUpgrade.useMutation({
    onSuccess: (d) => notify.success(d.message),
    onError: (e) => notify.error(e.message),
  });

  const planName = (p: { name: string; nameUz: string }) => (lang === "uz" ? p.nameUz : p.name);
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);

  if (isLoading) {
    return (
      <div style={{
        maxWidth: "768px",
        margin: "0 auto",
        padding: "0 20px",
      }}>
        <style>{ANIMATIONS.pulse}</style>
        <SkeletonBlock height={128} style={{ marginBottom: "24px" }} />
        <SkeletonBlock height={160} style={{ marginBottom: "24px" }} />
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: "16px",
        }}>
          {[1, 2, 3].map((i) => (
            <SkeletonBlock key={i} height={280} />
          ))}
        </div>
      </div>
    );
  }

  if (!billing) return null;

  const { trialActive, isExpired, daysLeft } = billing;

  return (
    <div style={{
      maxWidth: "768px",
      margin: "0 auto",
      padding: "0 20px 60px",
    }}>
      <style>{`
        ${ANIMATIONS.fadeIn}
        ${ANIMATIONS.slideUp}
        ${ANIMATIONS.progressFill}
        ${ANIMATIONS.glowPulse}
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
      `}</style>

      {/* ── Page Header ──────────────────────────────────────────────────── */}
      <div style={{
        marginBottom: "32px",
        animation: "fadeIn 0.6s ease forwards",
      }}>
        <h1 style={{
          fontSize: "28px",
          fontWeight: "800",
          letterSpacing: "-0.025em",
          margin: 0,
        }}>
          {t("Подписка и тарифы", "Obuna va tariflar")}
        </h1>
        <p style={{
          fontSize: "15px",
          marginTop: "8px",
          margin: "8px 0 0",
        }}>
          {t("Управляйте планом и следите за лимитами", "Rejani boshqaring va limitlarni kuzating")}
        </p>
      </div>

      {/* ── Hero Status Card ──────────────────────────────────────────────── */}
      <HeroStatusCard
        daysLeft={daysLeft}
        isExpired={!!isExpired}
        trialActive={trialActive}
        planName={lang === "uz" ? billing.planNameUz : billing.planName}
        t={t}
      />

      {/* ── Usage Section ─────────────────────────────────────────────────── */}
      <UsageSection
        usage={billing.usage}
        limits={billing.limits}
        t={t}
      />

      {/* ── Plan Cards ────────────────────────────────────────────────────── */}
      <div>
        <p style={{
          fontSize: "12px",
          fontWeight: "600",
          letterSpacing: "0.08em",
          margin: "0 0 16px",
          textTransform: "uppercase",
        }}>
          {t("ВЫБЕРИТЕ ТАРИФ", "TARIFNI TANLANG")}
        </p>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
        }}>
          {billing.plans.map((plan, index) => (
            <SubscriptionPlanCard
              key={plan.key}
              plan={plan}
              index={index}
              isCurrent={billing.plan === plan.key}
              isPro={plan.key === "pro"}
              planName={planName}
              t={t}
              isPending={upgrade.isPending}
              onSelect={(key) => upgrade.mutate({ plan: key as "basic" | "pro" | "exclusive" })}
            />
          ))}
        </div>
      </div>

      {/* ── Payment Methods ───────────────────────────────────────────────── */}
      <PaymentMethodsCard t={t} />

      {/* Spin animation for loader */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
