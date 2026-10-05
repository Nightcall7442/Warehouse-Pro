import { Link } from "react-router";
import { FlaskConical } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/i18n";

/**
 * Полоса «Demo rejim» — над страницей у всех, кто вошёл в демо-организацию
 * жюри (/demo). Признак приходит с сервера в auth.me (api/services/pitch-demo):
 * та же организация, что и у запретов, — полоса не может разойтись с ними.
 * Не закрывается: человек должен помнить, что данные образцовые и что часть
 * настроек закрыта.
 */
export function DemoBanner() {
  const { user, logout } = useAuth();
  const { lang } = useLang();
  if (!user || !(user as { demo?: boolean }).demo) return null;
  const tr = (uz: string, ru: string) => (lang === "uz" ? uz : ru);
  return (
    <div role="status" data-testid="demo-banner" className="flex flex-wrap items-center gap-x-3 gap-y-1"
      style={{ margin: "12px 20px 0", padding: "10px 14px", borderRadius: 14, background: "var(--color-warning-subtle)", color: "var(--color-warning-text)", fontSize: 13.5, fontWeight: 600 }}>
      <FlaskConical size={16} aria-hidden="true" />
      <span style={{ flex: "1 1 220px" }}>{tr("Demo rejim — ma'lumotlar namunaviy", "Демо-режим — данные образцовые")}</span>
      <Link to="/demo" style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 3, padding: "6px 0" }}>{tr("Demo sahifasi", "Страница демо")}</Link>
      <button type="button" onClick={() => { void logout(); }} style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 3, padding: "6px 0", background: "none", border: 0, cursor: "pointer", font: "inherit" }}>
        {tr("Chiqish", "Выйти")}
      </button>
    </div>
  );
}
