import { CheckCircle2, AlertTriangle, Zap } from "lucide-react";
import { COLORS, FONTS, GRADIENTS, SHADOWS } from "./designTokens";

export interface Plan {
  key: string;
  name: string;
  nameUz: string;
  price: number;
  maxUsers: number | null;
  maxProducts: number | null;
  maxOrdersMonth: number | null;
}

interface SubscriptionPlanCardProps {
  plan: Plan;
  index: number;
  isCurrent: boolean;
  isPro: boolean;
  planName: (p: { name: string; nameUz: string }) => string;
  t: (ru: string, uz: string) => string;
  isPending: boolean;
  onSelect: (key: string) => void;
}

export function SubscriptionPlanCard({
  plan,
  index,
  isCurrent,
  isPro,
  planName,
  t,
  isPending,
  onSelect,
}: SubscriptionPlanCardProps) {
  return (
    <div
      className="neo-card"
      style={{
        position: "relative",
        padding: "24px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        animation: `slideUp ${0.8 + index * 0.1}s ease forwards`,
        cursor: "default",
        overflow: "visible",
      }}
      onMouseEnter={(e) => {
        if (!isCurrent) {
          (e.currentTarget as HTMLElement).style.transform = "translateY(-4px)";
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
        (e.currentTarget as HTMLElement).style.boxShadow = isPro
          ? `${SHADOWS.xl}, ${SHADOWS.glow("primary", 0.12)}`
          : isCurrent
            ? `${SHADOWS.lg}, 0 0 0 2px ${COLORS.primary}30`
            : SHADOWS.md;
      }}
    >
      {/* Popular badge */}
      {isPro && !isCurrent && (
        <div style={{
          position: "absolute",
          top: "-12px",
          left: "50%",
          transform: "translateX(-50%)",
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "4px 12px",
          borderRadius: "100px",
          fontSize: "10px",
          fontWeight: "700",
          color: "#fff",
          background: GRADIENTS.button,
          boxShadow: `0 2px 8px ${COLORS.primary}40`,
          whiteSpace: "nowrap",
        }}>
          <Zap size={11} />
          {t("ПОПУЛЯРНЫЙ", "OMMABOP")}
        </div>
      )}

      {/* Plan header */}
      <div>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}>
          {isPro && <Zap size={16} style={{ color: COLORS.primary }} />}
          <p style={{
            fontFamily: FONTS.display,
            fontWeight: "700",
            color: COLORS.textPrimary,
            margin: 0,
            fontSize: "16px",
          }}>{planName(plan)}</p>
          {isCurrent && (
            <span style={{
              marginLeft: "auto",
              padding: "2px 8px",
              borderRadius: "6px",
              fontSize: "10px",
              fontWeight: "600",
              color: COLORS.primary,
              background: "rgba(75,108,246,.15)",
            }}>
              {t("ТЕКУЩИЙ", "JORIY")}
            </span>
          )}
        </div>
        <p style={{
          fontFamily: FONTS.body,
          fontSize: "28px",
          fontWeight: "700",
          color: COLORS.textPrimary,
          marginTop: "12px",
          margin: "12px 0 0",
          lineHeight: 1.2,
        }}>
          {plan.price === 0
            ? t("Бесплатно", "Bepul")
            : <>{plan.price.toLocaleString("ru-RU")}<span style={{
                fontSize: "14px",
                fontWeight: "500",
                color: COLORS.textSecondary,
                fontFamily: FONTS.display,
              }}> {t("сум/мес", "so'm/oy")}</span></>}
        </p>
      </div>

      {/* Divider */}
      <div style={{
        height: "1px",
        background: `linear-gradient(90deg, transparent, ${COLORS.textTertiary}30, transparent)`,
        margin: "4px 0",
      }} />

      {/* Features */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        fontSize: "14px",
        flex: 1,
      }}>
        {[
          { val: plan.maxUsers, label: t("пользователей", "foydalanuvchi") },
          { val: plan.maxProducts, label: t("SKU товаров", "SKU mahsulot") },
          { val: plan.maxOrdersMonth, label: t("заказов/мес", "buyurtma/oy") },
        ].map((item) => (
          <div key={item.label} style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}>
            <div style={{
              width: "20px",
              height: "20px",
              borderRadius: "50%",
              background: "rgba(74,222,128,.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}>
              <Check size={12} style={{ color: "#34c473" }} />
            </div>
            <span style={{ color: COLORS.textSecondary }}>
              <span style={{
                color: COLORS.textPrimary,
                fontWeight: "600",
                fontFamily: FONTS.body,
              }}>
                {item.val === null ? t("Безлимит", "Cheksiz") : item.val.toLocaleString()}
              </span> {item.label}
            </span>
          </div>
        ))}
      </div>

      {/* CTA Button */}
      {!isCurrent && (
        <button
          onClick={() => onSelect(plan.key)}
          disabled={isPending}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            fontSize: "14px",
            fontWeight: "600",
            padding: "12px 20px",
            borderRadius: "12px",
            border: "none",
            cursor: isPending ? "not-allowed" : "pointer",
            color: "#fff",
            background: isPro ? GRADIENTS.button : `${COLORS.primary}`,
            boxShadow: isPro ? `0 4px 14px ${COLORS.primary}40` : SHADOWS.sm,
            transition: "all 0.2s ease",
            opacity: isPending ? 0.7 : 1,
          }}
          onMouseEnter={(e) => {
            if (!isPending) {
              (e.target as HTMLElement).style.background = isPro ? GRADIENTS.buttonHover : COLORS.primaryDark;
              (e.target as HTMLElement).style.boxShadow = isPro ? `0 6px 20px ${COLORS.primary}50` : SHADOWS.md;
              (e.target as HTMLElement).style.transform = "translateY(-1px)";
            }
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.background = isPro ? GRADIENTS.button : COLORS.primary;
            (e.target as HTMLElement).style.boxShadow = isPro ? `0 4px 14px ${COLORS.primary}40` : SHADOWS.sm;
            (e.target as HTMLElement).style.transform = "translateY(0)";
          }}
        >
          {isPending ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Zap size={16} />}
          {t("Подключить", "Ulash")}
        </button>
      )}
      {isCurrent && (
        <div style={{
          width: "100%",
          textAlign: "center",
          fontSize: "14px",
          fontWeight: "500",
          padding: "12px 20px",
          borderRadius: "12px",
          color: COLORS.textTertiary,
          background: "rgba(156,163,175,.10)",
        }}>
          {t("Активен", "Faol")}
        </div>
      )}
    </div>
  );
}

// Re-export Check for usage in plan features
import { Check, Loader2 } from "lucide-react";
