import { isBadTaxId } from "@contracts/tax-requisites";

/*
  ИНН/ПИНФЛ и «плательщик НДС» — в форме нового магазина и в правке карточки.

  Одно поле на оба номера: у юрлица ИНН (9 цифр), у физлица и ИП — ПИНФЛ (14).
  Номер не того формата форма не отправляет и говорит, что не так, — то же
  правило сервер проверяет у себя (contracts/tax-requisites.ts). Пусто —
  «не указан», так можно.
*/

export function TaxRequisitesFields({ lang, taxId, vatPayer, onTaxId, onVatPayer }: {
  lang: string; taxId: string; vatPayer: boolean;
  onTaxId: (v: string) => void; onVatPayer: (v: boolean) => void;
}) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const bad = isBadTaxId(taxId);
  const label = t("ИНН (9 цифр) или ПИНФЛ (14 цифр)", "STIR (9 raqam) yoki JShShIR (14 raqam)");
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
      <div>
        <input className="neo-input w-full font-data" inputMode="numeric" autoComplete="off"
          placeholder={label} aria-label={label} aria-invalid={bad} data-testid="shop-tax-id"
          value={taxId} onChange={e => onTaxId(e.target.value)} />
        {bad && (
          <p role="alert" className="text-xs mt-1" style={{ color: "var(--color-danger-text)" }}>
            {t("ИНН — 9 цифр, ПИНФЛ — 14 цифр", "STIR — 9 raqam, JShShIR — 14 raqam")}
          </p>
        )}
      </div>
      <label className="flex items-center gap-3 text-sm text-primary cursor-pointer" style={{ minHeight: "44px" }}>
        <input type="checkbox" className="neo-toggle" data-testid="shop-vat-payer"
          checked={vatPayer} onChange={e => onVatPayer(e.target.checked)} />
        {t("Плательщик НДС", "QQS to'lovchisi")}
      </label>
    </div>
  );
}
