import { z } from "zod";
import { IKPU_ERROR, IKPU_RE, PACKAGE_CODE_MAX, TAX_ID_ERROR, TAX_ID_RE, VAT_RATES, onlyDigitsInput } from "@contracts/tax-requisites";

/*
  Вход налоговых реквизитов для ручек магазина и товара.

  Все поля необязательные: мобилка и старые экраны их не шлют, и вызов без
  них обязан работать как раньше. Пустая строка — «стереть» (null), как у
  кредитного лимита и упаковки: форма не отличает «не трогал» от «очистил».
  Пробелы и дефисы в номере — оформление, их снимаем до проверки формата.
*/
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const digitsOrNull = (v: unknown) => (typeof v === "string" ? (onlyDigitsInput(v) || null) : v);

export const taxIdInput = z.preprocess(digitsOrNull, z.string().regex(TAX_ID_RE, TAX_ID_ERROR).nullable().optional());
export const vatPayerInput = z.boolean().optional();

export const ikpuInput = z.preprocess(digitsOrNull, z.string().regex(IKPU_RE, IKPU_ERROR).nullable().optional());
export const packageCodeInput = z.preprocess(
  v => (typeof v === "string" ? blankToNull(v.trim()) : v),
  z.string().max(PACKAGE_CODE_MAX, `Код упаковки — не длиннее ${PACKAGE_CODE_MAX} знаков`).nullable().optional(),
);
export const vatRateInput = z.preprocess(blankToNull, z.enum(VAT_RATES).nullable().optional());
