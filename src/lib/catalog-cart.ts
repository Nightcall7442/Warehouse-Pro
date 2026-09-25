import { useCallback, useSyncExternalStore } from "react";
import type { OrderItem } from "@/components/orders/types";

/**
 * Корзина каталога — как в мобилке v8 (Warehouse-Pro-Mobile, src/store/cart):
 * агент у прилавка ставит товары кнопкой на карточке, внизу плашка «В заказе:
 * N товаров · сумма · Оформить», и «Оформить» открывает мастер заказа уже с
 * этими товарами — магазин выбирается первым шагом, как обычно.
 *
 * Хранится у браузера и по владельцу — по тем же причинам, что черновик
 * заказа (pages/NewOrder.draft.ts): перезагрузка не должна стирать набор, а
 * общий на складе компьютер не должен показывать чужой.
 *
 * Цена здесь — для витрины. Сумму заказа считает сервер (order.create
 * принимает только товар и количество), с ценами магазина.
 */
export type CartLine = {
  productId: number;
  productName: string;
  unitPrice: string;
  quantity: number;
  available: string;
  unit: string;
  unitWeight: number;
};

const KEY = "warehouse_pro_catalog_cart";
const keyFor = (ownerId: number) => `${KEY}:${ownerId}`;
const listeners = new Set<() => void>();
const cache = new Map<number, { raw: string | null; lines: CartLine[] }>();

function read(ownerId: number): CartLine[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem(keyFor(ownerId)); } catch { /* хранилище недоступно — корзина пуста */ }
  const hit = cache.get(ownerId);
  if (hit && hit.raw === raw) return hit.lines;
  let lines: CartLine[] = [];
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) lines = parsed.filter(l => l && typeof l.productId === "number" && Number(l.quantity) > 0);
  } catch { /* запись от другой версии — начинаем с пустой */ }
  cache.set(ownerId, { raw, lines });
  return lines;
}

function write(ownerId: number, lines: CartLine[]) {
  try {
    if (lines.length) localStorage.setItem(keyFor(ownerId), JSON.stringify(lines));
    else localStorage.removeItem(keyFor(ownerId));
  } catch { /* не сохранилось — не беда */ }
  listeners.forEach(l => l());
}

export function loadCart(ownerId: number): CartLine[] {
  return read(ownerId);
}

export function clearCart(ownerId: number): void {
  write(ownerId, []);
}

/** Прибавить (или убавить) единицы товара. До нуля — строка уходит. */
export function addToCart(ownerId: number, product: Omit<CartLine, "quantity">, delta: number): void {
  const lines = read(ownerId).slice();
  const i = lines.findIndex(l => l.productId === product.productId);
  const next = (i >= 0 ? lines[i].quantity : 0) + delta;
  if (i >= 0 && next <= 0) lines.splice(i, 1);
  else if (i >= 0) lines[i] = { ...lines[i], quantity: next };
  else if (next > 0) lines.push({ ...product, quantity: next });
  write(ownerId, lines);
}

/** Строки корзины как позиции мастера заказа. */
export function cartToItems(lines: CartLine[]): OrderItem[] {
  return lines.map(l => ({
    productId: l.productId, productName: l.productName, unitPrice: l.unitPrice,
    quantity: String(l.quantity), available: l.available, unit: l.unit, unitWeight: l.unitWeight,
  }));
}

/** Корзина владельца с подпиской: плашка и карточки перерисовываются сами. */
export function useCatalogCart(ownerId: number | undefined) {
  const subscribe = useCallback((cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, []);
  const lines = useSyncExternalStore(subscribe, () => (ownerId ? read(ownerId) : EMPTY), () => EMPTY);
  const count = lines.reduce((s, l) => s + l.quantity, 0);
  const total = lines.reduce((s, l) => s + l.quantity * Number(l.unitPrice || 0), 0);
  return { lines, count, total, positions: lines.length };
}
const EMPTY: CartLine[] = [];
