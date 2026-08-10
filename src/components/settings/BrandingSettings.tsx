import { useState, useRef } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { compressImage } from "@/lib/compress-image";
import { colorMix } from "@/lib/color-mix";
import { Loader2, Upload, RotateCcw, Eye, Lock } from "lucide-react";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { useNavigate } from "react-router";

const DEFAULTS = {
  primaryColor: "#5b6d8a",
  secondaryColor: "#4a5c78",
  accentColor: "#3b82f6",
  companyName: "",
  appName: "Warehouse Pro",
  logoUrl: "",
  faviconUrl: "",
  loginTitle: "",
  loginSubtitle: "",
  footerText: "",
  supportEmail: "",
  supportPhone: "",
  customDomain: "",
  mobileTheme: "auto" as const,
};

export function BrandingSettings() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const logoRef = useRef<HTMLInputElement>(null);
  const faviconRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const { data: billing } = trpc.billing.status.useQuery();
  const { data: branding, isLoading, isError, refetch } = trpc.branding.get.useQuery();
  const utils = trpc.useUtils();
  const [form, setForm] = useState<typeof DEFAULTS | null>(null);

  // Check if user has access to white label features
  const hasWhiteLabel = billing?.plan === "exclusive";

  if (!hasWhiteLabel) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px" }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16, margin: "0 auto 16px",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "color-mix(in srgb, var(--color-primary) 10%, transparent)",
        }}>
          <Lock size={28} style={{ color: "var(--color-primary)" }} />
        </div>
        <h3 style={{ fontFamily: "DM Sans", fontSize: 18, fontWeight: 700, marginBottom: 8, color: "var(--color-text-primary)" }}>
          {t("Брендинг доступен на Exclusive", "Brending Exclusive tarifida mavjud")}
        </h3>
        <p style={{ fontFamily: "DM Sans", fontSize: 14, color: "var(--color-text-secondary)", marginBottom: 20, maxWidth: 400, margin: "0 auto 20px" }}>
          {t(
            "Настройка цветов, логотипа и названия приложения доступна только на тарифе Exclusive.",
            "Ranglar, logotip va ilova nomini sozlash faqat Exclusive tarifida mavjud."
          )}
        </p>
        <button
          onClick={() => navigate("/settings/billing")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "10px 24px", borderRadius: 12, fontSize: 14, fontWeight: 600,
            fontFamily: "DM Sans", color: "#fff",
            background: "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
            border: "none", cursor: "pointer",
          }}
        >
          {t("Обновить тариф", "Tarifni yangilash")}
        </button>
      </div>
    );
  }

  if (!isLoading && branding && !form) {
    setForm({
      primaryColor: branding.primaryColor ?? DEFAULTS.primaryColor,
      secondaryColor: branding.secondaryColor ?? DEFAULTS.secondaryColor,
      accentColor: branding.accentColor ?? DEFAULTS.accentColor,
      companyName: branding.companyName ?? "",
      appName: branding.appName ?? DEFAULTS.appName,
      logoUrl: branding.logoUrl ?? "",
      faviconUrl: (branding as Record<string, unknown>).faviconUrl as string ?? "",
      loginTitle: (branding as Record<string, unknown>).loginTitle as string ?? "",
      loginSubtitle: (branding as Record<string, unknown>).loginSubtitle as string ?? "",
      footerText: (branding as Record<string, unknown>).footerText as string ?? "",
      supportEmail: (branding as Record<string, unknown>).supportEmail as string ?? "",
      supportPhone: (branding as Record<string, unknown>).supportPhone as string ?? "",
      customDomain: (branding as Record<string, unknown>).customDomain as string ?? "",
      mobileTheme: ((branding as Record<string, unknown>).mobileTheme as string ?? "auto") as "auto",
    });
  }

  const saveMutation = trpc.branding.update.useMutation({
    onSuccess: () => {
      utils.branding.get.invalidate();
      utils.branding.cssVariables.invalidate();
      notify.success(t("Брендинг сохранён", "Brending saqlandi"));
    },
    onError: (e) => notify.error(e.message),
  });

  const handleImage = async (e: React.ChangeEvent<HTMLInputElement>, field: "logoUrl" | "faviconUrl", maxMb: number) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > maxMb * 1024 * 1024) { notify.error(t(`Макс. ${maxMb} МБ`, `Maks. ${maxMb} MB`)); return; }
    try {
      const compressed = await compressImage(file);
      setForm(f => f ? { ...f, [field]: compressed } : f);
    } catch { notify.error(t("Ошибка обработки", "Qayta ishlash xatosi")); }
  };

  if (isError) return <QueryErrorFallback onRetry={refetch} />;
  if (isLoading || !form) return <div className="h-48 bg-surface-light animate-pulse rounded-2xl" />;

  const p = form.primaryColor;
  const s = form.secondaryColor;

  return (
    <div className="space-y-5">

      {/* ════════════════════════════════════════════════════════
          LOGO + FAVICON
          ════════════════════════════════════════════════════════ */}
      <div className="neo-card p-5">
        <p className="font-label text-[10px] tracking-wider mb-4" style={{ color: "var(--color-text-secondary)" }}>
          {t("ИДЕНТИЧНОСТЬ БРЕНДА", "BREND IDENTIFIKATSIYASI")}
        </p>
        <div className="flex flex-col sm:flex-row gap-6">
          {/* Logo */}
          <div className="flex items-center gap-4">
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center overflow-hidden cursor-pointer transition-all hover:scale-105"
              style={{
                border: `2px dashed ${colorMix(p, 25)}`,
                background: `linear-gradient(135deg, ${colorMix(p, 5)}, ${colorMix(s, 5)})`,
              }}
              onClick={() => logoRef.current?.click()}
            >
              {form.logoUrl
                ? <img src={form.logoUrl} alt="logo" className="w-full h-full object-contain p-1" />
                : <div className="text-center">
                    <Upload size={20} style={{ color: p }} className="mx-auto mb-1" />
                    <span className="text-[9px]" style={{ color: "var(--color-text-tertiary)" }}>Logo</span>
                  </div>}
            </div>
            <div>
              <button onClick={() => logoRef.current?.click()}
                className="text-sm font-medium flex items-center gap-2 px-3 py-2 rounded-xl transition-all hover:scale-[1.02]"
                style={{ background: colorMix(p, 7), color: p }}>
                <Upload size={14} />{t("Логотип", "Logotip")}
              </button>
              <p className="text-[10px] mt-1.5" style={{ color: "var(--color-text-tertiary)" }}>
                PNG, JPG · {t("макс. 5 МБ", "maks. 5 MB")}
              </p>
            </div>
            <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={e => handleImage(e, "logoUrl", 5)} />
          </div>

          {/* Divider */}
          <div className="hidden sm:block w-px" style={{ background: "var(--color-border)" }} />

          {/* Favicon */}
          <div className="flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden cursor-pointer transition-all hover:scale-105"
              style={{ border: `2px dashed ${colorMix(p, 19)}`, background: `var(--color-surface-light)` }}
              onClick={() => faviconRef.current?.click()}
            >
              {form.faviconUrl
                ? <img src={form.faviconUrl} alt="favicon" className="w-full h-full object-contain p-0.5" />
                : <Upload size={14} style={{ color: "var(--color-text-tertiary)" }} />}
            </div>
            <div>
              <button onClick={() => faviconRef.current?.click()}
                className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all hover:scale-[1.02]"
                style={{ background: "var(--color-surface-light)", color: "var(--color-text-secondary)" }}>
                <Upload size={12} className="inline mr-1.5" />Favicon
              </button>
              <p className="text-[10px] mt-1" style={{ color: "var(--color-text-tertiary)" }}>ICO, PNG · 32×32</p>
            </div>
            <input ref={faviconRef} type="file" accept="image/*,.ico" className="hidden" onChange={e => handleImage(e, "faviconUrl", 1)} />
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════
          COLORS + LIVE PREVIEW
          ════════════════════════════════════════════════════════ */}
      <div className="neo-card p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="font-label text-[10px] tracking-wider flex items-center gap-2" style={{ color: "var(--color-text-secondary)" }}>
            <Eye size={12} />{t("ЦВЕТОВАЯ СХЕМА", "RANG SXEMASI")}
          </p>
          <button onClick={() => setForm(f => f ? { ...f, primaryColor: DEFAULTS.primaryColor, secondaryColor: DEFAULTS.secondaryColor, accentColor: DEFAULTS.accentColor } : f)}
            className="text-[10px] flex items-center gap-1 px-2 py-1 rounded-md transition-all hover:scale-105"
            style={{ color: "var(--color-text-tertiary)", background: "var(--color-surface-light)" }}>
            <RotateCcw size={10} />{t("Сброс", "Tiklash")}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Color pickers */}
          <div className="space-y-3">
            {[
              { key: "primaryColor" as const, label: t("Основной", "Asosiy"), desc: t("Кнопки, ссылки, акценты", "Tugmalar, havolalar, aksentlar") },
              { key: "secondaryColor" as const, label: t("Вторичный", "Ikkinchi"), desc: t("Hover-состояния, заголовки", "Holatlar, sarlavhalar") },
              { key: "accentColor" as const, label: t("Акцент", "Aksent"), desc: t("Уведомления, бейджи", "Bildirishnomalar, belgilar") },
            ].map(c => (
              <div key={c.key} className="flex items-center gap-3 p-3 rounded-xl transition-all hover:scale-[1.01]"
                style={{ background: "var(--color-surface-light)" }}>
                <div className="relative">
                  <input type="color" value={form[c.key]}
                    onChange={e => setForm(f => f ? { ...f, [c.key]: e.target.value } : f)}
                    className="w-11 h-11 rounded-xl cursor-pointer border-2 border-white/50 shadow-md" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold" style={{ color: "var(--color-text-primary)" }}>{c.label}</span>
                    <code className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: "var(--color-surface)", color: "var(--color-text-tertiary)" }}>
                      {form[c.key]}
                    </code>
                  </div>
                  <p className="text-[10px]" style={{ color: "var(--color-text-tertiary)" }}>{c.desc}</p>
                </div>
                <input className="w-20 text-center text-xs font-mono neo-input px-1 py-1.5"
                  value={form[c.key]} onChange={e => setForm(f => f ? { ...f, [c.key]: e.target.value } : f)} />
              </div>
            ))}
          </div>

          {/* Live preview card */}
          <div className="rounded-2xl overflow-hidden shadow-lg" style={{ border: `1px solid ${colorMix(p, 12)}` }}>
            {/* Header bar */}
            <div className="px-4 py-3 flex items-center gap-3" style={{ background: `linear-gradient(135deg, ${p}, ${s})` }}>
              {form.logoUrl
                ? <img src={form.logoUrl} alt="" className="w-6 h-6 rounded object-contain bg-white/20 p-0.5" />
                : <div className="w-6 h-6 rounded bg-white/20" />}
              <span className="text-white text-sm font-semibold truncate">{form.appName || "Warehouse Pro"}</span>
            </div>
            {/* Content */}
            <div className="p-4 space-y-3" style={{ background: "var(--color-surface)" }}>
              <div className="flex gap-2">
                <div className="flex-1 h-2 rounded-full" style={{ background: colorMix(p, 19) }} />
                <div className="flex-1 h-2 rounded-full" style={{ background: "var(--color-border)" }} />
              </div>
              <div className="flex gap-3">
                <button className="flex-1 py-2 rounded-xl text-white text-xs font-semibold shadow-md"
                  style={{ background: `linear-gradient(135deg, ${p}, ${s})` }}>
                  {t("Создать заказ", "Buyurtma yaratish")}
                </button>
                <button className="flex-1 py-2 rounded-xl text-xs font-semibold border"
                  style={{ borderColor: colorMix(p, 25), color: p, background: colorMix(p, 4) }}>
                  {t("Отмена", "Bekor qilish")}
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-2 h-2 rounded-full" style={{ background: form.accentColor }} />
                <span className="text-[10px]" style={{ color: "var(--color-text-tertiary)" }}>
                  {t("Акцентный цвет", "Aksent rang")} — {form.accentColor}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════
          TEXT FIELDS
          ════════════════════════════════════════════════════════ */}
      <div className="neo-card p-5">
        <p className="font-label text-[10px] tracking-wider mb-4" style={{ color: "var(--color-text-secondary)" }}>
          {t("ТЕКСТЫ И КОНТАКТЫ", "MATNLAR VA KONTAKTLAR")}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { key: "companyName" as const, label: t("Компания", "Kompaniya"), ph: "Acme Corp" },
            { key: "appName" as const, label: t("Приложение", "Ilova"), ph: "Warehouse Pro" },
            { key: "loginTitle" as const, label: t("Заголовок логина", "Login sarlavhasi"), ph: t("Добро пожаловать", "Xush kelibsiz") },
            { key: "loginSubtitle" as const, label: t("Подзаголовок", "Taglavha"), ph: t("Войдите в систему", "Tizimga kiring") },
            { key: "supportEmail" as const, label: t("Email поддержки", "Qo'llab-quvvatlash email"), ph: "support@company.com" },
            { key: "supportPhone" as const, label: t("Телефон", "Telefon"), ph: "+998 XX XXX XX XX" },
          ].map(f => (
            <div key={f.key}>
              <label className="font-label text-[10px] tracking-wider block mb-1.5" style={{ color: "var(--color-text-secondary)" }}>
                {f.label}
              </label>
              <input className="neo-input w-full text-sm" value={form[f.key]}
                onChange={e => setForm(v => v ? { ...v, [f.key]: e.target.value } : v)}
                placeholder={f.ph} />
            </div>
          ))}
        </div>
        <div className="mt-4">
          <label className="font-label text-[10px] tracking-wider block mb-1.5" style={{ color: "var(--color-text-secondary)" }}>
            {t("Текст в подвале", "Pastki matn")}
          </label>
          <input className="neo-input w-full text-sm" value={form.footerText}
            onChange={e => setForm(v => v ? { ...v, footerText: e.target.value } : v)}
            placeholder="© 2026 Company Name" />
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════
          SAVE
          ════════════════════════════════════════════════════════ */}
      <div className="flex justify-end">
        <button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}
          className="neo-btn-primary px-6 py-2.5 flex items-center gap-2 text-sm font-semibold rounded-xl disabled:opacity-40 transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: `linear-gradient(135deg, ${p}, ${s})` }}>
          {saveMutation.isPending && <Loader2 size={14} className="animate-spin" />}
          {t("Сохранить", "Saqlash")}
        </button>
      </div>
    </div>
  );
}
