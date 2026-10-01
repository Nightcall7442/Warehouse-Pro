import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { User, ShieldCheck, Settings } from "lucide-react";
import { labelled, ROLE_LABEL } from "@/lib/entity-labels";
import { F, COLORS } from "./types";
import { Section, BtnPrimary, BtnSecondary } from "./ui";

/*
  «Мой профиль» суперадмина — карточка, а не вторая форма.

  Здесь жила урезанная копия профиля: имя, телефон, пароль. Полный профиль —
  Настройки → Профиль (ProfileSettings): там же вход с кодом из приложения,
  выход на всех устройствах и — у суперадмина — смена логина. Две формы
  одного и того же расходились: в копии не было ни второго фактора, ни
  логина, и владелец искал их не там (01.10.2026). Теперь одно место для
  всех настроек аккаунта, а здесь — кто вошёл, под каким логином, включён ли
  второй фактор, и дорога туда.

  Данные — из auth.me (useAuth), а не user.me: после смены логина профиль
  сбрасывает именно auth.me, и карточка показывает новый логин сразу.
*/
const PROFILE = "/settings?section=profile";

export function AdminActions() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const totpOn = Boolean((user as { totpEnabledAt?: unknown } | null)?.totpEnabledAt);

  return (
    <Section title="Мой профиль" icon={User}>
      <div data-testid="admin-profile-card" style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
        <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "color-mix(in srgb, var(--color-primary) 10%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <User size={22} style={{ color: COLORS.primaryText }} />
        </div>
        <div style={{ minWidth: 0, flex: "1 1 220px" }}>
          <p style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 600, color: COLORS.textPrimary }}>{user?.name}</p>
          <p style={{ fontSize: "12px", color: COLORS.textTertiary }}>{labelled(ROLE_LABEL, user?.role)}</p>
          <p style={{ fontSize: "13px", color: COLORS.textSecondary, marginTop: "4px", overflowWrap: "anywhere" }}>
            Логин: <span data-testid="admin-login" style={{ color: COLORS.textPrimary, fontWeight: 500 }}>{user?.email}</span>
          </p>
        </div>
        <BtnPrimary onClick={() => navigate(PROFILE)} style={{ minHeight: "44px" }}>
          <Settings size={14} /> Настройки профиля
        </BtnPrimary>
      </div>

      <div data-testid="admin-totp" style={{ marginTop: "20px", paddingTop: "20px", borderTop: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <ShieldCheck size={16} style={{ color: totpOn ? COLORS.primaryText : COLORS.textTertiary }} />
        <span style={{ fontSize: "13px", color: COLORS.textSecondary, fontFamily: F.body, flex: "1 1 240px" }}>
          {totpOn
            ? "Вход с кодом из приложения: включён"
            : "Вход с кодом из приложения не включён — без него нельзя удалить организацию и очистить обращения, а логин меняется по одному паролю"}
        </span>
        {!totpOn && (
          <BtnSecondary onClick={() => navigate(PROFILE)} style={{ minHeight: "44px" }}>Включить</BtnSecondary>
        )}
      </div>
      <p style={{ fontSize: "12px", color: COLORS.textTertiary, marginTop: "12px", fontFamily: F.body }}>
        Имя, телефон, логин, пароль и выход на всех устройствах — в настройках профиля.
      </p>
    </Section>
  );
}
