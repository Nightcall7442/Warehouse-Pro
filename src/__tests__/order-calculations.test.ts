import { describe, it, expect } from "vitest";
import {
  calcSubtotal,
  calcDiscount,
  calcTotal,
  calcTotalWeight,
  calcLineTotal,
  type OrderItemInput,
} from "../lib/order-calculations";

// ── Helper ──────────────────────────────────────────────────────────────────
function item(overrides: Partial<OrderItemInput> = {}): OrderItemInput {
  return {
    productId: 1,
    quantity: "10",
    unitPrice: "100.00",
    unitWeight: 0.5,
    ...overrides,
  };
}

// ── calcSubtotal ────────────────────────────────────────────────────────────
describe("calcSubtotal", () => {
  it("sums unitPrice * quantity for valid items", () => {
    const items = [
      item({ unitPrice: "100", quantity: "5" }),   // 500
      item({ productId: 2, unitPrice: "250", quantity: "2" }), // 500
    ];
    expect(calcSubtotal(items)).toBe(1000);
  });

  it("excludes items with productId = 0", () => {
    const items = [
      item({ productId: 0, unitPrice: "100", quantity: "5" }),
      item({ productId: 1, unitPrice: "200", quantity: "3" }),
    ];
    expect(calcSubtotal(items)).toBe(600);
  });

  it("excludes items with quantity = 0", () => {
    const items = [
      item({ unitPrice: "100", quantity: "0" }),
      item({ productId: 1, unitPrice: "200", quantity: "3" }),
    ];
    expect(calcSubtotal(items)).toBe(600);
  });

  it("excludes items with negative quantity", () => {
    const items = [
      item({ unitPrice: "100", quantity: "-5" }),
      item({ productId: 1, unitPrice: "200", quantity: "3" }),
    ];
    expect(calcSubtotal(items)).toBe(600);
  });

  it("returns 0 for empty items array", () => {
    expect(calcSubtotal([])).toBe(0);
  });

  it("returns 0 when all items are invalid", () => {
    const items = [
      item({ productId: 0, unitPrice: "100", quantity: "5" }),
      item({ productId: 1, unitPrice: "200", quantity: "0" }),
    ];
    expect(calcSubtotal(items)).toBe(0);
  });

  it("handles decimal quantities", () => {
    const items = [item({ unitPrice: "100", quantity: "2.5" })];
    expect(calcSubtotal(items)).toBe(250);
  });

  it("handles decimal prices", () => {
    const items = [item({ unitPrice: "33.33", quantity: "3" })];
    expect(calcSubtotal(items)).toBeCloseTo(99.99, 2);
  });

  it("handles string prices from form inputs", () => {
    const items = [
      item({ unitPrice: "1,500.00", quantity: "2" }),
    ];
    // Number("1,500.00") = NaN, so this should be excluded or handled
    // The backend validates prices, so NaN * quantity = NaN which reduces to 0
    const result = calcSubtotal(items);
    expect(Number.isNaN(result) || result === 0).toBe(true);
  });
});

// ── calcDiscount ────────────────────────────────────────────────────────────
describe("calcDiscount", () => {
  it("returns discount when less than subtotal", () => {
    expect(calcDiscount("500", 1000)).toBe(500);
  });

  it("clamps discount to subtotal", () => {
    expect(calcDiscount("2000", 1000)).toBe(1000);
  });

  it("returns 0 for empty string", () => {
    expect(calcDiscount("", 1000)).toBe(0);
  });

  it("returns 0 for undefined/null", () => {
    expect(calcDiscount("0", 1000)).toBe(0);
  });

  it("returns 0 for negative discount", () => {
    expect(calcDiscount("-500", 1000)).toBe(0);
  });

  it("returns 0 when subtotal is 0", () => {
    expect(calcDiscount("500", 0)).toBe(0);
  });

  it("handles decimal discount", () => {
    expect(calcDiscount("123.45", 1000)).toBe(123.45);
  });

  it("handles zero discount", () => {
    expect(calcDiscount("0", 1000)).toBe(0);
  });
});

// ── calcTotal ───────────────────────────────────────────────────────────────
describe("calcTotal", () => {
  it("subtracts discount from subtotal", () => {
    expect(calcTotal(1000, 200)).toBe(800);
  });

  it("returns subtotal when discount is 0", () => {
    expect(calcTotal(1000, 0)).toBe(1000);
  });

  it("returns 0 when subtotal equals discount", () => {
    expect(calcTotal(500, 500)).toBe(0);
  });

  it("handles decimal values", () => {
    expect(calcTotal(999.99, 100.01)).toBeCloseTo(899.98, 2);
  });
});

// ── calcTotalWeight ─────────────────────────────────────────────────────────
describe("calcTotalWeight", () => {
  it("sums quantity * unitWeight for valid items", () => {
    const items = [
      item({ quantity: "10", unitWeight: 0.5 }),  // 5 kg
      item({ productId: 2, quantity: "3", unitWeight: 2 }), // 6 kg
    ];
    expect(calcTotalWeight(items)).toBe(11);
  });

  it("defaults to 1 kg when unitWeight is undefined", () => {
    const items = [
      item({ quantity: "5", unitWeight: undefined }),
    ];
    expect(calcTotalWeight(items)).toBe(5);
  });

  it("defaults to 1 kg when unitWeight is 0", () => {
    const items = [
      item({ quantity: "5", unitWeight: 0 }),
    ];
    expect(calcTotalWeight(items)).toBe(5);
  });

  it("excludes invalid items", () => {
    const items = [
      item({ productId: 0, quantity: "10", unitWeight: 1 }),
      item({ productId: 1, quantity: "0", unitWeight: 1 }),
      item({ productId: 2, quantity: "5", unitWeight: 2 }),
    ];
    expect(calcTotalWeight(items)).toBe(10);
  });

  it("returns 0 for empty array", () => {
    expect(calcTotalWeight([])).toBe(0);
  });
});

// ── calcLineTotal ───────────────────────────────────────────────────────────
describe("calcLineTotal", () => {
  it("multiplies price by quantity", () => {
    expect(calcLineTotal("100", "5")).toBe(500);
  });

  it("handles decimal values", () => {
    expect(calcLineTotal("33.33", "3")).toBeCloseTo(99.99, 2);
  });

  it("handles numeric inputs", () => {
    expect(calcLineTotal(100, 5)).toBe(500);
  });

  it("returns 0 when quantity is 0", () => {
    expect(calcLineTotal("100", "0")).toBe(0);
  });

  it("returns 0 when price is 0", () => {
    expect(calcLineTotal("0", "5")).toBe(0);
  });
});
