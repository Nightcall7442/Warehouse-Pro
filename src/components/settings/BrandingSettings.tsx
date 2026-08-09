import { useState, useRef } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { compressImage } from "@/lib/compress-image";
import { Loader2, Upload, Palette, RotateCcw } from "lucide-react";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";

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

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="font-label text-[10px] text-secondary tracking-wider w-28 flex-shrink-0">{label}</label>
      <div className="flex items-center gap-2 flex-1">
        <input type="color" value={value || "#5b6d8a"}
          onChange={e => onChange(e.target.value)}
          className="w-10 h-10 rounded-lg cursor-pointer border border-border" />
        <input className="neo-input flex-1 font-mono text-sm" value={value}
          onChange={e => onChange(e.target.value)} placeholder="#5b6d8a" />
      </div>
    </div>
  );
}

export function BrandingSettings() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const logoRef = useRef<HTMLInputElement>(null);
  const faviconRef = useRef<HTMLInputElement>(null);

  const { data: branding, isLoading, isError, refetch } = trpc.branding.get.useQuery();
  const utils = trpc.useUtils();

  const [form, setForm] = useState<typeof DEFAULTS | null>(null);

  // Initialize form from API data
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

  const handleLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { notify.error(t("Макс. 5 МБ", "Maks. 5 MB")); return; }
    try {
      const compressed = await compressImage(file);
      setForm(f => f ? { ...f, logoUrl: compressed } : f);
    } catch { notify.error(t("Ошибка обработки изображения", "Rasmni qayta ishlash xatosi")); }
  };

  const handleFavicon = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1 * 1024 * 1024) { notify.error(t("Макс. 1 МБ", "Maks. 1 MB")); return; }
    try {
      const compressed = await compressImage(file);
      setForm(f => f ? { ...f, faviconUrl: compressed } : f);
    } catch { notify.error(t("Ошибка обработки изображения", "Rasmni qayta ishlash xatosi")); }
  };

  const resetColors = () => {
    setForm(f => f ? {
      ...f,
      primaryColor: DEFAULTS.primaryColor,
      secondaryColor: DEFAULTS.secondaryColor,
      accentColor: DEFAULTS.accentColor,
    } : f);
  };

  if (isError) return <QueryErrorFallback onRetry={refetch} />;
  if (isLoading || !form) return <div className="h-32 bg-surface-light animate-pulse rounded-xl" />;

  return (
    <div className="space-y-6">
      {/* ── Logo ──────────────────────────────────────────────── */}
      <div>
        <label className="font-label text-[10px] text-secondary tracking-wider block mb-2">
          {t("ЛОГОТИП", "LOGOTIP")}
        </label>
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-xl flex items-center justify-center overflow-hidden cursor-pointer border-2 border-dashed transition-colors hover:border-primary"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface-light)" }}
            onClick={() => logoRef.current?.click()}
          >
            {form.logoUrl
              ? <img src={form.logoUrl} alt="logo" className="w-full h-full object-contain" />
              : <Upload size={20} className="text-secondary" />}
          </div>
          <div>
            <button onClick={() => logoRef.current?.click()} className="neo-btn text-sm flex items-center gap-2">
              <Upload size={14} />{t("Загрузить логотип", "Logotip yuklash")}
            </button>
            <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary)" }}>
              {t("PNG, JPG — макс. 5 МБ", "PNG, JPG — maks. 5 MB")}
            </p>
          </div>
          <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogo} />
        </div>
      </div>

      {/* ── Favicon ───────────────────────────────────────────── */}
      <div>
        <label className="font-label text-[10px] text-secondary tracking-wider block mb-2">
          {t("FAVICON", "FAVICON")}
        </label>
        <div className="flex items-center gap-4">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden cursor-pointer border-2 border-dashed transition-colors hover:border-primary"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface-light)" }}
            onClick={() => faviconRef.current?.click()}
          >
            {form.faviconUrl
              ? <img src={form.faviconUrl} alt="favicon" className="w-full h-full object-contain" />
              : <Upload size={14} className="text-secondary" />}
          </div>
          <button onClick={() => faviconRef.current?.click()} className="neo-btn text-sm flex items-center gap-2">
            <Upload size={14} />{t("Загрузить favicon", "Favicon yuklash")}
          </button>
          <input ref={faviconRef} type="file" accept="image/*" className="hidden" onChange={handleFavicon} />
        </div>
      </div>

      {/* ── Colors ────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="font-label text-[10px] text-secondary tracking-wider flex items-center gap-2">
            <Palette size={12} />{t("ЦВЕТА БРЕНДА", "BREND RANGLARI")}
          </label>
          <button onClick={resetColors} className="text-xs text-secondary hover:text-primary flex items-center gap-1 transition-colors">
            <RotateCcw size={12} />{t("Сбросить", "Tiklash")}
          </button>
        </div>
        <div className="space-y-3">
          <ColorField label={t("Основной", "Asosiy")} value={form.primaryColor} onChange={v => setForm(f => f ? { ...f, primaryColor: v } : f)} />
          <ColorField label={t("Вторичный", "Ikkinchi")} value={form.secondaryColor} onChange={v => setForm(f => f ? { ...f, secondaryColor: v } : f)} />
          <ColorField label={t("Акцент", "Aksent")} value={form.accentColor} onChange={v => setForm(f => f ? { ...f, accentColor: v } : f)} />
        </div>

        {/* Preview */}
        <div className="mt-4 p-4 rounded-xl border" style={{ borderColor: "var(--color-border)" }}>
          <p className="text-[10px] text-secondary tracking-wider mb-2">{t("ПРЕДПРОСМОТР", "OLDINDAN KO'RISH")}</p>
          <div className="flex gap-2">
            <div className="w-10 h-10 rounded-lg" style={{ background: form.primaryColor }} title="Primary" />
            <div className="w-10 h-10 rounded-lg" style={{ background: form.secondaryColor }} title="Secondary" />
            <div className="w-10 h-10 rounded-lg" style={{ background: form.accentColor }} title="Accent" />
          </div>
          <div className="mt-3 flex gap-2">
            <button className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ background: form.primaryColor }}>
              {t("Кнопка", "Tugma")}
            </button>
            <button className="px-4 py-2 rounded-lg text-sm font-medium border" style={{ borderColor: form.primaryColor, color: form.primaryColor }}>
              {t("Вторичная", "Ikkinchi")}
            </button>
          </div>
        </div>
      </div>

      {/* ── Text fields ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
            {t("НАЗВАНИЕ КОМПАНИИ", "KOMPANIYA NOMI")}
          </label>
          <input className="neo-input w-full" value={form.companyName}
            onChange={e => setForm(f => f ? { ...f, companyName: e.target.value } : f)}
            placeholder="Warehouse Pro" />
        </div>
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
            {t("НАЗВАНИЕ ПРИЛОЖЕНИЯ", "ILOVA NOMI")}
          </label>
          <input className="neo-input w-full" value={form.appName}
            onChange={e => setForm(f => f ? { ...f, appName: e.target.value } : f)}
            placeholder="Warehouse Pro" />
        </div>
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
            {t("ЗАГОЛОВОК ЛОГИНА", "LOGIN SARLAVHASI")}
          </label>
          <input className="neo-input w-full" value={form.loginTitle}
            onChange={e => setForm(f => f ? { ...f, loginTitle: e.target.value } : f)}
            placeholder={t("Добро пожаловать", "Xush kelibsiz")} />
        </div>
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
            {t("ПОДЗАГОЛОВОК ЛОГИНА", "LOGIN TAGLAVHASI")}
          </label>
          <input className="neo-input w-full" value={form.loginSubtitle}
            onChange={e => setForm(f => f ? { ...f, loginSubtitle: e.target.value } : f)}
            placeholder={t("Войдите в систему", "Tizimga kiring")} />
        </div>
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
            {t("EMAIL ПОДДЕРЖKI", "QO'LLAB-QUVVATLASH EMAIL")}
          </label>
          <input className="neo-input w-full" value={form.supportEmail}
            onChange={e => setForm(f => f ? { ...f, supportEmail: e.target.value } : f)}
            placeholder="support@example.com" />
        </div>
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
            {t("ТЕЛЕФОН ПОДДЕРЖКИ", "QO'LLAB-QUVVATLASH TELEFONI")}
          </label>
          <input className="neo-input w-full" value={form.supportPhone}
            onChange={e => setForm(f => f ? { ...f, supportPhone: e.target.value } : f)}
            placeholder="+998 XX XXX XX XX" />
        </div>
      </div>

      <div>
        <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
          {t("ТЕКСТ В ПОДВАЛЕ", "ALOYIDAGI MATN")}
        </label>
        <input className="neo-input w-full" value={form.footerText}
          onChange={e => setForm(f => f ? { ...f, footerText: e.target.value } : f)}
          placeholder="© 2026 Company Name" />
      </div>

      {/* ── Save ──────────────────────────────────────────────── */}
      <button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}
        className="neo-btn-primary flex items-center gap-2 disabled:opacity-40">
        {saveMutation.isPending && <Loader2 size={14} className="animate-spin" />}
        {t("Сохранить брендинг", "Brendingni saqlash")}
      </button>
    </div>
  );
}
