/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router";
import { useAuth } from "@/hooks/useAuth";

import { Eye, EyeOff, Loader2, Mail, Lock, AlertCircle } from "lucide-react";
import { useLang } from "@/i18n";
import { ROLE_ROUTES } from "@/const";

const F = { display: "'Inter', -apple-system, system-ui, sans-serif", body: "'Inter', -apple-system, system-ui, sans-serif" };

export default function Login() {
  const { t } = useLang();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);

  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && user) {
      const dest = ROLE_ROUTES[user.role] ?? "/";
      navigate(dest, { replace: true });
    }
  }, [user, isLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email || !password) { setError(t("auth.login.fillAll")); return; }

    setIsPending(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      window.location.replace("/");
    } catch (err: any) {
      setError(err.message || t("auth.login.error"));
    } finally {
      setIsPending(false);
    }
  };

  if (isLoading) return null;
  if (user) return null;

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: F.body }}>

      {/* ── Left panel (hero) ── */}
      <div style={{
        display: "none", flexDirection: "column", justifyContent: "space-between",
        width: "55%", padding: "56px 64px", position: "relative", overflow: "hidden",
        background: "#111827", color: "#fff",
      }} className="login-left">

        {/* Subtle grid pattern */}
        <div style={{
          position: "absolute", inset: 0, opacity: 0.03,
          backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }} />

        {/* Accent glow */}
        <div style={{
          position: "absolute", top: "-20%", right: "-10%", width: "60%", height: "60%",
          background: "radial-gradient(circle, rgba(79,70,229,0.15) 0%, transparent 70%)",
          filter: "blur(60px)", pointerEvents: "none",
        }} />

        {/* Logo */}
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14, zIndex: 1 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "#4f46e5",
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <span style={{ fontFamily: F.display, fontSize: "18px", fontWeight: 700, letterSpacing: "-0.01em" }}>
            Warehouse Pro
          </span>
        </div>

        {/* Hero content */}
        <div style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: 460 }}>
          <h1 style={{
            fontFamily: F.display, fontSize: "42px", fontWeight: 800,
            lineHeight: 1.08, letterSpacing: "-0.035em", margin: "0 0 24px", whiteSpace: "pre-line",
          }}>
            {t("auth.login.title")}
          </h1>
          <p style={{ fontSize: "16px", color: "#9ca3af", lineHeight: 1.6, margin: 0 }}>
            {t("auth.login.subtitle")}
          </p>
        </div>

        {/* Footer */}
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12px", color: "#4b5563", zIndex: 1 }}>
          <span>© 2025 Warehouse Pro</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
            <span>v2.5.0</span>
          </div>
        </div>
      </div>

      {/* ── Right panel (form) ── */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: "40px 24px",
        background: "#faf9f7", position: "relative",
      }}>

        {/* Mobile header */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 4,
          background: "#4f46e5",
        }} className="login-mobile-bar" />

        {/* Mobile logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 40, zIndex: 1 }} className="login-mobile-logo">
          <div style={{
            width: 36, height: 36, borderRadius: 9,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "#4f46e5",
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <span style={{ fontFamily: F.display, fontSize: "17px", fontWeight: 700, color: "#111827", letterSpacing: "-0.01em" }}>
            Warehouse Pro
          </span>
        </div>

        {/* Form card */}
        <div className="animate-fade-up" style={{ width: "100%", maxWidth: 400, position: "relative", zIndex: 1 }}>
          <div style={{
            background: "#fff", borderRadius: 16, padding: "40px 36px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)",
            border: "1px solid #f0eeeb",
          }}>

            {/* Header */}
            <div style={{ marginBottom: 32 }}>
              <h2 style={{
                fontFamily: F.display, fontSize: "26px", fontWeight: 700,
                color: "#111827", margin: "0 0 6px", letterSpacing: "-0.02em",
              }}>
                {t("auth.login.title")}
              </h2>
              <p style={{ fontSize: "14px", color: "#6b7280", margin: 0 }}>
                {t("auth.login.subtitle")}
              </p>
            </div>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {/* Email */}
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#374151", marginBottom: 6 }}>
                  {t("auth.login.email")}
                </label>
                <div style={{ position: "relative" }}>
                  <Mail size={16} style={{
                    position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
                    color: "#9ca3af", pointerEvents: "none",
                  }} />
                  <input
                    type="email"
                    className="login-input"
                    style={{
                      width: "100%", padding: "12px 12px 12px 40px",
                      borderRadius: 10, fontSize: "14px", fontFamily: F.body,
                      background: "#fff", color: "#111827",
                      boxSizing: "border-box",
                    }}
                    placeholder="you@company.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="email"
                    disabled={isPending}
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#374151", marginBottom: 6 }}>
                  {t("auth.login.password")}
                </label>
                <div style={{ position: "relative" }}>
                  <Lock size={16} style={{
                    position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
                    color: "#9ca3af", pointerEvents: "none",
                  }} />
                  <input
                    type={showPw ? "text" : "password"}
                    className="login-input"
                    style={{
                      width: "100%", padding: "12px 44px 12px 40px",
                      borderRadius: 10, fontSize: "14px", fontFamily: F.body,
                      background: "#fff", color: "#111827",
                      boxSizing: "border-box",
                    }}
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                    disabled={isPending}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    className="pw-toggle-btn"
                    style={{
                      position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                      background: "none", border: "none", cursor: "pointer",
                      color: "#9ca3af", padding: 4, display: "flex",
                    }}
                    aria-label={showPw ? "Hide password" : "Show password"}
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Forgot password */}
              <div style={{ textAlign: "right", marginTop: -4 }}>
                <Link
                  to="/forgot-password"
                  className="forgot-link"
                  style={{ fontSize: "13px", color: "#4f46e5", textDecoration: "none", fontWeight: 500 }}
                >
                  {t("auth.login.forgotPassword")}
                </Link>
              </div>

              {/* Error */}
              {error && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 10,
                  background: "#fef2f2", border: "1px solid #fecaca",
                  fontSize: "13px", fontWeight: 500, color: "#dc2626",
                }}>
                  <AlertCircle size={15} />
                  <span>{error}</span>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={isPending}
                className="submit-btn"
                style={{
                  width: "100%", padding: "12px 24px", borderRadius: 10,
                  fontSize: "14px", fontWeight: 600, fontFamily: F.body,
                  border: "none", cursor: isPending ? "not-allowed" : "pointer",
                  background: "#4f46e5", color: "#fff",
                  opacity: isPending ? 0.7 : 1,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  transition: "background 0.15s, transform 0.1s",
                  boxShadow: "0 1px 2px rgba(79,70,229,0.3)",
                }}
              >
                {isPending ? (
                  <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />{t("auth.login.submitting")}</>
                ) : t("auth.login.submit")}
              </button>
            </form>

            {/* Register */}
            <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid #f3f4f6", textAlign: "center" }}>
              <p style={{ fontSize: "13px", color: "#6b7280", margin: 0 }}>
                {t("auth.login.noAccount")}{""}
                <Link
                  to="/register"
                  className="register-link"
                  style={{ fontWeight: 600, color: "#4f46e5", textDecoration: "none", marginLeft: 4 }}
                >
                  {t("auth.login.createAccount")}
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Responsive */}
      <style>{`
        .login-input {
          border: 1px solid #e5e7eb;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .login-input:focus {
          border-color: #4f46e5 !important;
          box-shadow: 0 0 0 3px rgba(79,70,229,0.1) !important;
        }
        .pw-toggle-btn:hover { color: #6b7280 !important; }
        .forgot-link:hover { color: #4338ca !important; }
        .register-link:hover { color: #4338ca !important; }
        .submit-btn:not(:disabled):hover { background: #4338ca !important; }
        .submit-btn:not(:disabled):active { transform: scale(0.98); }
        @media (min-width: 1024px) {
          .login-left { display: flex !important; }
          .login-mobile-bar { display: none !important; }
          .login-mobile-logo { display: none !important; }
        }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
