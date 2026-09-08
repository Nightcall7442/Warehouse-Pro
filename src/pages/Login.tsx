import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { Eye, EyeOff, Loader2, Mail, Lock, AlertCircle, Building2 } from "lucide-react";
import { useLang } from "@/i18n";
import { ROLE_ROUTES } from "@/const";
import { AuthShell, AuthError } from "@/components/auth/AuthShell";

type Organization = { tenantId: number; name: string };

/**
 * Вход.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Первый экран системы был собран мимо её собственного оформления: тридцать
 * шесть цветов, вписанных числом, из палитры, которой в приложении нет (бирюза
 * #0d9488 у кнопки и синяя тень от неё же — остаток ещё более раннего вида),
 * шрифт Inter, который даже не подключён и подставлялся системным, тёмной темы
 * нет вовсе. Приветствие «Добро пожаловать» стояло дважды: слева крупно и ещё
 * раз в карточке.
 *
 * Отдельно жаловались на жёлтые полосы вокруг поля при вводе логина — это
 * Chrome красит автозаполненное поле своим фоном. Лечится не здесь, а один раз
 * на всё приложение: см. блок «АВТОЗАПОЛНЕНИЕ» в src/index.css.
 *
 * Действия остались прежние: войти, показать пароль, выбрать организацию,
 * восстановить пароль, зарегистрироваться.
 */
export default function Login() {
  const { t } = useLang();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);
  // Один адрес может быть заведён в нескольких организациях. Если пароль
  // подошёл сразу к нескольким, сервер отвечает 409 и называет их — выбрать
  // за человека нельзя, данные в этих организациях разные.
  const [orgChoice, setOrgChoice] = useState<{ message: string; organizations: Organization[] } | null>(null);

  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && user) {
      const dest = ROLE_ROUTES[user.role] ?? "/";
      navigate(dest, { replace: true });
    }
  }, [user, isLoading, navigate]);

  const submit = async (tenantId?: number) => {
    setError("");
    if (!email || !password) { setError(t("auth.login.fillAll")); return; }

    setIsPending(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(tenantId === undefined ? { email, password } : { email, password, tenantId }),
      });
      const data = await res.json();
      if (res.status === 409 && data.code === "TENANT_REQUIRED") {
        setOrgChoice({ message: data.error, organizations: data.organizations ?? [] });
        return;
      }
      if (!res.ok) throw new Error(data.error || "Login failed");
      window.location.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.login.error"));
    } finally {
      setIsPending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submit();
  };

  if (isLoading) return null;
  if (user) return null;

  return (
    <AuthShell
      title={t("auth.login.title")}
      subtitle={t("auth.login.subtitle")}
      footer={
        <>
          {t("auth.login.noAccount")}{" "}
          <Link to="/register" style={{ fontWeight: 700, color: "var(--color-primary-text)", textDecoration: "none" }}>
            {t("auth.login.createAccount")}
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <Field label={t("auth.login.email")}>
          <span className="auth-icon"><Mail size={16} /></span>
          <input
            data-testid="login-email"
            type="email"
            className="auth-input"
            placeholder="you@company.com"
            value={email}
            onChange={e => { setEmail(e.target.value); setOrgChoice(null); }}
            autoComplete="email"
            disabled={isPending}
          />
        </Field>

        <Field label={t("auth.login.password")}>
          <span className="auth-icon"><Lock size={16} /></span>
          <input
            data-testid="login-password"
            type={showPw ? "text" : "password"}
            className="auth-input"
            style={{ paddingRight: "46px" }}
            placeholder="••••••••"
            value={password}
            onChange={e => { setPassword(e.target.value); setOrgChoice(null); }}
            autoComplete="current-password"
            disabled={isPending}
          />
          <button
            type="button"
            onClick={() => setShowPw(!showPw)}
            aria-label={showPw ? t("auth.login.password") : t("auth.login.password")}
            style={{
              position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)",
              width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center",
              background: "none", border: "none", borderRadius: "10px", cursor: "pointer",
              color: "var(--color-text-tertiary)",
            }}
          >
            {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </Field>

        <div style={{ textAlign: "right", marginTop: "-6px" }}>
          <Link
            to="/forgot-password"
            style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--color-primary-text)", textDecoration: "none" }}
          >
            {t("auth.login.forgotPassword")}
          </Link>
        </div>

        {/* Пароль подошёл к нескольким организациям — выбрать за человека нельзя. */}
        {orgChoice && (
          <div style={{
            padding: "14px", borderRadius: "14px", background: "var(--color-primary-subtle)",
            display: "flex", flexDirection: "column", gap: "8px",
          }}>
            <span style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--color-primary-text)" }}>
              {orgChoice.message}
            </span>
            {orgChoice.organizations.map(org => (
              <button
                key={org.tenantId}
                type="button"
                disabled={isPending}
                onClick={() => void submit(org.tenantId)}
                className="neo-btn"
                style={{ justifyContent: "flex-start", width: "100%", fontSize: "13px", padding: "11px 14px" }}
              >
                <Building2 size={15} />
                {org.name}
              </button>
            ))}
          </div>
        )}

        {error && (
          <AuthError>
            <AlertCircle size={15} style={{ flexShrink: 0, marginTop: "1px" }} />
            <span>{error}</span>
          </AuthError>
        )}

        <button
          data-testid="login-submit"
          type="submit"
          disabled={isPending}
          className="neo-btn-primary"
          style={{ width: "100%", height: "48px", borderRadius: "14px", fontSize: "14px", marginTop: "4px" }}
        >
          {isPending
            ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />{t("auth.login.submitting")}</>
            : t("auth.login.submit")}
        </button>
      </form>
    </AuthShell>
  );
}

/** Поле с подписью. Значок кладётся внутрь — отсюда position: relative. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em",
        textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: "7px",
      }}>
        {label}
      </label>
      <div style={{ position: "relative" }}>{children}</div>
    </div>
  );
}
