import { useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { Mail, Loader2, ArrowLeft, CheckCircle2 } from "lucide-react";

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

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--color-canvas, #f0f2f5)", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 400, padding: "0 24px" }}>
        {/* Back to login */}
        <Link to="/login" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--color-text-secondary, #6a7290)", fontSize: 13, textDecoration: "none", marginBottom: 24 }}>
          <ArrowLeft size={14} /> {t("auth.forgotPassword.backToLogin")}
        </Link>

        <div style={{ background: "var(--color-surface, #ffffff)", borderRadius: 16, border: "1px solid #dde2ec", padding: "32px 28px" }}>
          {sent ? (
            /* Success state */
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: "rgba(74,222,128,.10)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                <CheckCircle2 size={24} style={{ color: "#34c473" }} />
              </div>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--color-text-primary, #2b3450)", marginBottom: 8 }}>
                {t("auth.forgotPassword.emailSent")}
              </h1>
              <p style={{ fontSize: 14, color: "var(--color-text-secondary, #6a7290)", lineHeight: 1.6, marginBottom: 24 }}>
                {t("auth.forgotPassword.subtitle")}
              </p>
              <Link to="/login" style={{ display: "inline-block", padding: "10px 24px", background: "#5b6d8a", color: "#fff", borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
                {t("auth.forgotPassword.returnToLogin")}
              </Link>
            </div>
          ) : (
            /* Form */
            <>
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--color-primary-subtle, rgba(75,108,246,.10))", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                  <Mail size={24} style={{ color: "#5b6d8a" }} />
                </div>
                <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--color-text-primary, #2b3450)", marginBottom: 8 }}>
                  {t("auth.forgotPassword.title")}
                </h1>
                <p style={{ fontSize: 14, color: "var(--color-text-secondary, #6a7290)" }}>
                  {t("auth.forgotPassword.subtitle")}
                </p>
              </div>

              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary, #6a7290)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                    EMAIL
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    required
                    autoFocus
                    style={{
                      width: "100%", padding: "10px 12px", borderRadius: 8,
                      border: "1px solid #dde2ec", background: "var(--color-surface-light, #f0f3f8)",
                      color: "var(--color-text-primary, #2b3450)", fontSize: 14, outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                {requestReset.isError && (
                  <p style={{ fontSize: 13, color: "#d45050", marginBottom: 12 }}>
                    {requestReset.error.message}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={requestReset.isPending || !email}
                  style={{
                    width: "100%", padding: "10px 0", borderRadius: 8,
                    background: "#5b6d8a", color: "#fff", border: "none",
                    fontSize: 14, fontWeight: 600, cursor: requestReset.isPending ? "wait" : "pointer",
                    opacity: requestReset.isPending || !email ? 0.6 : 1,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}
                >
                  {requestReset.isPending && <Loader2 size={16} className="animate-spin" />}
                  {t("auth.forgotPassword.submit")}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
