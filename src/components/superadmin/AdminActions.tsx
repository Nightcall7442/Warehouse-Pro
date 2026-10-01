import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { User, Settings } from "lucide-react";
import { labelled, ROLE_LABEL } from "@/lib/entity-labels";
import { F, COLORS } from "./types";
import { Section, BtnPrimary, BtnSecondary } from "./ui";

/*
  «Мой профиль» суперадмина — карточка, а не вторая форма: кто вошёл, логин,
  включён ли вход с кодом из приложения, и одна дорога — «Настройки
  профиля». Всё, что меняется (имя, логин, пароль, второй фактор, сеансы), —
  там, в блоках (settings/ProfileSettings).

  Здесь жила урезанная копия профиля, потом — длинные пояснения и сноска.
  Владелец, 01.10.2026: «аккуратно, чётко». Осталось состояние; когда второй
  фактор выключен — ещё «Включить», которая ведёт прямо к его блоку: его
  отсутствие закрывает удаление организаций и чистку обращений, и искать,
  где он включается, владельцу уже приходилось.

  Данные — из auth.me (useAuth): после смены логина профиль сбрасывает
  именно его, и карточка показывает новый логин сразу.
*/
const PROFILE = "/settings?section=profile";

export function AdminActions() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const totpOn = Boolean((user as { totpEnabledAt?: unknown } | null)?.totpEnabledAt);

  const label = { fontSize: "12px", color: COLORS.textTertiary, fontFamily: F.body } as const;
  const value = { fontSize: "14px", color: COLORS.textPrimary, fontWeight: 500, fontFamily: F.body, overflowWrap: "anywhere" } as const;

  return (
    <Section title="Мой профиль" icon={User}>
      <div data-testid="admin-profile-card" style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        <div style={{ width: "44px", height: "44px", borderRadius: "14px", background: "color-mix(in srgb, var(--color-primary) 10%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <User size={20} style={{ color: COLORS.primaryText }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 600, color: COLORS.textPrimary, overflowWrap: "anywhere" }}>{user?.name}</p>
          <p style={{ fontSize: "12px", color: COLORS.textTertiary }}>{labelled(ROLE_LABEL, user?.role)}</p>
        </div>
      </div>

      <dl style={{ marginTop: "16px", display: "grid", gap: "12px" }}>
        <div>
          <dt style={label}>Логин</dt>
          <dd data-testid="admin-login" style={value}>{user?.email}</dd>
        </div>
        <div data-testid="admin-totp" style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 180px", minWidth: 0 }}>
            <dt style={label}>Вход с кодом из приложения</dt>
            <dd style={{ ...value, color: totpOn ? "var(--color-success-text)" : "var(--color-warning-text)" }}>{totpOn ? "Включён" : "Выключен"}</dd>
          </div>
          {!totpOn && (
            <BtnSecondary onClick={() => navigate(`${PROFILE}&block=totp`)} style={{ minHeight: "44px", fontSize: "14px" }}>Включить</BtnSecondary>
          )}
        </div>
      </dl>

      <BtnPrimary onClick={() => navigate(PROFILE)} style={{ minHeight: "44px", fontSize: "14px", marginTop: "16px", width: "100%" }}>
        <Settings size={16} /> Настройки профиля
      </BtnPrimary>
    </Section>
  );
}
