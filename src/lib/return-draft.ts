/**
 * Окно «Оформить возврат» (components/returns/WebReturn.tsx) — без React:
 * что уйдёт на сервер, на какую сумму и сколько можно вписать.
 */
import { normalizeDecimalInput } from "@/lib/decimal-input";

/** Возврат в очереди «Возвраты», раскрытый. Страница открыта только офису. */
export const returnLink = (id: number) => `/returns?open=${id}`;

/** Строка окна: что было в заказе и сколько по ней ещё можно вернуть. */
export interface DraftLine {
  productId: number;
  name: string;
  unit: string | null;
  unitPrice: number;
  left: number;
}

/**
 * Что уйдёт в returns.create и на какую сумму.
 *
 * Пустые и нулевые строки не уходят. Сумма — целыми: деньги в продукте без
 * дробей, и итог в окне обязан совпасть с тем, что покажет «Возвраты».
 *
 * Цена строки нужна только проверке входа (положительное число): для возврата
 * по заказу сервер всё равно ставит цену заказа. У бесплатной строки (цена 0)
 * уходит копейка — в документ ляжет 0 из заказа, и вернуть такую строку можно.
 */
export function returnDraft(lines: DraftLine[], qty: Record<number, string>) {
  const items = lines
    .map(l => ({ l, q: Number(qty[l.productId] ?? 0) }))
    .filter(({ q }) => Number.isFinite(q) && q > 0)
    .map(({ l, q }) => ({ productId: l.productId, quantity: q, unitPrice: l.unitPrice > 0 ? l.unitPrice : 0.01, price: l.unitPrice }));
  const total = Math.round(items.reduce((s, i) => s + i.price * i.quantity, 0));
  return { items: items.map(({ productId, quantity, unitPrice }) => ({ productId, quantity, unitPrice })), total };
}

/** Вписанное — не больше остатка: окно не даёт набрать лишнее. */
export function clampQty(raw: string, left: number): string {
  const v = normalizeDecimalInput(raw);
  if (v === "" || v === ".") return v;
  return Number(v) > left ? String(left) : v;
}
