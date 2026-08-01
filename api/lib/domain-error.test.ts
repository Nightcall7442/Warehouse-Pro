import { describe, it, expect } from "vitest";
import { DomainError, isDomainError } from "./domain-error";
import {
  assertCancellable,
  assertRestorable,
  assertTransition,
  assertDiscountNotNegative,
  assertAvailableForReservation,
  priceOrderLines,
} from "../services/order/validator";

/**
 * These categories are what keeps a double-clicked delete out of the 500 feed:
 * `withDomainErrors` in api/middleware.ts maps the code straight onto the tRPC
 * code, so getting one wrong turns a 404 into a page of "внутренняя ошибка".
 */

describe("DomainError", () => {
  it("carries a category alongside the message", () => {
    const err = DomainError.notFound("Заказ не найден");
    expect(err.message).toBe("Заказ не найден");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.name).toBe("DomainError");
  });

  it("is a real Error, so existing catch/rethrow paths still work", () => {
    const err = DomainError.conflict("Можно отменить только новые заказы");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DomainError);
    expect(isDomainError(err)).toBe(true);
    expect(err.stack).toContain("DomainError");
  });

  it("does not mistake a plain Error for a domain one", () => {
    expect(isDomainError(new Error("Failed query: insert into `products`"))).toBe(false);
    expect(isDomainError("Заказ не найден")).toBe(false);
    expect(isDomainError(null)).toBe(false);
  });

  it("defaults to BAD_REQUEST when no category is given", () => {
    expect(new DomainError("что-то не так").code).toBe("BAD_REQUEST");
  });

  it("exposes every category through a named constructor", () => {
    expect(DomainError.notFound("x").code).toBe("NOT_FOUND");
    expect(DomainError.conflict("x").code).toBe("CONFLICT");
    expect(DomainError.forbidden("x").code).toBe("FORBIDDEN");
    expect(DomainError.badRequest("x").code).toBe("BAD_REQUEST");
  });
});

describe("order rules use the right categories", () => {
  /** Run `fn`, returning the DomainError it threw. */
  function thrown(fn: () => unknown): DomainError {
    try {
      fn();
    } catch (err) {
      if (isDomainError(err)) return err;
      throw new Error(`expected a DomainError, got ${String(err)}`);
    }
    throw new Error("expected a throw");
  }

  it("reports a state that forbids the action as CONFLICT", () => {
    // The screenshot case: deleting an order twice is 409, not 500.
    expect(thrown(() => assertCancellable("completed")).code).toBe("CONFLICT");
    expect(thrown(() => assertRestorable({ deletedAt: null })).code).toBe("CONFLICT");
    expect(thrown(() => assertTransition("completed", "processing")).code).toBe("CONFLICT");
    expect(thrown(() => assertAvailableForReservation(
      [{ productId: 1, quantity: "5" }],
      new Map([[1, 1]]),
    )).code).toBe("CONFLICT");
  });

  it("reports a missing referent as NOT_FOUND", () => {
    expect(thrown(() => priceOrderLines([{ productId: 9, quantity: "1" }], new Map())).code).toBe("NOT_FOUND");
  });

  it("reports bad input as BAD_REQUEST", () => {
    expect(thrown(() => assertDiscountNotNegative(-5)).code).toBe("BAD_REQUEST");
  });

  it("keeps the user-facing message unchanged", () => {
    expect(thrown(() => assertCancellable("completed")).message).toBe("Можно отменить только новые заказы");
  });
});
