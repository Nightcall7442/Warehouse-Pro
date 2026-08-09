import { describe, it, expect } from "vitest";
import {
  addToCart,
  updateQuantity,
  setQuantityDirect,
  removeItem,
  calcCartSubtotal,
  calcCartWeight,
  type CartItem,
} from "../lib/cart-logic";

// ── Helper ──────────────────────────────────────────────────────────────────
function item(overrides: Partial<CartItem> = {}): CartItem {
  return {
    productId: 1,
    productName: "Test Product",
    unitPrice: "100",
    quantity: "5",
    available: "50",
    unit: "pcs",
    unitWeight: 0.5,
    ...overrides,
  };
}

const product = {
  id: 2,
  name: "New Product",
  unitPrice: "250",
  available: "30",
  unit: "kg",
  unitWeight: 1.2,
};

// ── addToCart ───────────────────────────────────────────────────────────────
describe("addToCart", () => {
  it("adds new item to empty cart", () => {
    const result = addToCart([], product, 3);
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe(2);
    expect(result[0].quantity).toBe("3");
  });

  it("adds new item to cart with existing items", () => {
    const items = [item({ productId: 1 })];
    const result = addToCart(items, product, 2);
    expect(result).toHaveLength(2);
    expect(result[1].productId).toBe(2);
  });

  it("increments quantity if product already in cart", () => {
    const items = [item({ productId: 2, quantity: "3" })];
    const result = addToCart(items, product, 2);
    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe("5");
  });

  it("defaults to qty=1 if not specified", () => {
    const result = addToCart([], product);
    expect(result[0].quantity).toBe("1");
  });

  it("preserves other items in cart", () => {
    const items = [
      item({ productId: 1, quantity: "3" }),
      item({ productId: 3, quantity: "7" }),
    ];
    const result = addToCart(items, product, 1);
    expect(result).toHaveLength(3);
    expect(result[0].quantity).toBe("3"); // original item unchanged
    expect(result[2].productId).toBe(2); // new item added
    expect(result[2].quantity).toBe("1"); // new item quantity
  });
});

// ── updateQuantity ──────────────────────────────────────────────────────────
describe("updateQuantity", () => {
  it("increments quantity", () => {
    const items = [item({ productId: 1, quantity: "5" })];
    const result = updateQuantity(items, 1, 1);
    expect(result[0].quantity).toBe("6");
  });

  it("decrements quantity", () => {
    const items = [item({ productId: 1, quantity: "5" })];
    const result = updateQuantity(items, 1, -1);
    expect(result[0].quantity).toBe("4");
  });

  it("removes item when quantity reaches 0", () => {
    const items = [item({ productId: 1, quantity: "1" })];
    const result = updateQuantity(items, 1, -1);
    expect(result).toHaveLength(0);
  });

  it("does not go below 0", () => {
    const items = [item({ productId: 1, quantity: "1" })];
    const result = updateQuantity(items, 1, -5);
    expect(result).toHaveLength(0);
  });

  it("returns same array if product not found", () => {
    const items = [item({ productId: 1 })];
    const result = updateQuantity(items, 999, 1);
    expect(result).toBe(items);
  });

  it("only affects the target product", () => {
    const items = [
      item({ productId: 1, quantity: "5" }),
      item({ productId: 2, quantity: "3" }),
    ];
    const result = updateQuantity(items, 1, 2);
    expect(result[0].quantity).toBe("7");
    expect(result[1].quantity).toBe("3");
  });
});

// ── setQuantityDirect ───────────────────────────────────────────────────────
describe("setQuantityDirect", () => {
  it("sets quantity to specific value", () => {
    const items = [item({ productId: 1, quantity: "5" })];
    const result = setQuantityDirect(items, 1, "10");
    expect(result[0].quantity).toBe("10");
  });

  it("removes item when set to 0", () => {
    const items = [item({ productId: 1, quantity: "5" })];
    const result = setQuantityDirect(items, 1, "0");
    expect(result).toHaveLength(0);
  });

  it("ignores non-numeric input", () => {
    const items = [item({ productId: 1, quantity: "5" })];
    const result = setQuantityDirect(items, 1, "abc");
    expect(result).toBe(items);
  });

  it("ignores negative input", () => {
    const items = [item({ productId: 1, quantity: "5" })];
    const result = setQuantityDirect(items, 1, "-5");
    expect(result).toBe(items);
  });

  it("returns same array if product not found", () => {
    const items = [item({ productId: 1 })];
    const result = setQuantityDirect(items, 999, "10");
    expect(result).toBe(items);
  });
});

// ── removeItem ──────────────────────────────────────────────────────────────
describe("removeItem", () => {
  it("removes the specified item", () => {
    const items = [
      item({ productId: 1 }),
      item({ productId: 2 }),
      item({ productId: 3 }),
    ];
    const result = removeItem(items, 2);
    expect(result).toHaveLength(2);
    expect(result.find(i => i.productId === 2)).toBeUndefined();
  });

  it("returns same array if product not found", () => {
    const items = [item({ productId: 1 })];
    const result = removeItem(items, 999);
    expect(result).toHaveLength(1);
  });

  it("handles empty cart", () => {
    const result = removeItem([], 1);
    expect(result).toHaveLength(0);
  });
});

// ── calcCartSubtotal ────────────────────────────────────────────────────────
describe("calcCartSubtotal", () => {
  it("sums unitPrice * quantity for all items", () => {
    const items = [
      item({ unitPrice: "100", quantity: "5" }),   // 500
      item({ productId: 2, unitPrice: "250", quantity: "2" }), // 500
    ];
    expect(calcCartSubtotal(items)).toBe(1000);
  });

  it("excludes items with quantity 0", () => {
    const items = [
      item({ unitPrice: "100", quantity: "0" }),
      item({ productId: 2, unitPrice: "200", quantity: "3" }),
    ];
    expect(calcCartSubtotal(items)).toBe(600);
  });

  it("returns 0 for empty cart", () => {
    expect(calcCartSubtotal([])).toBe(0);
  });
});

// ── calcCartWeight ──────────────────────────────────────────────────────────
describe("calcCartWeight", () => {
  it("sums quantity * unitWeight", () => {
    const items = [
      item({ quantity: "10", unitWeight: 0.5 }),  // 5 kg
      item({ productId: 2, quantity: "3", unitWeight: 2 }), // 6 kg
    ];
    expect(calcCartWeight(items)).toBe(11);
  });

  it("defaults to 1 kg when unitWeight is 0", () => {
    const items = [item({ quantity: "5", unitWeight: 0 })];
    expect(calcCartWeight(items)).toBe(5);
  });

  it("returns 0 for empty cart", () => {
    expect(calcCartWeight([])).toBe(0);
  });
});
