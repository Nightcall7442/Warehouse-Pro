import { PremiumSelect } from "@/components/PremiumSelect";
import { PACKAGE_CODE_MAX, VAT_RATES, VAT_RATE_LABEL, isBadIkpu } from "@contracts/tax-requisites";

/*
  ИКПУ, код упаковки и ставка НДС — в форме нового товара и в правке карточки.

  Нужны для ЭСФ в 1С и для фискализации (Payme, Click): без ИКПУ чек не
  пробить, без ставки — не выделить налог в накладной. Все три необязательны:
  пусто — «не задано», и документы печатаются как раньше. ИКПУ не того
  формата форма не отправляет — то же правило проверяет сервер
  (contracts/tax-requisites.ts).
*/

export type ProductTaxDraft = { ikpu: string; packageCode: string; vatRate: string };

export function ProductTaxFields({ lang, value, onChange }: {
  lang: string; value: ProductTaxDraft; onChange: (patch: Partial<ProductTaxDraft>) => void;
}) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const bad = isBadIkpu(value.ikpu);
  const ikpuLabel = t("ИКПУ (МХИК), 17 цифр", "MXIK (IKPU), 17 raqam");
  return (
    <>
      <div>
        <input className="neo-input w-full font-data" inputMode="numeric" autoComplete="off" data-testid="product-ikpu"
          placeholder={ikpuLabel} aria-label={ikpuLabel} aria-invalid={bad}
          value={value.ikpu} onChange={e => onChange({ ikpu: e.target.value })} />
        {bad && (
          <p role="alert" className="text-xs mt-1" style={{ color: "var(--color-danger-text)" }}>
            {t("ИКПУ — 17 цифр", "MXIK — 17 raqam")}
          </p>
        )}
      </div>
      <input className="neo-input font-data" maxLength={PACKAGE_CODE_MAX} autoComplete="off" data-testid="product-package-code"
        placeholder={t("Код упаковки", "Qadoq kodi")} aria-label={t("Код упаковки", "Qadoq kodi")}
        value={value.packageCode} onChange={e => onChange({ packageCode: e.target.value })} />
      <PremiumSelect aria-label={t("Ставка НДС", "QQS stavkasi")} value={value.vatRate} onChange={v => onChange({ vatRate: v })}
        options={[
          { value: "", label: t("Ставка НДС — не задана", "QQS stavkasi — belgilanmagan") },
          ...VAT_RATES.map(r => ({ value: r, label: lang === "uz" ? VAT_RATE_LABEL[r].uz : VAT_RATE_LABEL[r].ru })),
        ]}
        width="100%" />
    </>
  );
}
