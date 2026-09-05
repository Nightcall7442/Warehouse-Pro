/**
 * Единицы измерения — один список на всё приложение.
 *
 * Их было пять: своя таблица в форме товара, своя в заказах, своя в окне
 * приёмки, своя в панели заказа и своя в печатных документах. Списки разошлись:
 * `box` в трёх из них назывался «блок» — тем же словом, что и отдельная единица
 * `block`. То есть ящик и блок на разных экранах выглядели одинаково.
 *
 * В выгрузках Excel и вовсе печатался код из базы: «pcs», «box», «pack».
 *
 * Значения — те же, что принимает сервер (`z.enum` в api/product-router.ts и
 * `mysqlEnum` в db/schema.ts). Проверка их совпадения стоит тестом.
 */

export const UNITS = [
  { value: "kg",    ru: "кг",       uz: "kg",       shortRu: "кг",   shortUz: "kg" },
  { value: "l",     ru: "литр",     uz: "litr",     shortRu: "л",    shortUz: "l" },
  { value: "pcs",   ru: "штук",     uz: "dona",     shortRu: "шт",   shortUz: "dona" },
  { value: "box",   ru: "ящик",     uz: "quti",     shortRu: "ящ",   shortUz: "quti" },
  { value: "pack",  ru: "упаковка", uz: "pachka",   shortRu: "упак", shortUz: "pach" },
  { value: "m",     ru: "метр",     uz: "metr",     shortRu: "м",    shortUz: "m" },
  { value: "block", ru: "блок",     uz: "blok",     shortRu: "бл",   shortUz: "blok" },
] as const;

/** Единицы, которые принимает сервер. */
export type Unit = typeof UNITS[number]["value"];

/** Таблица по коду: там, где удобнее обращаться напрямую, а не функцией. */
export const UNIT_LABELS: Record<string, { ru: string; uz: string; shortRu: string; shortUz: string }> =
  Object.fromEntries(UNITS.map(u => [u.value, { ru: u.ru, uz: u.uz, shortRu: u.shortRu, shortUz: u.shortUz }]));

const BY_VALUE = new Map<string, (typeof UNITS)[number]>(UNITS.map(u => [u.value, u]));

/** Полное название: для выпадающих списков и карточек. */
export function unitLabel(unit: string | null | undefined, lang: string = "ru"): string {
  const u = BY_VALUE.get(unit ?? "pcs");
  if (!u) return unit ?? "шт";
  return lang === "uz" ? u.uz : u.ru;
}

/**
 * Короткое название: для таблиц, документов и выгрузок.
 *
 * Там, где рядом стоит число, «штук» и «упаковка» растягивают колонку и мешают
 * читать; «шт» и «упак» — нет.
 */
export function unitShort(unit: string | null | undefined, lang: string = "ru"): string {
  const u = BY_VALUE.get(unit ?? "pcs");
  if (!u) return unit ?? "шт";
  return lang === "uz" ? u.shortUz : u.shortRu;
}
