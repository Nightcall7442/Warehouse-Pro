import { ArrowLeft, FlaskConical } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/i18n";

/**
 * Полоса «Demo rejim» — над страницей у всех, кто вошёл в демо-организацию
 * жюри (/demo). Признак приходит с сервера в auth.me (api/services/pitch-demo):
 * та же организация, что и у запретов, — полоса не может разойтись с ними.
 * Не закрывается: человек должен помнить, что данные образцовые и что часть
 * настроек закрыта.
 *
 * Действие одно — вернуться к выбору роли. Раньше рядом стояли «Страница
 * демо» (уводила на /demo, оставляя в демо-сессии) и «Выйти» (вела на /login,
 * где жюри без пароля делать нечего) — человек не понимал, как «назад»
 * (05.10.2026). Теперь выход из демо сам ведёт на /demo#prototip
 * (useAuth.logout → logoutTarget), и кнопка говорит, куда именно.
 */
export function DemoBanner() {
  const { user, logout } = useAuth();
  const { lang } = useLang();
  if (!user || !(user as { demo?: boolean }).demo) return null;
  const tr = (uz: string, ru: string) => (lang === "uz" ? uz : ru);
  return (
    <div role="status" data-testid="demo-banner" className="flex flex-wrap items-center gap-x-3 gap-y-1"
      style={{ margin: "12px 20px 0", padding: "6px 6px 6px 14px", borderRadius: 14, background: "var(--color-warning-subtle)", color: "var(--color-warning-text)", fontSize: 13.5, fontWeight: 600 }}>
      <FlaskConical size={16} aria-hidden="true" />
      <span style={{ flex: "1 1 200px" }}>{tr("Demo rejim — ma'lumotlar namunaviy", "Демо-режим — данные образцовые")}</span>
      <button type="button" data-testid="demo-back" onClick={() => { void logout(); }}
        className="neo-btn tap"
        style={{ minHeight: 44, padding: "0 14px", gap: 6, color: "inherit", font: "inherit", fontWeight: 700, whiteSpace: "nowrap" }}>
        <ArrowLeft size={15} aria-hidden="true" />
        {tr("Boshqa rolni tanlash", "Выбрать другую роль")}
      </button>
    </div>
  );
}
