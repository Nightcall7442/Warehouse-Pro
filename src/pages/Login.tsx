import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router";
import { useAuth } from "@/hooks/useAuth";

import { Eye, EyeOff, Loader2, Mail, Lock, ShieldCheck, BarChart2, WifiOff, MapPin, AlertCircle } from "lucide-react";
import { useTranslate } from "@/i18n";
import { ROLE_ROUTES } from "@/const";

const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };

export default function Login() {
  const tr = useTranslate();

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
    if (!email || !password) { setError(tr("Введите email и пароль", "Email va parolni kiriting")); return; }

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
      setError(err.message || tr("Неверный email или пароль", "Email yoki parol noto'g'ri"));
    } finally {
      setIsPending(false);
    }
  };

  if (isLoading) return null;
  if (user) return null;

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--color-canvas, #f0f2f5)" }}>

      {/* ── Left panel (branding) ── */}
      <div style={{
        display: "none", flexDirection: "column", justifyContent: "space-between",
        width: "52%", padding: "48px", position: "relative", overflow: "hidden",
      }} className="login-left">
        {/* Gradient background */}
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(135deg, #4f46e5, #7c3aed, #4338ca)",
        }} />
        {/* Grid texture */}
        <div style={{
          position: "absolute", inset: 0, opacity: 0.08,
          backgroundImage: "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
          backgroundSize: "50px 50px",
        }} />

        {/* Logo */}
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, marginBottom: 48, zIndex: 1 }}>
          <div style={{ width: 44, height: 44, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.15)", backdropFilter: "blur(10px)" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <span style={{ fontFamily: F.display, fontSize: "22px", fontWeight: 700, color: "#fff" }}>Warehouse Pro</span>
        </div>

        {/* Hero content */}
        <div style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 14px",
            borderRadius: 24, background: "rgba(255,255,255,0.1)", backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.15)", marginBottom: 32, alignSelf: "flex-start",
          }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 8px rgba(74,222,128,0.5)" }} />
            <span style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.9)" }}>
              {tr("Система управления складом", "Ombor boshqaruv tizimi")}
            </span>
          </div>

          <h1 style={{ fontSize: "44px", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.03em", color: "#fff", margin: "0 0 20px" }}>
            {tr("Полный контроль над бизнесом", "Biznes ustidan to'liq nazorat")}
          </h1>
          <p style={{ fontSize: "17px", color: "rgba(255,255,255,0.8)", lineHeight: 1.6, maxWidth: 420 }}>
            {tr("Заказы, агенты, склад — всё в одном месте с любого устройства", "Buyurtmalar, agentlar, ombor — bir joyda, istalgan qurilmadan")}
          </p>

          {/* Features */}
          <div style={{ marginTop: 48, display: "flex", flexDirection: "column", gap: 20 }}>
            {[
              { icon: <MapPin size={18} />, text: tr("GPS-слежение агентов", "GPS kuzatuv") },
              { icon: <BarChart2 size={18} />, text: tr("Аналитика в один клик", "Bir bosishda tahlil") },
              { icon: <WifiOff size={18} />, text: tr("Офлайн-режим", "Oflayn rejim") },
              { icon: <ShieldCheck size={18} />, text: tr("Безопасное хранение", "Xavfsiz saqlash") },
            ].map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)" }}>
                  <div style={{ color: "#fff" }}>{f.icon}</div>
                </div>
                <span style={{ fontSize: "15px", color: "rgba(255,255,255,0.9)", fontWeight: 500 }}>{f.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "13px", color: "rgba(255,255,255,0.5)", zIndex: 1 }}>
          <p>© 2025 Warehouse Pro</p>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80" }} />
            <span>v2.5.0</span>
          </div>
        </div>
      </div>

      {/* ── Right panel (form) ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 24px", position: "relative" }}>

        {/* Mobile gradient header */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 160,
          background: "linear-gradient(135deg, #4f46e5, #7c3aed, #4338ca)",
        }} className="login-mobile-header" />

        {/* Mobile logo */}
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, marginBottom: 32, paddingTop: 32, zIndex: 1 }} className="login-mobile-logo">
          <div style={{ width: 44, height: 44, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.15)", backdropFilter: "blur(10px)" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <span style={{ fontFamily: F.display, fontSize: "22px", fontWeight: 700, color: "#fff" }}>Warehouse Pro</span>
        </div>

        {/* Form */}
        <div style={{ width: "100%", maxWidth: 420, position: "relative", zIndex: 1 }}>
          <div className="glass-panel" style={{ padding: "40px 36px", borderRadius: 28, boxShadow: "0 25px 60px -15px rgba(0,0,0,0.2)" }}>

            {/* Header */}
            <div style={{ marginBottom: 36 }}>
              <h2 style={{ fontFamily: F.display, fontSize: "32px", fontWeight: 700, color: "var(--color-text-primary, #111827)", margin: "0 0 8px", letterSpacing: "-0.02em" }}>
                {tr("Добро пожаловать", "Xush kelibsiz")}
              </h2>
              <p style={{ fontSize: "15px", color: "var(--color-text-secondary, #6b7280)", margin: 0 }}>
                {tr("Войдите в свой аккаунт", "Hisobingizga kiring")}
              </p>
            </div>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Email */}
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary, #111827)", marginBottom: 8 }}>Email</label>
                <div style={{ position: "relative" }}>
                  <Mail size={18} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #9ca3af)", pointerEvents: "none" }} />
                  <input type="email" style={{
                    width: "100%", padding: "14px 14px 14px 44px", borderRadius: 14,
                    fontSize: "15px", fontFamily: F.body, color: "var(--color-text-primary, #111827)",
                    background: "var(--color-surface-light, #f8f9fb)", border: "2px solid transparent",
                    outline: "none", transition: "all 0.2s ease",
                  }} placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" disabled={isPending}
                    onFocus={e => { e.currentTarget.style.borderColor = "#818cf8"; e.currentTarget.style.boxShadow = "0 0 0 4px rgba(129,140,248,.10)"; }}
                    onBlur={e => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.boxShadow = "none"; }}
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary, #111827)", marginBottom: 8 }}>{tr("Пароль", "Parol")}</label>
                <div style={{ position: "relative" }}>
                  <Lock size={18} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #9ca3af)", pointerEvents: "none" }} />
                  <input type={showPw ? "text" : "password"} style={{
                    width: "100%", padding: "14px 48px 14px 44px", borderRadius: 14,
                    fontSize: "15px", fontFamily: F.body, color: "var(--color-text-primary, #111827)",
                    background: "var(--color-surface-light, #f8f9fb)", border: "2px solid transparent",
                    outline: "none", transition: "all 0.2s ease",
                  }} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" disabled={isPending}
                    onFocus={e => { e.currentTarget.style.borderColor = "#818cf8"; e.currentTarget.style.boxShadow = "0 0 0 4px rgba(129,140,248,.10)"; }}
                    onBlur={e => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.boxShadow = "none"; }}
                  />
                  <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary, #9ca3af)", padding: 0 }} tabIndex={-1}>
                    {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Forgot password link */}
              <div style={{ textAlign: "right", marginTop: -8 }}>
                <Link to="/forgot-password" style={{ fontSize: 13, color: "#818cf8", textDecoration: "none", fontWeight: 500 }}>
                  {tr("Забыли пароль?", "Parolni unutdingizmi?")}
                </Link>
              </div>

              {/* Error */}
              {error && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderRadius: 12,
                  background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.15)", fontSize: "13px", fontWeight: 500, color: "#f87171",
                }}>
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              {/* Submit */}
              <button type="submit" disabled={isPending} style={{
                width: "100%", padding: "14px 24px", borderRadius: 14, fontSize: "15px", fontWeight: 600,
                fontFamily: F.body, color: "#fff", border: "none", cursor: "pointer",
                background: "linear-gradient(135deg, #818cf8, #6366f1)",
                boxShadow: "0 4px 16px rgba(129,140,248,.30), inset 0 1px 0 rgba(255,255,255,0.12)",
                opacity: isPending ? 0.6 : 1, transition: "all 0.2s ease",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              }}>
                {isPending ? (
                  <><Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />{tr("Вход…", "Kirish…")}</>
                ) : tr("Войти", "Kirish")}
              </button>
            </form>

            {/* Register */}
            <div style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid #f3f4f6", textAlign: "center" }}>
              <p style={{ fontSize: "14px", color: "var(--color-text-secondary, #6b7280)", margin: 0 }}>
                {tr("Нет аккаунта?", "Hisobingiz yo'qmi?")}{" "}
                <Link to="/register" style={{ fontWeight: 600, color: "#818cf8", textDecoration: "none" }}>
                  {tr("Создать", "Yaratish")}
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* CSS for responsive */}
      <style>{`
        @media (min-width: 1024px) {
          .login-left { display: flex !important; }
          .login-mobile-header { display: none !important; }
          .login-mobile-logo { display: none !important; }
        }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
