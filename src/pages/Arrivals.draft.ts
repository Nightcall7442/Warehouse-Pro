/**
 * Черновик набираемого прихода.
 *
 * Форма прихода — окно поверх страницы, и всё набранное жило в его памяти.
 * Клик мимо окна, случайный переход по ссылке, перезагрузка (раньше её
 * делал сам service worker при каждой выкладке) — и сорок строк с партиями
 * и сроками пропадали. Теперь черновик лежит у браузера и восстанавливается
 * при следующем открытии формы; стирается, когда приход сохранён.
 *
 * Владелец у записи, как у черновика заказа: компьютер на складе общий.
 */
export type ArrivalDraft = {
  form: { truckId: string; driverName: string; driverPhone: string; arrivalDate: string; fuelCost: string; tollCost: string; otherCost: string; notes: string };
  supplierMode: "none" | "existing" | "new";
  supplierId: number;
  newSupplierName: string;
  supplyAmount: string;
  supplyCurrency: "UZS" | "USD";
  supplyRate: string;
  supplyDueDate: string;
  items: Array<{ productId: number; quantity: string; costPrice: string; sellingPrice: string; condition: string; unit: string; unitWeight: number; batchNumber: string; expiresAt: string }>;
};

const KEY = "warehouse_pro_arrival_draft";
const keyFor = (ownerId: number) => `${KEY}:${ownerId}`;

/** Есть ли что терять: хотя бы одна строка с товаром или заполненная шапка. */
export function arrivalDraftHasWork(d: ArrivalDraft): boolean {
  return d.items.some(i => i.productId > 0 || i.quantity.trim() !== "")
    || d.form.truckId.trim() !== "" || d.form.driverName.trim() !== "" || d.form.notes.trim() !== ""
    || d.supplierMode !== "none";
}

export function saveArrivalDraft(ownerId: number, draft: ArrivalDraft): void {
  try { localStorage.setItem(keyFor(ownerId), JSON.stringify(draft)); } catch { /* черновик — подстраховка, не работа */ }
}

export function loadArrivalDraft(ownerId: number): ArrivalDraft | null {
  try {
    const raw = localStorage.getItem(keyFor(ownerId));
    if (!raw) return null;
    const d = JSON.parse(raw) as ArrivalDraft;
    if (!d || !d.form || !Array.isArray(d.items)) return null;
    return d;
  } catch {
    return null;
  }
}

export function clearArrivalDraft(ownerId: number): void {
  try { localStorage.removeItem(keyFor(ownerId)); } catch { /* пусто */ }
}
