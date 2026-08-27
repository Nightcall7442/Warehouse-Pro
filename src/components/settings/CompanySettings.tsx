import { useState, useRef } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { compressImage } from "@/lib/compress-image";
import { Upload } from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { FieldGroup, Field, FieldRow, SaveBar } from "./ui";

/**
 * Реквизиты организации.
 *
 * ── Что здесь чинится ───────────────────────────────────────────────────────
 *
 * 1. Банковские реквизиты. settings.update принимает companyBank,
 *    companyBankAccount и companyMfo, счёт на оплату их печатает
 *    (components/orders/InvoicePrintModal.tsx, pages/OrderDetail.tsx) — а
 *    ввести их было негде НИ НА ОДНОМ экране. То есть счета уходили клиентам
 *    без банковских реквизитов, и заполнить их можно было только напрямую в
 *    базе. Поля добавлены.
 *
 * 2. Подпись под загрузкой логотипа обещала «макс. 1 МБ», проверка в коде
 *    отвергала файл на 10 МБ. Всё, что между, загружалось вопреки подписи —
 *    а человек с файлом на 2 МБ даже не пробовал.
 *
 * 3. Форма считала точку перелома от ширины ОКНА (sm:grid-cols-2), хотя стоит
 *    внутри узкой колонки: на окне 768 поле выходило 96 пикселей — в него не
 *    помещался ни заголовок «Название компании», ни ИНН. Сетка переведена на
 *    auto-fit по фактической ширине.
 */

type CompanyForm = {
  companyName: string;
  companyAddress: string;
  companyInn: string;
  companyDirector: string;
  companyPhone: string;
  companyBank: string;
  companyBankAccount: string;
  companyMfo: string;
  currency: string;
  logoUrl: string;
};

const EMPTY: CompanyForm = {
  companyName: "", companyAddress: "", companyInn: "", companyDirector: "", companyPhone: "",
  companyBank: "", companyBankAccount: "", companyMfo: "", currency: "UZS", logoUrl: "",
};

/** Загрузка отвергает файл больше этого; подпись под кнопкой берёт число отсюда же. */
const MAX_LOGO_MB = 10;

