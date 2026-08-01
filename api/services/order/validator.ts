import type { OrderLine, OrderStatus } from "./types";

/**
 * Business rules that are decisions, not queries: what may change, what a total
 * comes to, and whether the warehouse can cover a line. Everything here is pure,
 * so the rules can be exercised without a database.
 */

/** Stock is only committed to an order while it is new or processing. */
export function holdsStock(status: string): boolean {
  return status === "new" || status === "processing";
}

const VALID_TRANSITIONS: Record<string, OrderStatus[]> = {
  new: ["processing", "completed", "cancelled"],
  processing: ["completed", "cancelled"],
};

/** Whether a status change is allowed at all. `completed`/`cancelled` are terminal. */
export function canTransition(from: string, to: OrderStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: string, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Невозможно перевести из "${from}" в "${to}"`);
  }
}

export function assertDiscountNotNegative(discount: number): void {
  if (discount < 0) throw new Error("Скидка не может быть отрицательной");
}

export function assertDiscountWithinSubtotal(discount: number, subtotal: number): void {
  if (discount > subtotal) {
    throw new Error(`Скидка (${discount}) не может превышать сумму заказа (${subtotal})`);
  }
}

/** The message differs from the create path's — kept as-is, it is user-visible. */
export function assertUpdatedDiscountWithinSubtotal(discount: number, subtotal: number): void {
  if (discount > subtotal) throw new Error("Скидка не может превышать сумму заказа");
}

/**
 * Prices come from the database, never from the client: a client-supplied unit
 * price is a discount anyone can grant themselves.
 */
export function priceOrderLines(
  items: OrderLine[],
  priceMap: Map<number, string>,
): { subtotal: number } {
  for (const item of items) {
    if (!priceMap.has(item.productId)) {
      throw new Error(`Товар #${item.productId} не найден или неактивен`);
    }
  }

  let subtotal = 0;
  for (const item of items) {
    const unitPrice = Number(priceMap.get(item.productId)!);
    subtotal += unitPrice * Number(item.quantity);
  }
  return { subtotal };
}

/** Reservation check against the `available` column of the reserving warehouse. */
export function assertAvailableForReservation(
  items: OrderLine[],
  availableByProduct: Map<number, number>,
): void {
  for (const item of items) {
    const available = availableByProduct.get(item.productId) ?? 0;
    if (available < 0) {
      throw new Error(`Некорректный остаток товара на складе (доступно: ${available}). Обратитесь к администратору.`);
    }
    if (available < Number(item.quantity)) {
      throw new Error(`Недостаточно товара на складе (доступно: ${available}, запрошено: ${item.quantity})`);
    }
  }
}

/** Deduction check against `current_stock` — returns the lines that cannot be covered. */
export function insufficientForDeduction(
  items: OrderLine[],
  currentByProduct: Map<number, number>,
): OrderLine[] {
  return items.filter(item => {
    const current = currentByProduct.get(item.productId);
    return current === undefined || current < Number(item.quantity);
  });
}

export function assertSufficientForDeduction(items: OrderLine[], currentByProduct: Map<number, number>): void {
  const insufficient = insufficientForDeduction(items, currentByProduct);
  if (insufficient.length > 0) {
    throw new Error(`Недостаточно товара на складе: ${insufficient.map(i => `${i.productId}`).join(", ")}`);
  }
}

export function assertRestorable(order: { deletedAt: Date | null }): void {
  if (!order.deletedAt) throw new Error("Заказ не удалён");
}

export function assertCancellable(status: string): void {
  if (status !== "new") throw new Error("Можно отменить только новые заказы");
}
