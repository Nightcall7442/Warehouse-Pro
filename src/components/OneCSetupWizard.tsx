import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import {
  CheckCircle2, XCircle, Loader2, Settings, Server,
  Database, RefreshCw, AlertTriangle, ArrowRight, ArrowLeft,
} from "lucide-react";

type Step = "welcome" | "config" | "test" | "schedule" | "done";

export function OneCSetupWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>("welcome");
  const [config, setConfig] = useState({ url: "", username: "", password: "" });
  const [testResult, setTestResult] = useState<any>(null);
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data: sampleConfig } = trpc.onec.wizard.sampleConfig.useQuery();
  const testConnection = trpc.onec.wizard.testConnection.useMutation({
    onSuccess: (data) => {
      setTestResult(data);
      setStep(data.success ? "schedule" : "test");
    },
    onError: (e) => {
      setTestResult({ success: false, error: e.message });
      setStep("test");
    },
  });

  const steps = [
    { key: "welcome", label: t("Начало", "Boshlash") },
    { key: "config", label: t("Настройка", "Sozlash") },
    { key: "test", label: t("Тест", "Sinov") },
    { key: "schedule", label: t("Расписание", "Jadval") },
    { key: "done", label: t("Готово", "Tayyor") },
  ];

  const currentStep = steps.findIndex(s => s.key === step);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(12px)" }}>
      <div className="w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl overflow-hidden animate-fade-up"
        style={{ background: "var(--color-surface)", boxShadow: "0 -25px 60px -15px rgba(0,0,0,0.3)" }}>

        {/* Progress bar */}
        <div style={{ height: "3px", background: "var(--color-surface-light)" }}>
          <div style={{
            height: "100%", background: "var(--color-primary)",
            width: `${((currentStep + 1) / steps.length) * 100}%`,
            transition: "width 0.3s ease",
          }} />
        </div>

        {/* Header */}
        <div style={{ padding: "20px 24px 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "18px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>
              {t("Настройка 1С", "1C sozlash")}
            </h2>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary)" }}>
              <XCircle size={20} />
            </button>
          </div>
          {/* Step indicators */}
          <div style={{ display: "flex", gap: "4px", marginTop: "12px" }}>
            {steps.map((s, i) => (
              <div key={s.key} style={{
                flex: 1, height: "3px", borderRadius: "2px",
                background: i <= currentStep ? "var(--color-primary)" : "var(--color-surface-light)",
                transition: "background 0.3s",
              }} />
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: "20px 24px", minHeight: "300px" }}>
          {/* Step 1: Welcome */}
          {step === "welcome" && (
            <div style={{ textAlign: "center" }}>
              <div style={{
                width: "64px", height: "64px", borderRadius: "16px", margin: "0 auto 16px",
                background: "linear-gradient(135deg, #5b6d8a, #60a5fa)", display: "flex",
                alignItems: "center", justifyContent: "center",
              }}>
                <Database size={28} color="#fff" />
              </div>
              <h3 style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-text-primary)", margin: "0 0 8px" }}>
                {t("Подключение к 1С", "1C ga ulanish")}
              </h3>
              <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", margin: "0 0 20px", maxWidth: "320px", marginInline: "auto" }}>
                {t("Настройте интеграцию с 1С для автоматической синхронизации товаров и заказов", "1C bilan integratsiyani sozlang — mahsulotlar va buyurtmalarni avtomatik sinxronlashtirish uchun")}
              </p>
              {sampleConfig?.bridgeRequirements && (
                <div style={{ textAlign: "left", padding: "12px 16px", borderRadius: "12px", background: "var(--color-surface-light)", marginBottom: "16px" }}>
                  <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 8px" }}>
                    {t("Требования:", "Talablar:")}
                  </p>
                  {sampleConfig.bridgeRequirements.map((req, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "8px", marginBottom: "4px" }}>
                      <CheckCircle2 size={12} style={{ color: "var(--color-success)", marginTop: "2px", flexShrink: 0 }} />
                      <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{req}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Config */}
          {step === "config" && (
            <div className="space-y-4">
              <div>
                <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: "6px" }}>
                  {t("URL 1C Bridge", "1C Bridge URL")}
                </label>
                <input
                  className="neo-input w-full"
                  placeholder="http://your-server:8080"
                  value={config.url}
                  onChange={e => setConfig(p => ({ ...p, url: e.target.value }))}
                />
              </div>
              <div>
                <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: "6px" }}>
                  {t("Логин", "Login")}
                </label>
                <input
                  className="neo-input w-full"
                  placeholder="admin"
                  value={config.username}
                  onChange={e => setConfig(p => ({ ...p, username: e.target.value }))}
                />
              </div>
              <div>
                <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: "6px" }}>
                  {t("Пароль", "Parol")}
                </label>
                <input
                  className="neo-input w-full"
                  type="password"
                  placeholder="••••••••"
                  value={config.password}
                  onChange={e => setConfig(p => ({ ...p, password: e.target.value }))}
                />
              </div>
              {sampleConfig?.envVars && (
                <div style={{ padding: "10px 14px", borderRadius: "10px", background: "var(--color-surface-light)", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                  <p style={{ margin: "0 0 4px", fontWeight: 600 }}>{t("Альтернатива — переменные окружения:", "Muqobil — muhit o'zgaruvchilari:")}</p>
                  <code style={{ fontSize: "10px", fontFamily: "monospace" }}>
                    {Object.entries(sampleConfig.envVars).map(([k, v]) => `${k}=${v}`).join("\n")}
                  </code>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Test */}
          {step === "test" && (
            <div style={{ textAlign: "center" }}>
              {testConnection.isPending ? (
                <div>
                  <Loader2 size={48} className="animate-spin" style={{ color: "var(--color-primary)", margin: "0 auto 16px" }} />
                  <p style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
                    {t("Проверка подключения…", "Ulanishni tekshirish…")}
                  </p>
                </div>
              ) : testResult?.success ? (
                <div>
                  <CheckCircle2 size={48} style={{ color: "var(--color-success)", margin: "0 auto 16px" }} />
                  <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-success)" }}>
                    {t("Подключение успешно!", "Ulanish muvaffaqiyatli!")}
                  </p>
                </div>
              ) : (
                <div>
                  <XCircle size={48} style={{ color: "var(--color-danger)", margin: "0 auto 16px" }} />
                  <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-danger)", margin: "0 0 8px" }}>
                    {t("Ошибка подключения", "Ulanish xatosi")}
                  </p>
                  <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                    {testResult?.error || t("Проверьте URL и учётные данные", "URL va ma'lumotlarni tekshiring")}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 4: Schedule */}
          {step === "schedule" && (
            <div className="space-y-4">
              <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", margin: 0 }}>
                {t("Настройте автоматическую синхронизацию:", "Avtomatik sinxronlashni sozlang:")}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                {[
                  { value: 30, label: "30 " + t("мин", "daq") },
                  { value: 60, label: "1 " + t("час", "soat") },
                  { value: 120, label: "2 " + t("часа", "soat") },
                  { value: 360, label: "6 " + t("часов", "soat") },
                ].map(opt => (
                  <button key={opt.value} className="neo-card-sm" style={{
                    padding: "12px", textAlign: "center", cursor: "pointer", border: "none",
                    background: "var(--color-surface)", color: "var(--color-text-primary)",
                  }}>
                    <p style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>{opt.label}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 5: Done */}
          {step === "done" && (
            <div style={{ textAlign: "center" }}>
              <CheckCircle2 size={64} style={{ color: "var(--color-success)", margin: "0 auto 16px" }} />
              <h3 style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text-primary)", margin: "0 0 8px" }}>
                {t("Настройка завершена!", "Sozlash tugadi!")}
              </h3>
              <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", margin: 0 }}>
                {t("1С интеграция активна. Товары и заказы будут синхронизироваться автоматически.", "1C integratsiya faol. Mahsulotlar va buyurtmalar avtomatik sinxronlanadi.")}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between" }}>
          <button
            onClick={() => {
              const idx = steps.findIndex(s => s.key === step);
              if (idx > 0) setStep(steps[idx - 1].key as Step);
              else onClose();
            }}
            className="neo-btn flex items-center gap-2"
          >
            <ArrowLeft size={14} />
            {step === "welcome" ? t("Отмена", "Bekor") : t("Назад", "Orqaga")}
          </button>
          <button
            onClick={() => {
              if (step === "config") {
                testConnection.mutate(config);
                setStep("test");
              } else if (step === "schedule") {
                setStep("done");
              } else if (step === "welcome") {
                setStep("config");
              } else {
                onClose();
              }
            }}
            className="neo-btn-primary flex items-center gap-2"
            disabled={step === "config" && (!config.url || !config.username)}
          >
            {step === "done" ? t("Готово", "Tayyor") : step === "test" ? t("Далее", "Keyingi") : t("Далее", "Keyingi")}
            {step !== "done" && <ArrowRight size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
