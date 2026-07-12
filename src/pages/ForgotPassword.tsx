import { useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useLang } from "@/i18n";
import { Warehouse, Mail, CheckCircle2 } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const forgot = trpc.forgotPassword.useMutation({
    onSuccess: () => { setSent(true); notify.success(t("Письмо отправлено", "Xabar yuborildi")); },
    onError: (e) => notify.error(e.message),
  });

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--color-canvas, #f0f2f5)", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div style={{ width: "100%", maxWidth: "400px" }}>
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{ width: "56px", height: "56px", borderRadius: "16px", background: "linear-gradient(135deg, var(--color-primary, #818cf8), #6366f1)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "16px", boxShadow: "0 4px 12px rgba(129,140,248,.3)" }}>
            <Warehouse size={24} color="#fff" />
          </div>
          <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "24px", fontWeight: 700, color: "var(--color-text-primary, #111827)", margin: 0 }}>{t("Сброс пароля", "Parolni tiklash")}</h1>
          <p style={{ fontSize: "13px", color: "var(--color-text-secondary, #6b7280)", margin: "4px 0 0" }}>{t("Введите email для восстановления", "Tiklash uchun email kiriting")}</p>
        </div>

        <div style={{ background: "var(--color-surface, #ffffff)", borderRadius: "20px", padding: "32px", boxShadow: "0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04)" }}>
          {sent ? (
            <div style={{ textAlign: "center" }}>
              <CheckCircle2 size={48} color="var(--color-success, #4ade80)" style={{ margin: "0 auto 16px" }} />
              <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary, #111827)", margin: 0 }}>{t("Письмо отправлено!", "Xabar yuborildi!")}</p>
              <p style={{ fontSize: "13px", color: "var(--color-text-secondary, #6b7280)", margin: "8px 0 0" }}>{t("Проверьте почту", "Pochtani tekshiring")}</p>
              <Link to="/login" style={{ display: "inline-block", marginTop: "20px", padding: "10px 24px", background: "var(--color-primary, #818cf8)", color: "#fff", borderRadius: "10px", fontSize: "13px", fontWeight: 600, textDecoration: "none" }}>{t("Войти", "Kirish")}</Link>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", display: "block", marginBottom: "6px" }}>Email</label>
                <div style={{ position: "relative" }}>
                  <Mail size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #9ca3af)" }} />
                  <input type="email" placeholder="admin@example.com" value={email} onChange={e => setEmail(e.target.value)} style={{ paddingLeft: "36px" }} className="input-field" />
                </div>
              </div>
              <button onClick={() => forgot.mutate({ email })} disabled={forgot.isPending || !email} style={{
                width: "100%", padding: "12px", borderRadius: "12px", fontSize: "14px", fontWeight: 600,
                fontFamily: "'DM Sans', sans-serif", border: "none", cursor: "pointer",
                background: "var(--color-primary, #818cf8)", color: "#fff",
                boxShadow: "0 2px 8px rgba(129,140,248,.25)", opacity: !email ? 0.5 : 1,
              }}>
                {forgot.isPending ? "..." : t("Отправить", "Yuborish")}
              </button>
            </div>
          )}
        </div>

        <p style={{ textAlign: "center", fontSize: "13px", color: "var(--color-text-secondary, #6b7280)", marginTop: "20px" }}>
          <Link to="/login" style={{ color: "var(--color-primary, #818cf8)", fontWeight: 600, textDecoration: "none" }}>{t("Вернуться к входу", "Kirishga qaytish")}</Link>
        </p>
      </div>
    </div>
  );
}
