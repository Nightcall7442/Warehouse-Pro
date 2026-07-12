import { useState } from "react";
import { useSearchParams, Link, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useTranslate } from "@/i18n";
import { Lock, Loader2, ArrowLeft, CheckCircle2, Eye, EyeOff } from "lucide-react";

export default function ResetPassword() {
  const tr = useTranslate();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const resetPassword = trpc.auth.confirmPasswordReset.useMutation({
    onSuccess: () => setDone(true),
    onError: (e) => setError(e.message),
  });

  if (!token) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", background: "#f0f2f5", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 8 }}>
            {tr("Неверная ссылка", "Noto'g'ri havola")}
          </h1>
          <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 16 }}>
            {tr("Ссылка для сброса пароля отсутствует или истекла.", "Parolni tiklash havolasi mavjud em yoki muddati tugagan.")}
          </p>
          <Link to="/forgot-password" style={{ color: "#818cf8", fontSize: 14, fontWeight: 600 }}>
            {tr("Запросить новую ссылку", "Yangi havola so'rash")}
          </Link>
        </div>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError(tr("Пароль должен быть не менее 8 символов", "Parol kamida 8 ta belgi bo'lishi kerak"));
      return;
    }
    if (password !== confirm) {
      setError(tr("Пароли не совпадают", "Parollar mos kelmaydi"));
      return;
    }

    resetPassword.mutate({ token, newPassword: password });
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f0f2f5", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 400, padding: "0 24px" }}>
        <Link to="/login" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#6b7280", fontSize: 13, textDecoration: "none", marginBottom: 24 }}>
          <ArrowLeft size={14} /> {tr("Назад к входу", "Orqaga")}
        </Link>

        <div style={{ background: "#ffffff", borderRadius: 16, border: "1px solid #e5e7eb", padding: "32px 28px" }}>
          {done ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: "rgba(74,222,128,.10)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                <CheckCircle2 size={24} style={{ color: "#4ade80" }} />
              </div>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 8 }}>
                {tr("Пароль обновлён", "Parol yangilandi")}
              </h1>
              <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 24 }}>
                {tr("Теперь войдите с новым паролом.", "Endi yangi parol bilan kiring.")}
              </p>
              <button
                onClick={() => navigate("/login")}
                style={{ padding: "10px 24px", background: "#818cf8", color: "#fff", borderRadius: 8, fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer" }}
              >
                {tr("Войти", "Kirish")}
              </button>
            </div>
          ) : (
            <>
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                  <Lock size={24} style={{ color: "#818cf8" }} />
                </div>
                <h1 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 8 }}>
                  {tr("Новый пароль", "Yangi parol")}
                </h1>
                <p style={{ fontSize: 14, color: "#6b7280" }}>
                  {tr("Введите новый пароль для вашего аккаунта.", "Hisobingiz uchun yangi parolni kiriting.")}
                </p>
              </div>

              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                    {tr("НОВЫЙ ПАРОЛЬ", "YANGI PAROL")}
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
                        border: "1px solid #e5e7eb", background: "#f8f9fb",
                        color: "#111827", fontSize: 14, outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                    <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}>
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                    {tr("ПОДТВЕРДИТЕ ПАРОЛЬ", "PAROLNI TASDIQLANG")}
                  </label>
                  <input
                    type={showPw ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={8}
                    style={{
                      width: "100%", padding: "10px 12px", borderRadius: 8,
                      border: "1px solid #e5e7eb", background: "#f8f9fb",
                      color: "#111827", fontSize: 14, outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                {error && (
                  <p style={{ fontSize: 13, color: "#f87171", marginBottom: 12 }}>{error}</p>
                )}

                <button
                  type="submit"
                  disabled={resetPassword.isPending || !password || !confirm}
                  style={{
                    width: "100%", padding: "10px 0", borderRadius: 8,
                    background: "#818cf8", color: "#fff", border: "none",
                    fontSize: 14, fontWeight: 600, cursor: resetPassword.isPending ? "wait" : "pointer",
                    opacity: resetPassword.isPending || !password || !confirm ? 0.6 : 1,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}
                >
                  {resetPassword.isPending && <Loader2 size={16} className="animate-spin" />}
                  {tr("Сохранить пароль", "Parolni saqlash")}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
