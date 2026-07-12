import { Link } from "react-router";
import { useLang } from "@/i18n";
import { Lock, CreditCard } from "lucide-react";

export default function SubscriptionBlocked() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--color-canvas, #f0f2f5)", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div style={{ textAlign: "center", maxWidth: "400px" }}>
        <div style={{ width: "72px", height: "72px", borderRadius: "50%", background: "rgba(248,113,113,.10)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "24px" }}>
          <Lock size={32} color="var(--color-danger, #f87171)" />
        </div>
        <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "24px", fontWeight: 700, color: "var(--color-text-primary, #111827)", margin: 0 }}>{t("Подписка неактивна", "Obuna faol emas")}</h1>
        <p style={{ fontSize: "14px", color: "var(--color-text-secondary, #6b7280)", margin: "12px 0 24px" }}>{t("Обновите тариф чтобы продолжить работу.", "Ishni davom ettirish uchun tarifni yangilang.")}</p>
        <Link to="/billing" style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "12px 28px", background: "var(--color-primary, #818cf8)", color: "#fff", borderRadius: "12px", fontSize: "14px", fontWeight: 600, textDecoration: "none", boxShadow: "0 2px 8px rgba(129,140,248,.25)" }}>
          <CreditCard size={16} /> {t("Перейти к тарифам", "Tariflarga o'tish")}
        </Link>
      </div>
    </div>
  );
}
