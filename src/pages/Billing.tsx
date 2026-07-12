import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { format, differenceInDays } from "date-fns";
import { Check, Crown, Zap, Shield, Users, Package, ShoppingCart, Calendar, CreditCard } from "lucide-react";
import { CardDots, Card, KpiCard, PageHeader, SectionTitle, btnPrimary } from "@/components/DashboardLayout";
import { ProgressRing } from "@/components/ProgressRing";

const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };

const PLANS = [
  { key: "basic", ru: "Basic", price: "299 000 сум/мес", features: ["5 пользователей", "50 SKU товаров", "Безлимит заказов/мес"], color: "var(--color-info, #60a5fa)", icon: <Zap size={20} color="#fff" /> },
  { key: "pro", ru: "Pro", price: "599 000 сум/мес", features: ["20 пользователей", "100 SKU товаров", "Безлимит заказов/мес", "Полная аналитика", "GPS трекинг", "1C интеграция"], color: "var(--color-primary, #818cf8)", icon: <Crown size={20} color="#fff" />, popular: true },
  { key: "exclusive", ru: "Exclusive", price: "1 299 000 сум/мес", features: ["Безлимит пользователей", "Безлимит SKU товаров", "Безлимит заказов/мес", "API доступ", "White-label", "Выделенный сервер"], color: "var(--color-success, #4ade80)", icon: <Shield size={20} color="#fff" /> },
];

export default function Billing() {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data: billing } = trpc.billing.status.useQuery();
  const { data: limits } = trpc.billing.limits.useQuery();

  const plan = billing?.plan ?? "basic";
  const daysLeft = billing?.trialEndsAt ? differenceInDays(new Date(billing.trialEndsAt), new Date()) : null;
  const isActive = billing?.isActive ?? false;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader title={t("Подписка и тарифы", "Obuna va tariflar")} subtitle={t("Управляйте планом и следите за лимитами", "Rejani boshqaring va limitlarni kuzating")} />

      {/* Current Plan Status */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <ProgressRing value={daysLeft ? Math.min(100, Math.max(0, daysLeft)) : 100} color={isActive ? "var(--color-success, #4ade80)" : "var(--color-danger, #f87171)"} size={80} strokeWidth={6} label={daysLeft !== null ? String(daysLeft) : "∞"} />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Check size={16} color="var(--color-success, #4ade80)" />
              <span style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-text-primary, #111827)", fontFamily: F.display }}>{plan.toUpperCase()}</span>
            </div>
            <p style={{ fontSize: "13px", color: "var(--color-text-secondary, #6b7280)", margin: "4px 0 0" }}>
              {daysLeft !== null ? `${t("Активна ещё", "Faol yana")} ${daysLeft} ${t("день", "kun")}` : t("Активна", "Faol")}
            </p>
          </div>
        </div>
      </Card>

      {/* Usage Limits */}
      {limits && (
        <Card>
          <SectionTitle title={t("Использование в этом месяце", "Oylik foydalanish")} />
          <div style={{ display: "flex", flexDirection: "column", gap: "20px", marginTop: "16px" }}>
            {[
              { label: t("Пользователи", "Foydalanuvchilar"), used: limits.usersUsed ?? 0, limit: limits.usersLimit ?? 0, icon: <Users size={16} color="var(--color-primary, #818cf8)" /> },
              { label: t("Товары (SKU)", "Mahsulotlar (SKU)"), used: limits.productsUsed ?? 0, limit: limits.productsLimit ?? 0, icon: <Package size={16} color="var(--color-success, #4ade80)" /> },
              { label: t("Заказы (мес.)", "Buyurtmalar (oy)"), used: limits.ordersUsed ?? 0, limit: limits.ordersLimit ?? 0, icon: <ShoppingCart size={16} color="var(--color-warning, #fbbf24)" /> },
            ].map((item, i) => {
              const pct = item.limit > 0 ? Math.min(100, (item.used / item.limit) * 100) : 100;
              return (
                <div key={i}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {item.icon}
                      <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary, #111827)" }}>{item.label}</span>
                    </div>
                    <span style={{ fontSize: "12px", color: "var(--color-text-tertiary, #9ca3af)" }}>{item.used} / {item.limit > 0 ? item.limit : "∞"}</span>
                  </div>
                  <div style={{ height: "6px", background: "var(--color-surface-light, #f3f4f6)", borderRadius: "3px", overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: "3px", width: `${pct}%`, background: pct >= 80 ? "var(--color-warning, #fbbf24)" : "var(--color-success, #4ade80)", transition: "width 0.5s ease" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Plan Cards */}
      <div>
        <SectionTitle title={t("Выберите тариф", "Tarifni tanlang")} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", marginTop: "16px" }}>
          {PLANS.map(p => (
            <Card key={p.key} style={{ position: "relative", border: p.popular ? "2px solid var(--color-primary, #818cf8)" : "2px solid transparent" }}>
              {p.popular && (
                <div style={{ position: "absolute", top: "-12px", left: "50%", transform: "translateX(-50%)", padding: "4px 12px", borderRadius: "20px", background: "var(--color-primary, #818cf8)", color: "#fff", fontSize: "11px", fontWeight: 600 }}>
                  {t("ПОПУЛЯРНЫЙ", "MASHHUR")}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
                <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: p.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {p.icon}
                </div>
                <div>
                  <h3 style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text-primary, #111827)", margin: 0, fontFamily: F.display }}>{p.ru}</h3>
                  <p style={{ fontSize: "20px", fontWeight: 700, color: "var(--color-text-primary, #111827)", margin: "4px 0 0", fontFamily: F.display }}>{p.price}</p>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {p.features.map((f, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Check size={14} color="var(--color-success, #4ade80)" />
                    <span style={{ fontSize: "13px", color: "var(--color-text-secondary, #6b7280)" }}>{f}</span>
                  </div>
                ))}
              </div>
              <button style={{ ...btnPrimary, width: "100%", marginTop: "16px", background: plan === p.key ? "var(--color-surface-light, #f3f4f6)" : p.color, color: plan === p.key ? "var(--color-text-secondary, #6b7280)" : "#fff", boxShadow: plan === p.key ? "none" : undefined }}>
                {plan === p.key ? t("Текущий", "Joriy") : t("Выбрать", "Tanlash")}
              </button>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
