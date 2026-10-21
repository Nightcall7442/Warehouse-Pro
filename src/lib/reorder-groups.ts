/**
 * «Дозаказ» по поставщикам: у кого что заказывать.
 *
 * Сервер даёт плоский список (warehouse.reorderSuggestions) с поставщиком у
 * каждой строки: из карточки товара или того, кто привёз последним. Экран
 * показывает его группами — одна группа станет одним заказом поставщику.
 * Строки без поставщика — отдельной группой в конце: поставщика для них
 * выбирает человек.
 */

export interface SupplierGroup<R> {
  /** "none" — без поставщика; иначе номер поставщика строкой. */
  key: string;
  supplierId: number | null;
  supplierName: string | null;
  rows: R[];
}

export function groupBySupplier<R extends { supplierId: number | null; supplierName: string | null }>(rows: R[]): SupplierGroup<R>[] {
  const groups = new Map<string, SupplierGroup<R>>();
  for (const r of rows) {
    const key = r.supplierId == null ? "none" : String(r.supplierId);
    let g = groups.get(key);
    if (!g) {
      g = { key, supplierId: r.supplierId, supplierName: r.supplierName, rows: [] };
      groups.set(key, g);
    }
    // Внутри группы — порядок сервера: сначала то, что кончится раньше.
    g.rows.push(r);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.supplierId == null) return 1;
    if (b.supplierId == null) return -1;
    return (a.supplierName ?? "").localeCompare(b.supplierName ?? "", "ru");
  });
}

/** Количество для заказа: до сотых (столько принимает заказ поставщику); не число или ≤ 0 — ничего. */
export function orderQuantity(raw: string): string | null {
  const n = Math.round(Number(raw.replace(",", ".")) * 100) / 100;
  return Number.isFinite(n) && n > 0 ? String(n) : null;
}
