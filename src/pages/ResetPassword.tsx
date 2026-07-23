import { useState } from "react";
import { useSearchParams, Link, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { Lock, Loader2, ArrowLeft, CheckCircle2, Eye, EyeOff } from "lucide-react";

function PasswordStrength({ password }: { password: string }) {
  const { t } = useLang();
  const checks = [
    { label: t("auth.register.char8"),     pass: password.length >= 8     },
    { label: t("auth.register.uppercase"), pass: /[A-Z]/.test(password)   },
    { label: t("auth.register.digit"),     pass: /[0-9]/.test(password)   },
  ];
  const score = checks.filter(c => c.pass).length;
  const bar   = score === 0 ? 0 : score === 1 ? 33 : score === 2 ? 66 : 100;
  const color = score < 2 ? "#d45050" : score < 3 ? "#d4973a" : "#34c473";
  const label = score < 2 ? t("auth.register.passwordWeak") : score < 3 ? t("auth.register.passwordMedium") : t("auth.register.passwordStrong");

  if (!password) return null;

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="h-1.5 flex-1 rounded-full overflow-hidden mr-3" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
          <div className="h-full rounded-full transition-all duration-400" style={{ width: `${bar}%`, background: color }} />
        </div>
        <span className="text-xs font-medium flex-shrink-0" style={{ color }}>{label}</span>
      </div>
      <div className="flex gap-3">
        {checks.map(c => (
          <div key={c.label} className="flex items-center gap-1">
            <div className={`w-1.5 h-1.5 rounded-full ${c.pass ? "bg-success" : "bg-border-subtle"}`} />
            <span className="text-[10px]" style={{ color: c.pass ? "#34c473" : "var(--color-text-tertiary, #98a0b8)" }}>{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ResetPassword() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const resetPassword = trpc.auth.confirmPasswordReset.useMutation({
    onSuccess: () => setDone(true),
    onError: (e) => setError(e.message),
  });

  if (!token) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", background: "var(--color-canvas, #f0f2f5)", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--color-text-primary, #2b3450)", marginBottom: 8 }}>
            {t("auth.resetPassword.invalidLink")}
          </h1>
          <p style={{ fontSize: 14, color: "var(--color-text-secondary, #6a7290)", marginBottom: 16 }}>
            {t("auth.resetPassword.invalidHint")}
          </p>
          <Link to="/forgot-password" style={{ color: "#5b6d8a", fontSize: 14, fontWeight: 600 }}>
            {t("auth.resetPassword.requestNew")}
          </Link>
        </div>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError(t("auth.resetPassword.minLength"));
      return;
    }
    if (password !== confirm) {
      setError(t("auth.resetPassword.noMatch"));
      return;
    }

    resetPassword.mutate({ token, newPassword: password });
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--color-canvas, #f0f2f5)", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 400, padding: "0 24px" }}>
        <Link to="/login" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--color-text-secondary, #6a7290)", fontSize: 13, textDecoration: "none", marginBottom: 24 }}>
          <ArrowLeft size={14} /> {t("auth.resetPassword.backToLogin")}
        </Link>

        <div className="animate-fade-up" style={{ background: "var(--color-surface, #ffffff)", borderRadius: 16, border: "1px solid #dde2ec", padding: "32px 28px" }}>
          {done ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: "rgba(74,222,128,.10)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                <CheckCircle2 size={24} style={{ color: "#34c473" }} />
              </div>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--color-text-primary, #2b3450)", marginBottom: 8 }}>
                {t("auth.resetPassword.success")}
              </h1>
              <p style={{ fontSize: 14, color: "var(--color-text-secondary, #6a7290)", marginBottom: 24 }}>
                {t("auth.resetPassword.successHint")}
              </p>
              <button
                onClick={() => navigate("/login")}
                style={{ padding: "10px 24px", background: "#5b6d8a", color: "#fff", borderRadius: 8, fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer" }}
              >
                {t("auth.resetPassword.submit")}
              </button>
            </div>
          ) : (
            <>
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--color-primary-subtle, rgba(75,108,246,.10))", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                  <Lock size={24} style={{ color: "#5b6d8a" }} />
                </div>
                <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--color-text-primary, #2b3450)", marginBottom: 8 }}>
                  {t("auth.resetPassword.title")}
                </h1>
                <p style={{ fontSize: 14, color: "var(--color-text-secondary, #6a7290)" }}>
                  {t("auth.resetPassword.successHint")}
                </p>
              </div>

              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary, #6a7290)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                    {t("auth.resetPassword.title")}
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      type={showPw ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      autoFocus
                      minLength={8}
                      style={{
                        width: "100%", padding: "10px 36px 10px 12px", borderRadius: 8,
                        border: "1px solid #dde2ec", background: "var(--color-surface-light, #f0f3f8)",
                        color: "var(--color-text-primary, #2b3450)", fontSize: 14, outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                    <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary, #98a0b8)" }}>
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <PasswordStrength password={password} />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary, #6a7290)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                    {t("auth.resetPassword.confirmPassword")}
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      type={showConfirm ? "text" : "password"}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={8}
                      style={{
                        width: "100%", padding: "10px 36px 10px 12px", borderRadius: 8,
                        border: "1px solid #dde2ec", background: "var(--color-surface-light, #f0f3f8)",
                        color: "var(--color-text-primary, #2b3450)", fontSize: 14, outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                    <button type="button" onClick={() => setShowConfirm(!showConfirm)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary, #98a0b8)" }}>
                      {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {error && (
                  <p role="alert" style={{ fontSize: 13, color: "#d45050", marginBottom: 12 }}>{error}</p>
                )}

                <button
                  type="submit"
                  disabled={resetPassword.isPending || !password || !confirm}
                  style={{
                    width: "100%", padding: "10px 0", borderRadius: 8,
                    background: "#5b6d8a", color: "#fff", border: "none",
                    fontSize: 14, fontWeight: 600, cursor: resetPassword.isPending ? "wait" : "pointer",
                    opacity: resetPassword.isPending || !password || !confirm ? 0.6 : 1,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}
                >
                  {resetPassword.isPending && <Loader2 size={16} className="animate-spin" />}
                  {t("auth.resetPassword.title")}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
