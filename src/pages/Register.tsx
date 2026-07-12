import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useLang } from "@/i18n";
import { Warehouse, User, Mail, Lock, Eye, EyeOff } from "lucide-react";

export default function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const navigate = useNavigate();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const register = trpc.register.useMutation({
    onSuccess: () => { notify.success(t("Регистрация прошла успешно!", "Muvaffaqiyatli ro'yxatdan o'tdingiz!")); navigate("/"); },
    onError: (e) => notify.error(e.message),
  });

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--color-canvas, #f0f2f5)", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div style={{ width: "100%", maxWidth: "400px" }}>
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{ width: "56px", height: "56px", borderRadius: "16px", background: "linear-gradient(135deg, var(--color-primary, #818cf8), #6366f1)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "16px", boxShadow: "0 4px 12px rgba(129,140,248,.3)" }}>
            <Warehouse size={24} color="#fff" />
          </div>
          <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "24px", fontWeight: 700, color: "var(--color-text-primary, #111827)", margin: 0 }}>Warehouse Pro</h1>
          <p style={{ fontSize: "13px", color: "var(--color-text-secondary, #6b7280)", margin: "4px 0 0" }}>{t("Создайте аккаунт", "Hisob yarating")}</p>
        </div>

        <div style={{ background: "var(--color-surface, #ffffff)", borderRadius: "20px", padding: "32px", boxShadow: "0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", display: "block", marginBottom: "6px" }}>{t("Имя", "Ism")}</label>
              <div style={{ position: "relative" }}>
                <User size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #9ca3af)" }} />
                <input placeholder="Иван Иванов" value={name} onChange={e => setName(e.target.value)} style={{ paddingLeft: "36px" }} className="input-field" />
              </div>
            </div>
            <div>
              <label style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", display: "block", marginBottom: "6px" }}>Email</label>
              <div style={{ position: "relative" }}>
                <Mail size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #9ca3af)" }} />
                <input type="email" placeholder="admin@example.com" value={email} onChange={e => setEmail(e.target.value)} style={{ paddingLeft: "36px" }} className="input-field" />
              </div>
            </div>
            <div>
              <label style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", display: "block", marginBottom: "6px" }}>{t("Пароль", "Parol")}</label>
              <div style={{ position: "relative" }}>
                <Lock size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #9ca3af)" }} />
                <input type={showPwd ? "text" : "password"} placeholder="мин. 8 символов" value={password} onChange={e => setPassword(e.target.value)} style={{ paddingLeft: "36px", paddingRight: "36px" }} className="input-field" />
                <button onClick={() => setShowPwd(v => !v)} style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary, #9ca3af)", padding: "4px" }}>
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button onClick={() => register.mutate({ name, email, password })} disabled={register.isPending || !name || !email || !password || password.length < 8} style={{
              width: "100%", padding: "12px", borderRadius: "12px", fontSize: "14px", fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif", border: "none", cursor: "pointer",
              background: "var(--color-primary, #818cf8)", color: "#fff",
              boxShadow: "0 2px 8px rgba(129,140,248,.25)",
              opacity: !name || !email || password.length < 8 ? 0.5 : 1,
              transition: "all 0.2s ease",
            }}>
              {register.isPending ? "..." : t("Зарегистрироваться", "Ro'yxatdan o'tish")}
            </button>
          </div>
        </div>

        <p style={{ textAlign: "center", fontSize: "13px", color: "var(--color-text-secondary, #6b7280)", marginTop: "20px" }}>
          {t("Уже есть аккаунт?", "Hisob bormi?")} <Link to="/login" style={{ color: "var(--color-primary, #818cf8)", fontWeight: 600, textDecoration: "none" }}>{t("Войти", "Kirish")}</Link>
        </p>
      </div>
    </div>
  );
}
