import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { useTranslate } from "@/i18n";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { AuthShell, AuthError } from "@/components/auth/AuthShell";

/**
 * Ссылка из письма после регистрации: подтверждает адрес и ведёт ко входу.
 *
 * Подтверждение шлётся один раз при открытии — повтор безвреден, но
 * лишний запрос ни к чему. Ссылка без токена и просроченная — отдельные
 * ответы: первая чинится письмом заново, вторая — тоже, но человеку нужно
 * это сказать словами, а не «ошибкой».
 *
 * Вызов — голым клиентом, а не useMutation: мутация, запущенная из эффекта
 * при монтировании, в dev под StrictMode теряет ответ (наблюдатель
 * отписывается на пробном размонтировании и к мутации уже не
 * возвращается) — экран так и висел на «одну секунду». Состояние здесь
 * своё, и ему всё равно, кто на что подписан.
 */
type State = { kind: "pending" } | { kind: "done" } | { kind: "error"; message: string };

export default function VerifyEmail() {
  const tr = useTranslate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const client = trpc.useUtils().client;
  const [state, setState] = useState<State>({ kind: "pending" });
  const fired = useRef(false);

  useEffect(() => {
    if (!token || fired.current) return;
    fired.current = true;
    client.auth.verifyEmail.mutate({ token }).then(
      () => setState({ kind: "done" }),
      (e: unknown) => setState({ kind: "error", message: e instanceof Error ? e.message : String(e) }),
    );
  }, [token, client]);

  const toLogin = (
    <Link to="/login" className="neo-btn-primary" data-testid="verify-email-login"
      style={{ width: "100%", height: "46px", borderRadius: "14px", fontSize: "14px", textDecoration: "none" }}>
      {tr("Войти", "Kirish")}
    </Link>
  );

  if (!token || state.kind === "error") {
    return (
      <AuthShell title={tr("Ссылка не сработала", "Havola ishlamadi")} subtitle={tr("Подтверждение адреса", "Manzilni tasdiqlash")}>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <AuthError>
            <AlertCircle size={15} style={{ flexShrink: 0, marginTop: "1px" }} />
            <span>{state.kind === "error" ? state.message : tr("В ссылке нет кода подтверждения.", "Havolada tasdiqlash kodi yo'q.")}</span>
          </AuthError>
          <p style={{ fontSize: "13.5px", color: "var(--color-text-secondary)", margin: 0 }}>
            {tr("Новое письмо можно запросить на странице входа — введите почту и пароль, там будет кнопка.",
                "Yangi xatni kirish sahifasida so'rash mumkin — pochta va parolni kiriting, u yerda tugma bo'ladi.")}
          </p>
          {toLogin}
        </div>
      </AuthShell>
    );
  }

  if (state.kind === "done") {
    return (
      <AuthShell title={tr("Адрес подтверждён", "Manzil tasdiqlandi")} subtitle={tr("Теперь можно войти", "Endi kirishingiz mumkin")}>
        <div style={{ textAlign: "center", paddingTop: "4px" }} data-testid="verify-email-done">
          <div style={{
            width: "58px", height: "58px", borderRadius: "20px", margin: "0 auto 20px",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--color-success-subtle)", color: "var(--color-success-text, var(--color-success))",
            boxShadow: "var(--shadow-sm)",
          }}>
            <CheckCircle2 size={26} />
          </div>
          {toLogin}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={tr("Подтверждаем адрес…", "Manzil tasdiqlanmoqda…")} subtitle={tr("Одну секунду", "Bir soniya")}>
      <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
        <Loader2 size={22} style={{ animation: "spin 1s linear infinite", color: "var(--color-text-tertiary)" }} />
      </div>
    </AuthShell>
  );
}
