import { Link } from "react-router";
import { useLang } from "@/i18n";
import { Warehouse } from "lucide-react";

export default function NotFound() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--color-canvas, #f0f2f5)", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: "72px", height: "72px", borderRadius: "20px", background: "rgba(129,140,248,.10)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "24px" }}>
          <Warehouse size={32} color="var(--color-primary, #818cf8)" />
        </div>
        <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "48px", fontWeight: 700, color: "var(--color-text-primary, #111827)", margin: 0 }}>404</h1>
        <p style={{ fontSize: "16px", color: "var(--color-text-secondary, #6b7280)", margin: "8px 0 24px" }}>{t("Страница не найдена", "Sahifa topilmadi")}</p>
        <Link to="/" style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "10px 24px", background: "var(--color-primary, #818cf8)", color: "#fff", borderRadius: "12px", fontSize: "14px", fontWeight: 600, textDecoration: "none", boxShadow: "0 2px 8px rgba(129,140,248,.25)" }}>
          {t("На главную", "Bosh sahifa")}
        </Link>
      </div>
    </div>
  );
}
