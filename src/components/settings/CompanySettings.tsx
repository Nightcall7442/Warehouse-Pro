import { useState, useRef } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { Loader2, Upload } from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";

export function CompanySettings() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const logoRef = useRef<HTMLInputElement>(null);
  const { data: settings, isLoading, isError, refetch } = trpc.settings.get.useQuery();
  const utils = trpc.useUtils();
  type CompanyForm = Record<string, unknown>;
  const [form, setForm] = useState<CompanyForm | null>(null);

  if (!isLoading && settings && !form) {
    const normalized = Object.fromEntries(
      Object.entries(settings as Record<string, unknown>).map(([k, v]) => [k, v === null ? "" : v])
    );
    setForm(normalized as CompanyForm);
  }

  const saveMutation = trpc.settings.update.useMutation({
    onSuccess: () => { utils.settings.get.invalidate(); notify.success(t("Настройки сохранены", "Sozlamalar saqlandi")); },
    onError:   (e) => notify.error(e.message),
  });

  const handleLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) { notify.error(t("Макс. 1 МБ", "Maks. 1 MB")); return; }
    const reader = new FileReader();
    reader.onload = () => setForm((f: CompanyForm | null) => ({ ...f, logoUrl: reader.result as string } as CompanyForm));
    reader.readAsDataURL(file);
  };

  if (isError) return <QueryErrorFallback onRetry={refetch} />;
  if (isLoading || !form) return <div className="h-32 bg-surface-light animate-pulse rounded-xl" />;

  const FIELDS = [
    { key: "companyName",    ru: "Название компании", uz: "Kompaniya nomi"    },
    { key: "companyAddress", ru: "Адрес",             uz: "Manzil"           },
    { key: "companyInn",     ru: "ИНН",               uz: "STIR"             },
    { key: "companyDirector",ru: "Директор",          uz: "Direktor"         },
    { key: "companyPhone",   ru: "Телефон",           uz: "Telefon"          },
  ];

  return (
    <div className="space-y-4">
      {/* Логотип */}
      <div>
        <label className="font-label text-[10px] text-secondary tracking-wider block mb-2">
          {t("ЛОГОТИП КОМПАНИИ", "KOMPANIYA LOGOTIPI")}
        </label>
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-xl flex items-center justify-center overflow-hidden cursor-pointer border-2 border-dashed transition-colors hover:border-primary"
            style={{ borderColor: "var(--color-border, #dde2ec)", background: "var(--color-surface-light, #f0f3f8)" }}
            onClick={() => logoRef.current?.click()}
          >
            {form.logoUrl
              ? <img src={form.logoUrl as string} alt="logo" className="w-full h-full object-contain" />
              : <Upload size={20} className="text-secondary" />}
          </div>
          <div>
            <button onClick={() => logoRef.current?.click()} className="neo-btn text-sm flex items-center gap-2">
              <Upload size={14} />{t("Загрузить", "Yuklash")}
            </button>
            <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
              {t("PNG, JPG — макс. 1 МБ", "PNG, JPG — maks. 1 MB")}
            </p>
          </div>
          <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogo} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {FIELDS.map(f => (
          <div key={f.key}>
            <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
              {lang === "uz" ? f.uz : f.ru}
            </label>
            <input className="neo-input w-full" value={(form[f.key] as string) ?? ""}
              onChange={e => setForm({ ...form, [f.key]: e.target.value } as CompanyForm)} />
          </div>
        ))}

        {/* Валюта */}
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
            {t("ВАЛЮТА", "VALYUTA")}
          </label>
          <PremiumSelect value={(form.currency as string) ?? "UZS"}
            onChange={v => setForm({ ...form, currency: v } as CompanyForm)}
            options={[{value:"UZS",label:"UZS — Узбекский сум"},{value:"USD",label:"USD — Доллар США"},{value:"RUB",label:"RUB — Российский рубль"}]}
            width="100%" />
        </div>
      </div>

      <button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}
        className="neo-btn-primary flex items-center gap-2 disabled:opacity-40">
        {saveMutation.isPending && <Loader2 size={14} className="animate-spin" />}
        {t("Сохранить", "Saqlash")}
      </button>
    </div>
  );
}
