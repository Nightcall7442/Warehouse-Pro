import { useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { Mail, Loader2, ArrowLeft, CheckCircle2 } from "lucide-react";
import { AuthShell, AuthError } from "@/components/auth/AuthShell";

/**
 * Забытый пароль.
 *
 * Тот же разворот, что у входа: человек попадает сюда прямо со входа, и смена
 * оформления посреди одного дела читается как переход в другой продукт.
 * Раньше здесь была своя карточка с обводкой `#dde2ec` — цветом, которого в
 * палитре приложения нет.
 */
export default function ForgotPassword() {
  const { t } = useLang();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const requestReset = trpc.auth.requestPasswordReset.useMutation({
    onSuccess: () => setSent(true),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    requestReset.mutate({ email });
  };

  // ── Письмо ушло ───────────────────────────────────────────────────────────
  if (sent) {
    return (
      <AuthShell title={t("auth.forgotPassword.emailSent")} subtitle={t("auth.forgotPassword.subtitle")}>
        <div style={{ textAlign: "center", paddingTop: "4px" }}>
          <div style={{
            width: "58px", height: "58px", borderRadius: "20px", margin: "0 auto 20px",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--color-success-subtle)", color: "var(--color-success-text, var(--color-success))",
            boxShadow: "var(--shadow-sm)",
          }}>
            <CheckCircle2 size={26} />
          </div>
          <Link
            to="/login"
            className="neo-btn-primary"
            style={{ width: "100%", height: "46px", borderRadius: "14px", fontSize: "14px", textDecoration: "none" }}
          >
            {t("auth.forgotPassword.returnToLogin")}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("auth.forgotPassword.title")}
      subtitle={t("auth.forgotPassword.subtitle")}
      footer={
        <Link to="/login" style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--color-text-secondary)", textDecoration: "none" }}>
          <ArrowLeft size={14} /> {t("auth.forgotPassword.backToLogin")}
        </Link>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div>
          <label style={{
            display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em",
            textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: "7px",
          }}>
            {t("auth.login.email")}
          </label>
          <div style={{ position: "relative" }}>
            <span className="auth-icon"><Mail size={16} /></span>
            <input
              type="email"
              className="auth-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              required
              autoFocus
              autoComplete="email"
            />
          </div>
        </div>

        {requestReset.isError && (
          <AuthError><span role="alert">{requestReset.error.message}</span></AuthError>
        )}

        <button
          type="submit"
          disabled={requestReset.isPending || !email}
          className="neo-btn-primary"
          style={{ width: "100%", height: "46px", borderRadius: "14px", fontSize: "14px", marginTop: "4px" }}
        >
          {requestReset.isPending && <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />}
          {t("auth.forgotPassword.submit")}
        </button>
      </form>
    </AuthShell>
  );
}
