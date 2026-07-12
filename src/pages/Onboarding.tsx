import { useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useLang } from "@/i18n";
import { Warehouse, ArrowRight, ArrowLeft, Check } from "lucide-react";
import { CardDots, Card, btnPrimary, inputStyle } from "@/components/DashboardLayout";

const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [companyName, setCompanyName] = useState("");
  const [currency, setCurrency] = useState("UZS");
  const navigate = useNavigate();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const updateSettings = trpc.settings.update.useMutation({
    onSuccess: () => { notify.success(t("Настройки сохранены", "Sozlamalar saqlandi")); navigate("/"); },
    onError: (e) => notify.error(e.message),
  });

  const steps = [
    { title: t("Добро пожаловать!", "Xush kelibsiz!"), desc: t("Настройте вашу компанию", "Kompaniyangizni sozlang") },
    { title: t("Информация о компании", "Kompaniya haqida"), desc: t("Введите название и валюту", "Nomi va valyutani kiriting") },
    { title: t("Готово!", "Tayyor!"), desc: t("Начните использовать система", "Tizimni ishlatishni boshlang") },
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--color-canvas, #f0f2f5)", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div style={{ width: "100%", maxWidth: "480px" }}>
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{ width: "64px", height: "64px", borderRadius: "18px", background: "linear-gradient(135deg, var(--color-primary, #818cf8), #6366f1)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "20px", boxShadow: "0 4px 16px rgba(129,140,248,.3)" }}>
            <Warehouse size={28} color="#fff" />
          </div>
          <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: "var(--color-text-primary, #111827)", margin: 0 }}>{steps[step].title}</h1>
          <p style={{ fontSize: "14px", color: "var(--color-text-secondary, #6b7280)", margin: "8px 0 0" }}>{steps[step].desc}</p>
        </div>

        <Card>
          {step === 0 && (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <p style={{ fontSize: "14px", color: "var(--color-text-secondary, #6b7280)" }}>{t("Пройдите быструю настройку чтобы начать работу", "Ishni boshlash uchun tez sozlashdan o'ting")}</p>
            </div>
          )}
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", display: "block", marginBottom: "6px" }}>{t("Название компании", "Kompaniya nomi")}</label>
                <input placeholder="ООО Ромашка" value={companyName} onChange={e => setCompanyName(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", display: "block", marginBottom: "6px" }}>{t("Валюта", "Valyuta")}</label>
                <select value={currency} onChange={e => setCurrency(e.target.value)} style={inputStyle}>
                  <option value="UZS">UZS (сум)</option>
                  <option value="USD">USD ($)</option>
                </select>
              </div>
            </div>
          )}
          {step === 2 && (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ width: "56px", height: "56px", borderRadius: "50%", background: "rgba(74,222,128,.10)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "16px" }}>
                <Check size={28} color="#4ade80" />
              </div>
              <p style={{ fontSize: "14px", color: "var(--color-text-secondary, #6b7280)" }}>{t("Система готова к использованию", "Tizim ishlatishga tayyor")}</p>
            </div>
          )}

          <div style={{ display: "flex", gap: "12px", marginTop: "20px" }}>
            {step > 0 && <button onClick={() => setStep(s => s - 1)} style={{ flex: 1, padding: "12px", borderRadius: "12px", fontSize: "14px", fontWeight: 500, fontFamily: F.body, border: "1px solid var(--color-border, #e5e7eb)", background: "transparent", color: "var(--color-text-secondary, #6b7280)", cursor: "pointer" }}><ArrowLeft size={16} /> {t("Назад", "Orqaga")}</button>}
            <button onClick={() => {
              if (step === 1 && companyName) updateSettings.mutate({ companyName, currency });
              else if (step < 2) setStep(s => s + 1);
              else navigate("/");
            }} style={{ ...btnPrimary, flex: 1 }}>
              {step === 2 ? t("Начать", "Boshlash") : <>{t("Далее", "Keyingi")} <ArrowRight size={16} /></>}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}