export function CompanySettings() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const logoRef = useRef<HTMLInputElement>(null);
  const { data: settings, isLoading, isError, refetch } = trpc.settings.get.useQuery();
  const utils = trpc.useUtils();
  const [form, setForm] = useState<CompanyForm | null>(null);

  if (!isLoading && settings && !form) {
    const s = settings as Partial<Record<keyof CompanyForm, unknown>>;
    const next = { ...EMPTY };
    for (const key of Object.keys(EMPTY) as (keyof CompanyForm)[]) {
      const v = s[key];
      if (v !== null && v !== undefined) next[key] = String(v);
    }
    setForm(next);
  }

  const saveMutation = trpc.settings.update.useMutation({
    onSuccess: () => { utils.settings.get.invalidate(); notify.success(t("Настройки сохранены", "Sozlamalar saqlandi")); },
    onError:   (e) => notify.error(e.message),
  });

  const handleLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_LOGO_MB * 1024 * 1024) {
      notify.error(t(`Макс. ${MAX_LOGO_MB} МБ`, `Maks. ${MAX_LOGO_MB} MB`));
      return;
    }
    try {
      const compressed = await compressImage(file);
      setForm(f => f ? { ...f, logoUrl: compressed } : f);
    } catch { notify.error(t("Не удалось обработать изображение", "Rasmni qayta ishlab bo'lmadi")); }
  };

  if (isError) return <QueryErrorFallback onRetry={refetch} />;
  if (isLoading || !form) return <div className="h-40 bg-surface-light animate-pulse rounded-2xl" />;

  const set = (key: keyof CompanyForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <div>
      <FieldGroup first>
        <div className="flex items-center gap-4 flex-wrap">
          <button type="button" onClick={() => logoRef.current?.click()}
            aria-label={t("Загрузить логотип", "Logotipni yuklash")}
            className="w-20 h-20 rounded-2xl flex items-center justify-center overflow-hidden cursor-pointer transition-colors"
            style={{ border: "2px dashed var(--color-border)", background: "var(--color-surface-light)" }}>
            {form.logoUrl
              ? <img src={form.logoUrl} alt="" className="w-full h-full object-contain p-1" />
              : <Upload size={20} className="text-secondary" />}
          </button>
          <div>
            <button type="button" onClick={() => logoRef.current?.click()} className="neo-btn">
              <Upload size={14} />{form.logoUrl ? t("Заменить логотип", "Logotipni almashtirish") : t("Загрузить логотип", "Logotipni yuklash")}
            </button>
            <p className="text-xs text-tertiary mt-1.5">
              {t(`PNG или JPG, до ${MAX_LOGO_MB} МБ. Печатается на накладных и счетах.`,
                 `PNG yoki JPG, ${MAX_LOGO_MB} MB gacha. Hujjatlarda chop etiladi.`)}
            </p>
          </div>
          <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogo} />
        </div>
      </FieldGroup>

      <FieldGroup title={t("Реквизиты", "Rekvizitlar")}>
        <FieldRow>
          <Field label={t("Название компании", "Kompaniya nomi")}>
            <input className="neo-input" value={form.companyName} onChange={set("companyName")} />
          </Field>
          <Field label={t("Адрес", "Manzil")}>
            <input className="neo-input" value={form.companyAddress} onChange={set("companyAddress")} />
          </Field>
          <Field label={t("ИНН", "STIR")}>
            <input className="neo-input font-data" inputMode="numeric" value={form.companyInn} onChange={set("companyInn")} />
          </Field>
          <Field label={t("Директор", "Direktor")}>
            <input className="neo-input" value={form.companyDirector} onChange={set("companyDirector")} />
          </Field>
          <Field label={t("Телефон", "Telefon")}>
            <input className="neo-input font-data" type="tel" value={form.companyPhone} onChange={set("companyPhone")} />
          </Field>
          <div>
            {/* Здесь не <input>, а собственный компонент, поэтому подпись не
                оборачивается вокруг него: имя контролу даётся через aria-label.
                Раньше на подписи висел id="currency-label", на который никто не
                ссылался, — то есть селект оставался безымянным. */}
            <p className="text-[13px] font-medium text-secondary mb-1.5">
              {t("Валюта", "Valyuta")}
            </p>
            <PremiumSelect value={form.currency}
              aria-label={t("Валюта", "Valyuta")}
              onChange={v => setForm({ ...form, currency: v })}
              options={[
                { value: "UZS", label: t("UZS — Узбекский сум", "UZS — O'zbek so'mi") },
                { value: "USD", label: t("USD — Доллар США", "USD — AQSh dollari") },
                { value: "RUB", label: t("RUB — Российский рубль", "RUB — Rossiya rubli") },
              ]}
              width="100%" />
          </div>
        </FieldRow>
      </FieldGroup>

      <FieldGroup title={t("Банковские реквизиты", "Bank rekvizitlari")}>
        <p className="text-sm text-secondary -mt-2 mb-4">
          {t("Печатаются в счёте на оплату. Пока не заполнены — счёт уходит клиенту без них.",
             "To'lov hisobida chop etiladi. To'ldirilmaguncha hisob ularsiz ketadi.")}
        </p>
        <FieldRow>
          <Field label={t("Банк", "Bank")}>
            <input className="neo-input" value={form.companyBank} onChange={set("companyBank")} />
          </Field>
          <Field label={t("Расчётный счёт", "Hisob raqam")}>
            <input className="neo-input font-data" inputMode="numeric" value={form.companyBankAccount} onChange={set("companyBankAccount")} />
          </Field>
          <Field label={t("МФО", "MFO")}>
            <input className="neo-input font-data" inputMode="numeric" value={form.companyMfo} onChange={set("companyMfo")} />
          </Field>
        </FieldRow>
      </FieldGroup>

      <SaveBar
        onSave={() => saveMutation.mutate(form)}
        isPending={saveMutation.isPending}
        disabled={form.companyName.trim().length === 0}
        label={t("Сохранить", "Saqlash")}
        hint={t("Эти данные попадают в накладные, счета и печатные формы",
                "Bu ma'lumotlar hujjatlar va chop etiladigan shakllarga tushadi")}
      />
    </div>
  );
}
