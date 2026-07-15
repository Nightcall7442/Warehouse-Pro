import { memo } from "react";
import { useNavigate } from "react-router";
import { useLang } from "@/i18n";
import { trpc } from "@/providers/trpc";
import { Users, Package, ShoppingCart, AlertTriangle, ArrowRight, Zap } from "lucide-react";
import { ProgressRing } from "@/components/ProgressRing";

interface UsageData {
  plan: string;
  planName: string;
  limits: {
    maxUsers: number | null;
    maxProducts: number | null;
    maxOrdersMonth: number | null;
  };
  usage: {
    users: number;
    products: number;
    orders: number;
  };
  daysLeft: number;
  isExpired: boolean;
}

export const UsageDashboard = memo(function UsageDashboard() {
  const navigate = useNavigate();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const { data: billing } = trpc.billing.status.useQuery() as { data: UsageData | undefined };

  if (!billing) return null;

  const { limits, usage, plan, daysLeft, isExpired } = billing;

  const metrics = [
    {
      label: t("Пользователи", "Foydalanuvchilar"),
      icon: Users,
      used: usage.users,
      max: limits.maxUsers,
      color: "#4b6cf6",
    },
    {
      label: t("Товары", "Mahsulotlar"),
      icon: Package,
      used: usage.products,
      max: limits.maxProducts,
      color: "#34c473",
    },
    {
      label: t("Заказы/мес", "Buyurtmalar/oy"),
      icon: ShoppingCart,
      used: usage.orders,
      max: limits.maxOrdersMonth,
      color: "#e8a830",
    },
  ];

  // Check if any limit is approaching (>=80%)
  const hasWarning = metrics.some(m => m.max && (m.used / m.max) >= 0.8);
  const isAtLimit = metrics.some(m => m.max && m.used >= m.max);

  return (
    <div className="neo-card" style={{ padding: "20px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: "36px", height: "36px", borderRadius: "10px",
            background: isExpired ? "var(--color-danger-subtle)" : "var(--color-primary-subtle)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Zap size={18} style={{ color: isExpired ? "var(--color-danger)" : "var(--color-primary)" }} />
          </div>
          <div>
            <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>
              {t("Использование", "Ishlatish")}
            </h3>
            <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>
              {t("Тариф", "Tarif")}: {billing.planName}
              {daysLeft > 0 && ` · ${daysLeft} ${t("дн.", "kun")}`}
            </p>
          </div>
        </div>
        <button onClick={() => navigate("/settings/billing")} className="neo-btn" style={{ padding: "6px 12px", fontSize: "11px" }}>
          {t("Тариф", "Tarif")} <ArrowRight size={12} />
        </button>
      </div>

      {/* Warning banner */}
      {(isExpired || isAtLimit) && (
        <div style={{
          display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px",
          borderRadius: "10px", marginBottom: "16px",
          background: isExpired ? "var(--color-danger-subtle)" : "var(--color-warning-subtle)",
          border: `1px solid ${isExpired ? "var(--color-danger)" : "var(--color-warning)"}`,
        }}>
          <AlertTriangle size={14} style={{ color: isExpired ? "var(--color-danger)" : "var(--color-warning)", flexShrink: 0 }} />
          <span style={{ fontSize: "12px", color: isExpired ? "var(--color-danger)" : "var(--color-warning)", fontWeight: 500 }}>
            {isExpired
              ? t("Тариф истёк — обновите для продолжения", "Tarif muddati tugadi — davom ettirish uchun yangilang")
              : t("Достигнут лимит — обновите тариф", "Chegaraga yetildi — tarifni yangilang")
            }
          </span>
        </div>
      )}

      {/* Usage metrics */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {metrics.map(m => {
          const pct = m.max ? Math.min(100, (m.used / m.max) * 100) : 0;
          const isHigh = pct >= 80;
          const isFull = pct >= 100;
          const Icon = m.icon;

          return (
            <div key={m.label} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{
                width: "32px", height: "32px", borderRadius: "8px",
                background: `${m.color}15`, display: "flex",
                alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <Icon size={14} style={{ color: m.color }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{m.label}</span>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: isFull ? "var(--color-danger)" : "var(--color-text-primary)" }}>
                    {m.used} / {m.max ?? "∞"}
                  </span>
                </div>
                <div style={{ height: "6px", background: "var(--color-surface-light)", borderRadius: "3px", overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: "3px",
                    width: `${pct}%`,
                    background: isFull ? "var(--color-danger)" : isHigh ? "var(--color-warning)" : m.color,
                    transition: "width 0.3s ease",
                  }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Upgrade prompt */}
      {hasWarning && !isExpired && (
        <button
          onClick={() => navigate("/settings/billing")}
          className="neo-btn-primary w-full mt-4"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
        >
          <Zap size={14} />
          {t("Обновить тариф", "Tarifni yangilash")}
        </button>
      )}
    </div>
  );
});
