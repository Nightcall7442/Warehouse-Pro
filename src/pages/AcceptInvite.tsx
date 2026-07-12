import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useLang } from "@/i18n";
import { Warehouse, Lock, Eye, EyeOff, CheckCircle2 } from "lucide-react";

export default function AcceptInvite() {
  const { token } = useParams();
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const navigate = useNavigate();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const accept = trpc.invite.accept.useMutation({
    onSuccess: () => { notify.success(t("Аккаунт создан!", "Hisob yaratildi!")); navigate("/login"); },
    onError: (e) => notify.error(e.message),
  });

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--color-canvas, #f0f2f5)", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div style={{ width: "100%", maxWidth: "400px" }}>
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{ width: "56px", height: "56px", borderRadius: "16px", background: "linear-gradient(135deg, var(--color-primary, #818cf8), #6366f1)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "16px", boxShadow: "0 4px 12px rgba(129,140,248,.3)" }}>
            <Warehouse size={24} color="#fff" />
          </div>
          <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "24px", fontWeight: 700, color: "var(--color-text-primary, #111827)", margin: 0 }}>{t("Принять приглашение", "Taklifni qabul qilish")}</h1>
          <p style={{ fontSize: "13px", color: "var(--color-text-secondary, #6b7280)", margin: "4px 0 0" }}>{t("Придумайте пароль", "Parol o'ylab toping")}</p>
        </div>

        <div style={{ background: "var(--color-surface, #ffffff)", borderRadius: "20px", padding: "32px", boxShadow: "0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
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
            <button onClick={() => accept.mutate({ token: token ?? "", password })} disabled={accept.isPending || password.length < 8} style={{
              width: "100%", padding: "12px", borderRadius: "12px", fontSize: "14px", fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif", border: "none", cursor: "pointer",
              background: "var(--color-primary, #818cf8)", color: "#fff",
              boxShadow: "0 2px 8px rgba(129,140,248,.25)", opacity: password.length < 8 ? 0.5 : 1,
            }}>
              {accept.isPending ? "..." : t("Принять", "Qabul qilish")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
