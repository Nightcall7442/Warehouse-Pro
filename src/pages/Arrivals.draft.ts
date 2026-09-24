import type { SheetRow } from "@/lib/arrival-sheet";

/**
 * Черновик набираемого прихода.
 *
 * Новый приход живёт на своей странице, но набранное — всё ещё в памяти
 * вкладки: случайный переход по ссылке или перезагрузка (раньше её делал
 * сам service worker при каждой выкладке) — и сорок строк с партиями и
 * сроками пропадали бы. Черновик лежит у браузера и восстанавливается при
 * следующем открытии; стирается, когда приход сохранён.
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
  rows: SheetRow[];
};

const KEY = "warehouse_pro_arrival_draft";
const keyFor = (ownerId: number) => `${KEY}:${ownerId}`;

/** Есть ли что терять: хотя бы одна строка или заполненная шапка. */
export function arrivalDraftHasWork(d: ArrivalDraft): boolean {
  return d.rows.length > 0
    || d.form.truckId.trim() !== "" || d.form.driverName.trim() !== "" || d.form.notes.trim() !== ""
    || d.supplierMode !== "none";
}

export function saveArrivalDraft(ownerId: number, draft: ArrivalDraft): void {
  try { localStorage.setItem(keyFor(ownerId), JSON.stringify(draft)); } catch { /* черновик — подстраховка, не работа */ }
}

type LegacyItem = { productId: number; quantity?: string; costPrice?: string; sellingPrice?: string; unit?: string; unitWeight?: number; batchNumber?: string; expiresAt?: string; expected?: string };

export function loadArrivalDraft(ownerId: number): ArrivalDraft | null {
  try {
    const raw = localStorage.getItem(keyFor(ownerId));
    if (!raw) return null;
    const d = JSON.parse(raw) as ArrivalDraft & { items?: LegacyItem[] };
    if (!d || !d.form) return null;
    if (Array.isArray(d.rows)) return d;
    /*
      Черновик прежней формы (карточка на товар): строки без названий.
      Названия подставит экран из каталога — терять набранное из-за смены
      экрана нельзя.
    */
    if (!Array.isArray(d.items)) return null;
    const rows: SheetRow[] = d.items.filter(i => i.productId > 0).map(i => ({
      productId: i.productId, name: "", code: "", unit: i.unit ?? "pcs", unitWeight: i.unitWeight ?? 0, packSize: 0, packLabel: "",
      expected: i.expected ?? "", quantity: i.quantity ?? "", costPrice: i.costPrice ?? "", sellingPrice: i.sellingPrice ?? "",
      batchNumber: i.batchNumber ?? "", expiresAt: i.expiresAt ?? "",
    }));
    const { items: _legacy, ...rest } = d;
    void _legacy;
    return { ...rest, rows };
  } catch {
    return null;
  }
}

export function clearArrivalDraft(ownerId: number): void {
  try { localStorage.removeItem(keyFor(ownerId)); } catch { /* пусто */ }
}
