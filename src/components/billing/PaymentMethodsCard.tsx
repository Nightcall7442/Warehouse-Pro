import { Zap } from "lucide-react";
import { COLORS, GRADIENTS, SHADOWS } from "./designTokens";

interface PaymentMethodsCardProps {
  t: (ru: string, uz: string) => string;
}

export function PaymentMethodsCard({ t }: PaymentMethodsCardProps) {
  return (
    <div style={{
      borderRadius: "24px",
      padding: "24px",
      background: GRADIENTS.card,
      boxShadow: SHADOWS.md,
      marginTop: "32px",
      animation: "slideUp 1s ease forwards",
    }}>
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "16px",
      }}>
        <div style={{
          width: "40px",
          height: "40px",
          borderRadius: "12px",
          background: "rgba(75,108,246,.12)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}>
          <Zap size={18} style={{ color: COLORS.primary }} />
        </div>
        <div style={{ fontSize: "14px" }}>
          <p style={{
            fontWeight: "600",
            color: COLORS.textPrimary,
            margin: "0 0 4px",
          }}>{t("Способы оплаты", "To'lov usullari")}</p>
          <p style={{
            color: COLORS.textSecondary,
            margin: 0,
            lineHeight: 1.5,
          }}>
            {t("Оплата через Click, Payme, Uzum Pay. Оператор свяжется с вами в течение 30 минут после запроса.",
              "Click, Payme, Uzum Pay orqali to'lash mumkin. Operator 30 daqiqa ichida bog'lanadi.")}
          </p>
        </div>
      </div>
    </div>
  );
}
