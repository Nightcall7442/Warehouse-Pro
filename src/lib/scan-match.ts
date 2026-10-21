/**
 * Скан → товар: одно правило на все экраны со сканером.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Сравнение «штрих-код или код» было написано по месту семь раз — приход,
 * инвентаризация, заказ (дважды), быстрый заказ, выбор товаров пачкой,
 * страница «Штрих-коды» — и копии уже разошлись: «Штрих-коды» сравнивала с
 * учётом регистра, остальные без. Дополнительные штрих-коды товара
 * (product_barcodes) пришлось бы вписывать в каждую копию.
 *
 * ── Правило ─────────────────────────────────────────────────────────────────
 *
 * Код сравнивается целиком, без регистра и пробелов по краям — как на
 * сервере (колонка в регистронезависимой сортировке). Порядок тот же, что у
 * product.findByBarcode: сначала совпадение по основному штрих-коду, затем
 * по дополнительному, затем по коду товара. Без порядка один и тот же скан
 * клал в заказ то один товар, то другой — смотря кто стоял выше в списке.
 */

/** То, по чему товар находится сканом. */
export type Scannable = {
  code?: string | null;
  barcode?: string | null;
  /** Дополнительные штрих-коды; старый ответ сервера и копия каталога без них — пусто. */
  barcodes?: readonly string[] | null;
};

/** Скан в той форме, в какой его сравнивать. */
export function normScan(raw: string): string {
  return raw.trim().toLowerCase();
}

const same = (value: string | null | undefined, norm: string) => !!norm && (value ?? "").trim().toLowerCase() === norm;

/** Совпадение по основному или дополнительному штрих-коду. */
export function matchesBarcode(p: Scannable, norm: string): boolean {
  return same(p.barcode, norm) || (p.barcodes ?? []).some(b => same(b, norm));
}

/**
 * Товар по скану из списка. view — как достать из строки код и штрих-коды,
 * если они названы иначе (строка инвентаризации: productCode).
 */
export function findScanned<T>(list: readonly T[] | null | undefined, raw: string, view: (item: T) => Scannable = item => item as Scannable): T | undefined {
  const norm = normScan(raw);
  if (!norm || !list) return undefined;
  return list.find(p => same(view(p).barcode, norm))
    ?? list.find(p => (view(p).barcodes ?? []).some(b => same(b, norm)))
    ?? list.find(p => same(view(p).code, norm));
}
