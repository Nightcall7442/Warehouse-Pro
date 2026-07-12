import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useTheme } from "@/hooks/useTheme";
import { notify } from "@/lib/toast";
import { Settings as SettingsIcon, Save, Moon, Sun, Globe, Building2 } from "lucide-react";
import { CardDots, Card, PageHeader, btnPrimary, inputStyle } from "@/components/DashboardLayout";

const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };

export default function Settings() {
  const { lang, setLang } = useLang();
  const { fmt } = useCurrency();
  const { theme, toggle } = useTheme();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data: settings } = trpc.settings.get.useQuery();
  const updateSettings = trpc.settings.update.useMutation({
    onSuccess: () => notify.success(t("Настройки сохранены", "Sozlamalar saqlandi")),
    onError: (e) => notify.error(e.message),
  });

  const [companyName, setCompanyName] = useState(settings?.companyName ?? "");
  const [currency, setCurrency] = useState(settings?.currency ?? "UZS");

  if (settings && !companyName) {
    setCompanyName(settings.companyName ?? "");
    setCurrency(settings.currency ?? "UZS");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader title={t("Настройки", "Sozlamalar")} subtitle={t("Управление параметрами системы", "Tizim parametrlarini boshqarish")} />

      {/* Company Info */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px" }}>
          <div style={{ width: "28px", height: "28px", borderRadius: "8px", background: "rgba(129,140,248,.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Building2 size={14} color="var(--color-primary, #818cf8)" />
          </div>
          <h3 style={{ fontFamily: F.display, fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary, #111827)", margin: 0 }}>{t("Компания", "Kompaniya")}</h3>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div>
            <label style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", display: "block", marginBottom: "6px" }}>{t("Название", "Nomi")}</label>
            <input value={companyName} onChange={e => setCompanyName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", display: "block", marginBottom: "6px" }}>{t("Валюта", "Valyuta")}</label>
            <input value={currency} onChange={e => setCurrency(e.target.value)} style={inputStyle} />
          </div>
        </div>
        <button onClick={() => updateSettings.mutate({ companyName, currency })} disabled={updateSettings.isPending} style={{ ...btnPrimary, marginTop: "16px" }}>
          <Save size={14} /> {t("Сохранить", "Saqlash")}
        </button>
      </Card>

      {/* Appearance */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px" }}>
          <div style={{ width: "28px", height: "28px", borderRadius: "8px", background: "rgba(129,140,248,.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <SettingsIcon size={14} color="var(--color-primary, #818cf8)" />
          </div>
          <h3 style={{ fontFamily: F.display, fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary, #111827)", margin: 0 }}>{t("Внешний вид", "Ko'rinish")}</h3>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderRadius: "12px", background: "var(--color-surface-light, #f8f9fb)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {theme === "dark" ? <Moon size={16} color="var(--color-primary, #818cf8)" /> : <Sun size={16} color="var(--color-warning, #fbbf24)" />}
              <span style={{ fontSize: "13px", color: "var(--color-text-primary, #111827)" }}>{t("Тёмная тема", "Qorong'u tema")}</span>
            </div>
            <button onClick={toggle} style={{ width: "44px", height: "24px", borderRadius: "12px", border: "none", cursor: "pointer", background: theme === "dark" ? "var(--color-primary, #818cf8)" : "var(--color-surface-hover, #f3f4f6)", transition: "all 0.2s", position: "relative" }}>
              <span style={{ position: "absolute", top: "2px", left: theme === "dark" ? "22px" : "2px", width: "20px", height: "20px", borderRadius: "50%", background: "#fff", transition: "all 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,.1)" }} />
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderRadius: "12px", background: "var(--color-surface-light, #f8f9fb)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Globe size={16} color="var(--color-success, #4ade80)" />
              <span style={{ fontSize: "13px", color: "var(--color-text-primary, #111827)" }}>{t("Язык", "Til")}</span>
            </div>
            <div style={{ display: "flex", gap: "4px" }}>
              {(["ru", "uz"] as const).map(l => (
                <button key={l} onClick={() => setLang(l)} style={{ padding: "6px 12px", borderRadius: "8px", border: "none", cursor: "pointer", fontSize: "12px", fontWeight: 600, fontFamily: F.body, background: lang === l ? "var(--color-primary, #818cf8)" : "transparent", color: lang === l ? "#fff" : "var(--color-text-secondary, #6b7280)", transition: "all 0.15s" }}>
                  {l === "ru" ? "РУС" : "UZB"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
