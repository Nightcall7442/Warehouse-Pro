/**
 * Pure order calculation functions — extracted for testability.
 * These mirror the logic in OrderReview.tsx but without React dependencies.
 */

export interface OrderItemInput {
  productId: number;
  quantity: string | number;
  unitPrice: string | number;
  unitWeight?: number;
}

/**
 * Calculate subtotal from valid items (productId > 0 && quantity > 0).
 * Items with invalid data are excluded from the calculation.
 */
export function calcSubtotal(items: OrderItemInput[]): number {
  return items
    .filter(i => i.productId > 0 && Number(i.quantity) > 0)
    .reduce((sum, i) => sum + Number(i.unitPrice) * Number(i.quantity), 0);
}

/**
 * Clamp discount to [0, subtotal]. Returns 0 for negative values.
 */
export function calcDiscount(discount: string | number, subtotal: number): number {
  const d = Math.max(0, Number(discount || 0));
  return Math.min(d, subtotal);
}

/**
 * Final total = subtotal - discount (discount is already clamped).
 */
export function calcTotal(subtotal: number, discount: number): number {
  return subtotal - discount;
}

/**
 * Total weight in kg. Falls back to 1 kg per item if unitWeight is not set.
 */
export function calcTotalWeight(items: OrderItemInput[]): number {
  return items
    .filter(i => i.productId > 0 && Number(i.quantity) > 0)
    .reduce((sum, i) => sum + Number(i.quantity) * ((i.unitWeight ?? 0) || 1), 0);
}

/**
 * Line total for a single item.
 */
export function calcLineTotal(unitPrice: string | number, quantity: string | number): number {
  return Number(unitPrice) * Number(quantity);
}
