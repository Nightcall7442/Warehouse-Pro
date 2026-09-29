/**
 * Налоговые реквизиты: ИНН/ПИНФЛ магазина, ИКПУ и ставка НДС товара.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * В Узбекистане продажа между юрлицами идёт с электронной счёт-фактурой (ЭСФ,
 * ПКМ 522), и выписывают её в 1С. У магазина в нашей базе не было ни ИНН, ни
 * признака плательщика НДС, у товара — ни ИКПУ (код МХИК), ни ставки: 1С
 * получала контрагента без ИНН и сопоставляла его по названию, бухгалтер
 * дописывал каждого нового магазина руками.
 *
 * ── Что здесь ───────────────────────────────────────────────────────────────
 *
 * Одно правило на сервер и экран: какой ИНН правильный, какие бывают ставки,
 * как из цены с НДС выделить налог. Сервер проверяет им вход ручек и импорт,
 * форма — то же самое до отправки, накладная — считает им «в т.ч. НДС».
 */

/** Ставка НДС товара. Пусто (null) — не задана: так у всех товаров до этой правки. */
export const VAT_RATES = ["vat12", "vat0", "exempt"] as const;
export type VatRate = (typeof VAT_RATES)[number];

/** Процент, который ставка закладывает в цену. «Без НДС» налога не несёт, как и 0 %. */
export const VAT_PERCENT: Record<VatRate, number> = { vat12: 12, vat0: 0, exempt: 0 };

export const VAT_RATE_LABEL: Record<VatRate, { ru: string; uz: string }> = {
  vat12:  { ru: "НДС 12%", uz: "QQS 12%" },
  vat0:   { ru: "НДС 0%",  uz: "QQS 0%" },
  exempt: { ru: "Без НДС", uz: "QQSsiz" },
};

/** ИНН юрлица — 9 цифр, ПИНФЛ физлица и ИП — 14. Одно поле: у точки бывает одно из двух. */
export const TAX_ID_RE = /^(?:\d{9}|\d{14})$/;
export const TAX_ID_ERROR = "ИНН — 9 цифр, ПИНФЛ — 14 цифр";

/** ИКПУ (код МХИК из каталога tasnif.soliq.uz) — 17 цифр. */
export const IKPU_RE = /^\d{17}$/;
export const IKPU_ERROR = "ИКПУ (МХИК) — 17 цифр";

export const PACKAGE_CODE_MAX = 30;

/** Пробелы и дефисы, которыми номер пишут «для глаз», — не часть номера. */
export function onlyDigitsInput(v: string): string {
  return v.replace(/[\s\u00a0-]/g, "");
}

/** Непустой ИНН/ПИНФЛ не того формата — форма его не отправляет. Пробелы и дефисы — не ошибка. */
export function isBadTaxId(v: string): boolean {
  const d = onlyDigitsInput(v);
  return d !== "" && !TAX_ID_RE.test(d);
}

/** Непустой ИКПУ не из 17 цифр. */
export function isBadIkpu(v: string): boolean {
  const d = onlyDigitsInput(v);
  return d !== "" && !IKPU_RE.test(d);
}

/** ИНН юрлица (9 цифр) — то, что 1С хранит в поле ИНН контрагента. ПИНФЛ туда не идёт. */
export function isCompanyInn(taxId: string | null | undefined): taxId is string {
  return typeof taxId === "string" && /^\d{9}$/.test(taxId);
}

/**
 * Ставка из ячейки Excel или строки ввода: «12», «12%», «НДС 12%», «0», «без НДС».
 * Пусто — null (не задана); нераспознанное — undefined, чтобы строка импорта
 * получила отказ, а не молча ставку «никакую».
 */
export function parseVatRate(raw: unknown): VatRate | null | undefined {
  const s = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  if ((VAT_RATES as readonly string[]).includes(s)) return s as VatRate;
  const bare = s.replace(/^(ндс|qqs|vat)\s*/, "").replace(/\s*%$/, "").replace(",", ".");
  if (bare === "12" || bare === "0.12") return "vat12";
  if (bare === "0") return "vat0";
  if (["без ндс", "без", "не облагается", "qqssiz", "qqs siz", "exempt", "-", "—"].includes(s)) return "exempt";
  return undefined;
}

/**
 * НДС, уже включённый в сумму: сумма × ставка / (100 + ставка), в целых сумах.
 *
 * Правило округления — к ближайшему целому, ровно половина — вверх (от нуля):
 * 14 сум при 12 % — это 1,5 → 2. Для целой суммы результат деления либо целый,
 * либо отстоит от половины не меньше чем на 1/(100+ставка), поэтому
 * Math.round здесь точен и не зависит от двоичной записи дроби.
 */
export function vatIncluded(amount: number, ratePercent: number): number {
  if (!ratePercent || !amount) return 0;
  return Math.sign(amount) * Math.round(Math.abs(amount) * ratePercent / (100 + ratePercent));
}

/**
 * НДС накладной: по строкам и итогом.
 *
 * Строка — налог в её сумме как она напечатана. Итог — налог в сумме «к
 * оплате»: скидка заказа раскладывается по строкам пропорционально (так же
 * заказ уходит в 1С), налог каждой строки округляется до целого, итог — их
 * сумма. Без скидки итог равен сумме строк.
 *
 * applies: у организации есть ИНН и хотя бы одна строка несёт 12 %. Иначе
 * документ печатается как раньше — без единого слова про НДС.
 */
export function invoiceVat(
  items: ReadonlyArray<{ total: number; vatRate?: VatRate | null }>,
  subtotal: number, total: number, sellerInn: string | null | undefined,
): { applies: boolean; lines: Array<number | null>; total: number } {
  const applies = Boolean(sellerInn && sellerInn.trim()) && items.some(i => i.vatRate === "vat12");
  if (!applies) return { applies: false, lines: items.map(() => null), total: 0 };
  const factor = subtotal > 0 && total !== subtotal ? total / subtotal : 1;
  const lines = items.map(i => (i.vatRate ? vatIncluded(i.total, VAT_PERCENT[i.vatRate]) : null));
  const sum = items.reduce((s, i) => s + (i.vatRate ? vatIncluded(i.total * factor, VAT_PERCENT[i.vatRate]) : 0), 0);
  return { applies: true, lines, total: sum };
}
