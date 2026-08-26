import { useState, useRef } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { compressImage } from "@/lib/compress-image";
import { Upload, RotateCcw } from "lucide-react";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { colorMix } from "@/lib/color-mix";
import { readableInk } from "@/lib/contrast";
import { FieldGroup, Field, FieldRow, SaveBar } from "./ui";

/**
 * Брендинг: логотип, цвета, тексты.
 *
 * ── Почему раздел выглядел хуже остальных ───────────────────────────────────
 *
 * Он был собран из трёх карточек .neo-card p-5, вложенных в карточку страницы,
 * а внутри них лежал ещё один тон — ряды цветов. Четыре уровня поверхности, и
 * четвёртый по фону совпадал с первым: глубина не читалась вовсе, просто рябь.
 *
 * Ряд цвета при этом получал 256 пикселей ширины, из которых 172 занимала
 * несжимаемая фурнитура — образец, поле hex и отступы. На название и описание
 * оставалось 84: отсюда и «крошечные образцы», и переносы посреди строки.
 * Один и тот же hex выводился в строке ДВАЖДЫ — в неизменяемом <code> и в поле
 * ввода рядом.
 *
 * Предпросмотр был зажат в ту же колонку (визитка на пол-экрана) и нарисован
 * дефолтной тенью Tailwind — в тёмной теме она не видна вовсе, потому что
 * рассчитана на белый фон.
 *
 * Кнопка «Сохранить» красилась градиентом из выбранных цветов с белым текстом:
 * стоило выбрать светлый основной цвет, и надпись пропадала. Теперь текст
 * подбирается по яркости фона (lib/contrast.ts), а сама кнопка — обычная
 * системная: сохранение не должно менять вид в зависимости от настройки,
 * которую сохраняет.
 */

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

  const { data: branding, isLoading, isError, refetch } = trpc.branding.get.useQuery();
  const utils = trpc.useUtils();
  const [form, setForm] = useState<typeof DEFAULTS | null>(null);

  if (!isLoading && branding && !form) {
    const b = branding as Record<string, unknown>;
    setForm({
      primaryColor: branding.primaryColor ?? DEFAULTS.primaryColor,
      secondaryColor: branding.secondaryColor ?? DEFAULTS.secondaryColor,
      accentColor: branding.accentColor ?? DEFAULTS.accentColor,
      companyName: branding.companyName ?? "",
      appName: branding.appName ?? DEFAULTS.appName,
      logoUrl: branding.logoUrl ?? "",
      faviconUrl: (b.faviconUrl as string) ?? "",
      loginTitle: (b.loginTitle as string) ?? "",
      loginSubtitle: (b.loginSubtitle as string) ?? "",
      footerText: (b.footerText as string) ?? "",
      supportEmail: (b.supportEmail as string) ?? "",
      supportPhone: (b.supportPhone as string) ?? "",
      customDomain: (b.customDomain as string) ?? "",
      mobileTheme: ((b.mobileTheme as string) ?? "auto") as "auto",
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
  const set = (key: keyof typeof DEFAULTS) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(v => v ? { ...v, [key]: e.target.value } : v);

  const COLORS = [
    { key: "primaryColor" as const,   label: t("Основной", "Asosiy"),    desc: t("Кнопки, ссылки, активные пункты меню", "Tugmalar, havolalar, faol menyu") },
    { key: "secondaryColor" as const, label: t("Вторичный", "Ikkinchi"), desc: t("Наведение, градиенты, заголовки", "Hover, gradientlar, sarlavhalar") },
    { key: "accentColor" as const,    label: t("Акцент", "Aksent"),      desc: t("Уведомления и бейджи", "Bildirishnomalar va belgilar") },
  ];

  return (
    <div>
      {/* ── Логотип и favicon ─────────────────────────────────────────────── */}
      <FieldGroup first title={t("Логотип", "Logotip")}>
        <div className="flex flex-wrap items-start gap-8">
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => logoRef.current?.click()}
              aria-label={t("Загрузить логотип", "Logotipni yuklash")}
              className="w-20 h-20 rounded-2xl flex items-center justify-center overflow-hidden"
              style={{ border: `2px dashed ${colorMix(p, 25)}`, background: colorMix(p, 4) }}>
              {form.logoUrl
                ? <img src={form.logoUrl} alt="" className="w-full h-full object-contain p-1" />
                : <Upload size={20} style={{ color: p }} />}
            </button>
            <div>
              <button type="button" onClick={() => logoRef.current?.click()} className="neo-btn">
                <Upload size={14} />{form.logoUrl ? t("Заменить", "Almashtirish") : t("Логотип", "Logotip")}
              </button>
              <p className="text-xs text-tertiary mt-1.5">PNG, JPG · {t("до 5 МБ", "5 MB gacha")}</p>
            </div>
            <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={e => handleImage(e, "logoUrl", 5)} />
          </div>

          <div className="flex items-center gap-4">
            <button type="button" onClick={() => faviconRef.current?.click()}
              aria-label={t("Загрузить favicon", "Favicon yuklash")}
              className="w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden"
              style={{ border: "2px dashed var(--color-border)", background: "var(--color-surface-light)" }}>
              {form.faviconUrl
                ? <img src={form.faviconUrl} alt="" className="w-full h-full object-contain p-0.5" />
                : <Upload size={14} className="text-tertiary" />}
            </button>
            <div>
              <button type="button" onClick={() => faviconRef.current?.click()} className="neo-btn neo-btn-sm">
                <Upload size={12} />Favicon
              </button>
              <p className="text-xs text-tertiary mt-1.5">ICO, PNG · 32×32</p>
            </div>
            <input ref={faviconRef} type="file" accept="image/*,.ico" className="hidden" onChange={e => handleImage(e, "faviconUrl", 1)} />
          </div>
        </div>
      </FieldGroup>

      {/* ── Цвета ─────────────────────────────────────────────────────────── */}
      <FieldGroup title={t("Цвета", "Ranglar")}>
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4 -mt-2">
          <p className="text-sm text-secondary max-w-prose">
            {t("Этими цветами приложение показывается всем сотрудникам организации и на экране входа.",
               "Bu ranglar bilan ilova barcha xodimlarga va kirish ekranida ko'rinadi.")}
          </p>
          <button type="button"
            onClick={() => setForm(f => f ? { ...f, primaryColor: DEFAULTS.primaryColor, secondaryColor: DEFAULTS.secondaryColor, accentColor: DEFAULTS.accentColor } : f)}
            className="neo-btn neo-btn-sm">
            <RotateCcw size={12} />{t("Вернуть стандартные", "Standartga qaytarish")}
          </button>
        </div>

        <div className="grid gap-5 grid-cols-1 xl:grid-cols-[minmax(320px,1fr)_minmax(260px,340px)]">
          <div className="space-y-3">
            {COLORS.map(c => (
              <div key={c.key} className="flex items-center gap-4 p-3 rounded-xl"
                style={{ background: "var(--color-surface-light)" }}>
                <input type="color" value={form[c.key]} onChange={set(c.key)}
                  aria-label={c.label}
                  className="w-14 h-14 rounded-xl cursor-pointer flex-shrink-0"
                  style={{ border: "1px solid var(--color-border)" }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-primary">{c.label}</p>
                  <p className="text-xs text-tertiary mt-0.5">{c.desc}</p>
                </div>
                {/* Один источник значения: раньше hex стоял и здесь, и в
                    неизменяемом <code> слева — два разных вида одного и того же. */}
                <input className="neo-input font-data w-28 text-center flex-shrink-0"
                  aria-label={`${c.label} — HEX`}
                  value={form[c.key]} onChange={set(c.key)} />
              </div>
            ))}
          </div>

          {/* Предпросмотр */}
          <div className="rounded-2xl overflow-hidden self-start"
            style={{ boxShadow: "var(--shadow-raised)", border: `1px solid ${colorMix(p, 13)}` }}>
            <div className="px-4 py-3 flex items-center gap-3" style={{ background: `linear-gradient(135deg, ${p}, ${s})` }}>
              {form.logoUrl
                ? <img src={form.logoUrl} alt="" className="w-6 h-6 rounded object-contain bg-white/20 p-0.5" />
                : <div className="w-6 h-6 rounded" style={{ background: colorMix(readableInk(p), 25) }} />}
              <span className="text-sm font-semibold truncate" style={{ color: readableInk(p) }}>
                {form.appName || "Warehouse Pro"}
              </span>
            </div>
            <div className="p-4 space-y-3" style={{ background: "var(--color-surface)" }}>
              <div className="flex gap-2">
                <div className="flex-1 h-2 rounded-full" style={{ background: colorMix(p, 19) }} />
                <div className="flex-1 h-2 rounded-full" style={{ background: "var(--color-border)" }} />
              </div>
              <div className="flex gap-3">
                <button type="button" className="flex-1 h-9 rounded-xl text-xs font-semibold"
                  style={{ background: `linear-gradient(135deg, ${p}, ${s})`, color: readableInk(p), boxShadow: "var(--shadow-sm)" }}>
                  {t("Создать заказ", "Buyurtma yaratish")}
                </button>
                <button type="button" className="flex-1 h-9 rounded-xl text-xs font-semibold"
                  style={{ border: `1px solid ${colorMix(p, 25)}`, color: p, background: colorMix(p, 4) }}>
                  {t("Отмена", "Bekor qilish")}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: form.accentColor }} />
                <span className="text-xs text-tertiary">{t("Акцентный цвет", "Aksent rang")}</span>
              </div>
            </div>
          </div>
        </div>
      </FieldGroup>

      {/* ── Тексты ────────────────────────────────────────────────────────── */}
      <FieldGroup title={t("Тексты и контакты", "Matnlar va kontaktlar")}>
        <FieldRow>
          <Field label={t("Компания", "Kompaniya")}>
            <input className="neo-input" value={form.companyName} onChange={set("companyName")} placeholder="Acme Corp" />
          </Field>
          <Field label={t("Название приложения", "Ilova nomi")}>
            <input className="neo-input" value={form.appName} onChange={set("appName")} placeholder="Warehouse Pro" />
          </Field>
          <Field label={t("Заголовок на входе", "Kirish sarlavhasi")}>
            <input className="neo-input" value={form.loginTitle} onChange={set("loginTitle")} placeholder={t("Добро пожаловать", "Xush kelibsiz")} />
          </Field>
          <Field label={t("Подзаголовок на входе", "Kirish taglavhasi")}>
            <input className="neo-input" value={form.loginSubtitle} onChange={set("loginSubtitle")} placeholder={t("Войдите в систему", "Tizimga kiring")} />
          </Field>
          <Field label={t("Email поддержки", "Qo'llab-quvvatlash email")}>
            <input className="neo-input" type="email" value={form.supportEmail} onChange={set("supportEmail")} placeholder="support@company.com" />
          </Field>
          <Field label={t("Телефон поддержки", "Qo'llab-quvvatlash telefoni")}>
            <input className="neo-input font-data" type="tel" value={form.supportPhone} onChange={set("supportPhone")} placeholder="+998 XX XXX XX XX" />
          </Field>
        </FieldRow>
        <div className="mt-4 max-w-md">
          <Field label={t("Текст в подвале", "Pastki matn")}>
            <input className="neo-input" value={form.footerText} onChange={set("footerText")} placeholder="© 2026 Company Name" />
          </Field>
        </div>
      </FieldGroup>

      <SaveBar
        onSave={() => saveMutation.mutate(form)}
        isPending={saveMutation.isPending}
        label={t("Сохранить", "Saqlash")}
        hint={t("Изменения увидят все сотрудники организации", "O'zgarishlarni tashkilotning barcha xodimlari ko'radi")}
      />
    </div>
  );
}
