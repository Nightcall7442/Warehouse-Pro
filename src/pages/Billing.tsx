import { CreditCard } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { HeroStatusCard } from "@/components/billing/HeroStatusCard";
import { UsageSection } from "@/components/billing/UsageSection";
import { SubscriptionPlanCard } from "@/components/billing/SubscriptionPlanCard";
import { PaymentMethodsCard } from "@/components/billing/PaymentMethodsCard";
import { SkeletonBlock } from "@/components/billing/SkeletonBlock";

/**
 * Подписка и тарифы.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Раздел жил по СВОЕЙ системе оформления: components/billing/designTokens.ts —
 * второй словарь поверх тех же переменных приложения. Он не просто дублировал,
 * он врал:
 *
 *   • SHADOWS.sm → --shadow-xs, md → --shadow-sm, lg → --shadow-md: каждое имя
 *     на ступень мимо, поэтому карточка, просящая среднюю тень, получала
 *     маленькую — отсюда плоский вид;
 *   • COLORS.surfaceDark → --color-surface-light: «тёмная» поверхность на деле
 *     светлее обычной;
 *   • SHADOWS.glow вписывал числами RGB СВЕТЛОЙ палитры, а в тёмной теме
 *     акцент золотой — свечение выходило сине-серым под золотой кнопкой.
 *
 * Плюс мёртвый `@import` шрифта DM Mono внутри вставленного <style> (правила
 * @import обязаны идти первыми, здесь они шли после keyframes — шрифт не
 * грузился никогда) и повторное объявление уже глобальных keyframes.
 *
 * ── Чего не хватало по существу ─────────────────────────────────────────────
 *
 * Сервер отдавал, а экран выбрасывал: дату окончания подписки и цену текущего
 * тарифа. «Осталось 12 дней» не говорит, к какому числу платить. И нигде не
 * было сказано, что выбранный тариф может НЕ ВМЕСТИТЬ нынешнюю нагрузку:
 * организации с двенадцатью пользователями предлагался Basic на пять.
 */
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
      <div style={{ maxWidth: "820px", margin: "0 auto", width: "100%" }}>
        <SkeletonBlock height={128} style={{ marginBottom: "24px" }} />
        <SkeletonBlock height={200} style={{ marginBottom: "24px" }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px" }}>
          {[1, 2, 3].map(i => <SkeletonBlock key={i} height={300} />)}
        </div>
      </div>
    );
  }

  if (!billing) return null;

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
            {t("Управляйте планом и следите за лимитами", "Rejani boshqaring va limitlarni kuzating")}
          </p>
        </div>
      </div>

      <HeroStatusCard
        daysLeft={billing.daysLeft}
        isExpired={!!billing.isExpired}
        trialActive={!!billing.trialActive}
        planName={lang === "uz" ? billing.planNameUz : billing.planName}
        price={billing.price}
        endsAt={billing.trialActive ? billing.trialEndsAt : billing.planExpiresAt}
        lang={lang}
        t={t}
      />

      <UsageSection usage={billing.usage} limits={billing.limits} t={t} />

      <div>
        <p style={{
          fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
          color: "var(--color-text-tertiary)", margin: "0 0 14px 4px",
        }}>
          {t("Выберите тариф", "Tarifni tanlang")}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "16px" }}>
          {billing.plans.map(plan => (
            <SubscriptionPlanCard
              key={plan.key}
              plan={plan}
              isCurrent={billing.plan === plan.key}
              isPro={plan.key === "pro"}
              usage={billing.usage}
              planName={planName}
              t={t}
              isPending={upgrade.isPending}
              onSelect={(key) => upgrade.mutate({ plan: key as "basic" | "pro" | "exclusive" })}
            />
          ))}
        </div>
      </div>

      <PaymentMethodsCard t={t} />
    </div>
  );
}
