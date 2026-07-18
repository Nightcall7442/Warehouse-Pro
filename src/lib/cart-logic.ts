/**
 * Pure cart logic functions — extracted from ProductSelector for testability.
 */

export interface CartItem {
  productId: number;
  productName: string;
  unitPrice: string;
  quantity: string;
  available: string;
  unit: string;
  unitWeight: number;
}

/**
 * Add a product to cart. If already exists, increment quantity.
 */
export function addToCart(
  items: CartItem[],
  product: { id: number; name: string; unitPrice: string; available?: string; unit?: string; unitWeight?: number },
  qty: number = 1,
): CartItem[] {
  const existing = items.findIndex(i => i.productId === product.id);
  if (existing >= 0) {
    const next = [...items];
    next[existing] = { ...next[existing], quantity: String(Number(next[existing].quantity) + qty) };
    return next;
  }
  return [...items, {
    productId: product.id,
    productName: product.name,
    unitPrice: product.unitPrice,
    quantity: String(qty),
    available: product.available ?? "0",
    unit: product.unit ?? "pcs",
    unitWeight: product.unitWeight ?? 0,
  }];
}

/**
 * Update quantity by delta. Removes item if quantity reaches 0.
 */
export function updateQuantity(items: CartItem[], productId: number, delta: number): CartItem[] {
  const idx = items.findIndex(i => i.productId === productId);
  if (idx === -1) return items;
  const newQty = Math.max(0, Number(items[idx].quantity) + delta);
  if (newQty === 0) {
    return items.filter(i => i.productId !== productId);
  }
  const next = [...items];
  next[idx] = { ...next[idx], quantity: String(newQty) };
  return next;
}

/**
 * Set quantity directly. Removes item if quantity is 0.
 */
export function setQuantityDirect(items: CartItem[], productId: number, value: string): CartItem[] {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0) return items;
  if (num === 0) {
    return items.filter(i => i.productId !== productId);
  }
  const idx = items.findIndex(i => i.productId === productId);
  if (idx === -1) return items;
  const next = [...items];
  next[idx] = { ...next[idx], quantity: String(num) };
  return next;
}

/**
 * Remove an item from cart.
 */
export function removeItem(items: CartItem[], productId: number): CartItem[] {
  return items.filter(i => i.productId !== productId);
}

/**
 * Calculate cart subtotal.
 */
export function calcCartSubtotal(items: CartItem[]): number {
  return items
    .filter(i => i.productId > 0 && Number(i.quantity) > 0)
    .reduce((sum, i) => sum + Number(i.unitPrice) * Number(i.quantity), 0);
}

/**
 * Calculate total weight in kg.
 */
export function calcCartWeight(items: CartItem[]): number {
  return items
    .filter(i => i.productId > 0 && Number(i.quantity) > 0)
    .reduce((sum, i) => sum + Number(i.quantity) * ((i.unitWeight ?? 0) || 1), 0);
}
