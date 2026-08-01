import { describe, it, expect } from "vitest";
import {
  holdsStock,
  canTransition,
  assertTransition,
  assertDiscountNotNegative,
  assertDiscountWithinSubtotal,
  assertUpdatedDiscountWithinSubtotal,
  priceOrderLines,
  assertAvailableForReservation,
  insufficientForDeduction,
  assertSufficientForDeduction,
  assertRestorable,
  assertCancellable,
} from "./validator";

/**
 * The order rules, exercised without a database. Before P1.1 these decisions were
 * inlined in a 700-line service and only reachable through a mocked query builder.
 */

describe("holdsStock", () => {
  it("is true exactly while stock is committed to the order", () => {
    expect(holdsStock("new")).toBe(true);
    expect(holdsStock("processing")).toBe(true);
    expect(holdsStock("completed")).toBe(false);
    expect(holdsStock("cancelled")).toBe(false);
    expect(holdsStock("whatever")).toBe(false);
  });
});

describe("status transitions", () => {
  it("allows the forward moves", () => {
    expect(canTransition("new", "processing")).toBe(true);
    expect(canTransition("new", "completed")).toBe(true);
    expect(canTransition("new", "cancelled")).toBe(true);
    expect(canTransition("processing", "completed")).toBe(true);
    expect(canTransition("processing", "cancelled")).toBe(true);
  });

  it("treats completed and cancelled as terminal", () => {
    expect(canTransition("completed", "processing")).toBe(false);
    expect(canTransition("completed", "cancelled")).toBe(false);
    expect(canTransition("cancelled", "new")).toBe(false);
    expect(canTransition("cancelled", "completed")).toBe(false);
  });

  it("rejects moving backwards and self-transitions", () => {
    expect(canTransition("processing", "new")).toBe(false);
    expect(canTransition("new", "new")).toBe(false);
  });

  it("names both statuses when it throws", () => {
    expect(() => assertTransition("completed", "processing"))
      .toThrow('Невозможно перевести из "completed" в "processing"');
  });
});

describe("discount rules", () => {
  it("rejects a negative discount", () => {
    expect(() => assertDiscountNotNegative(-1)).toThrow("Скидка не может быть отрицательной");
    expect(() => assertDiscountNotNegative(0)).not.toThrow();
  });

  it("rejects a discount above the subtotal, and allows one equal to it", () => {
    expect(() => assertDiscountWithinSubtotal(101, 100)).toThrow(/не может превышать сумму заказа/);
    expect(() => assertDiscountWithinSubtotal(100, 100)).not.toThrow();
    expect(() => assertUpdatedDiscountWithinSubtotal(101, 100)).toThrow("Скидка не может превышать сумму заказа");
  });
});

describe("priceOrderLines", () => {
  const prices = new Map([[1, "10.00"], [2, "2.50"]]);

  it("totals server-side prices, never client-supplied ones", () => {
    const { subtotal } = priceOrderLines([
      { productId: 1, quantity: "3" },
      { productId: 2, quantity: "2" },
    ], prices);
    expect(subtotal).toBe(35);
  });

  it("handles fractional quantities", () => {
    expect(priceOrderLines([{ productId: 2, quantity: "1.5" }], prices).subtotal).toBe(3.75);
  });

  it("rejects a product that is missing or inactive", () => {
    expect(() => priceOrderLines([{ productId: 99, quantity: "1" }], prices))
      .toThrow("Товар #99 не найден или неактивен");
  });

  it("totals an empty order to zero", () => {
    expect(priceOrderLines([], prices).subtotal).toBe(0);
  });
});

describe("reservation checks", () => {
  it("passes when availability covers every line", () => {
    expect(() => assertAvailableForReservation(
      [{ productId: 1, quantity: "5" }],
      new Map([[1, 5]]),
    )).not.toThrow();
  });

  it("reports how much was available versus requested", () => {
    expect(() => assertAvailableForReservation(
      [{ productId: 1, quantity: "6" }],
      new Map([[1, 5]]),
    )).toThrow("Недостаточно товара на складе (доступно: 5, запрошено: 6)");
  });

  it("treats a product with no stock row as zero available", () => {
    expect(() => assertAvailableForReservation(
      [{ productId: 7, quantity: "1" }],
      new Map(),
    )).toThrow(/доступно: 0/);
  });

  it("flags a negative balance as data corruption rather than a shortage", () => {
    expect(() => assertAvailableForReservation(
      [{ productId: 1, quantity: "1" }],
      new Map([[1, -3]]),
    )).toThrow(/Некорректный остаток товара/);
  });
});

describe("deduction checks", () => {
  it("lists the lines the warehouse cannot cover", () => {
    const short = insufficientForDeduction(
      [{ productId: 1, quantity: "2" }, { productId: 2, quantity: "1" }, { productId: 3, quantity: "1" }],
      new Map([[1, 1], [2, 5]]),
    );
    expect(short.map(l => l.productId)).toEqual([1, 3]);
  });

  it("names the products in the error", () => {
    expect(() => assertSufficientForDeduction(
      [{ productId: 4, quantity: "1" }],
      new Map([[4, 0]]),
    )).toThrow("Недостаточно товара на складе: 4");
  });

  it("passes when on-hand exactly covers the line", () => {
    expect(() => assertSufficientForDeduction(
      [{ productId: 1, quantity: "3" }],
      new Map([[1, 3]]),
    )).not.toThrow();
  });
});

describe("lifecycle guards", () => {
  it("only cancels new orders", () => {
    expect(() => assertCancellable("new")).not.toThrow();
    expect(() => assertCancellable("processing")).toThrow("Можно отменить только новые заказы");
    expect(() => assertCancellable("completed")).toThrow("Можно отменить только новые заказы");
  });

  it("only restores deleted orders", () => {
    expect(() => assertRestorable({ deletedAt: new Date() })).not.toThrow();
    expect(() => assertRestorable({ deletedAt: null })).toThrow("Заказ не удалён");
  });
});
