import { CheckCircle2, AlertTriangle } from "lucide-react";
import { COLORS, FONTS, GRADIENTS, SHADOWS } from "./designTokens";
import { DaysRing } from "./DaysRing";

interface HeroStatusCardProps {
  daysLeft: number;
  isExpired: boolean;
  trialActive: boolean;
  planName: string;
  t: (ru: string, uz: string) => string;
}

export function HeroStatusCard({
  daysLeft,
  isExpired,
  trialActive,
  planName,
  t,
}: HeroStatusCardProps) {
  return (
    <div style={{
      position: "relative",
      overflow: "hidden",
      borderRadius: "24px",
      padding: "28px",
      background: isExpired ? GRADIENTS.heroExpired : GRADIENTS.hero,
      boxShadow: isExpired
        ? `${SHADOWS.lg}, ${SHADOWS.glow("danger", 0.08)}`
        : `${SHADOWS.lg}, ${SHADOWS.glow("primary", 0.08)}`,
      marginBottom: "24px",
      animation: "slideUp 0.7s ease forwards",
    }}>
      {/* Ambient glow */}
      <div style={{
        position: "absolute",
        top: "-40px",
        right: "-40px",
        width: "160px",
        height: "160px",
        borderRadius: "50%",
        background: isExpired ? "#e85050" : "#4b6cf6",
        opacity: 0.06,
        filter: "blur(40px)",
      }} />
      <div style={{
        position: "absolute",
        bottom: "-60px",
        left: "-20px",
        width: "120px",
        height: "120px",
        borderRadius: "50%",
        background: isExpired ? "#e85050" : "#4b6cf6",
        opacity: 0.04,
        filter: "blur(50px)",
      }} />

      <div style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: "20px",
      }}>
        <DaysRing daysLeft={daysLeft} danger={!!isExpired} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "6px",
          }}>
            {isExpired
              ? <AlertTriangle size={18} style={{ color: COLORS.danger }} />
              : <CheckCircle2 size={18} style={{ color: COLORS.success }} />}
            <span style={{
              fontFamily: FONTS.display,
              fontSize: "18px",
              fontWeight: "700",
              color: COLORS.textPrimary,
            }}>
              {planName}
            </span>
          </div>
          <p style={{
            fontSize: "14px",
            color: COLORS.textSecondary,
            margin: 0,
          }}>
            {isExpired
              ? t("Подписка истекла — продлите доступ", "Obuna tugadi — kirishni uzaytiring")
              : trialActive
                ? t(`Осталось ${daysLeft} дн. пробного периода`, `Sinov muddati ${daysLeft} kun qoldi`)
                : t(`Активна ещё ${daysLeft} дней`, `Yana ${daysLeft} kun faol`)}
          </p>
        </div>
      </div>
    </div>
  );
}
