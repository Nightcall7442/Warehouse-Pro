/**
 * Допуск на округление наличных — фиксированный, в тийинах.
 *
 * Множитель 1.2 по остатку 5 000 000 пропускал миллион сверху как
 * «округление», а по остатку 300 — всего 60. Округление у наличных одно на
 * все заказы — до купюры: 50 000 тийинов (500 сум) сверх остатка, сравнение
 * в целых тийинах. Нарочная поломка: верни `amount > remaining * 1.2` —
 * падают первая и вторая проверки.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { assertFitsRemainder, CASH_ROUNDING_TOLERANCE_TIYIN, tiyin } from "../services/payment";

describe("допуск наличных", () => {
  it("500 сум сверх остатка проходит, 500.01 — нет, и так при любом остатке", () => {
    expect(CASH_ROUNDING_TOLERANCE_TIYIN).toBe(50_000);
    expect(() => assertFitsRemainder(300, 0, 800)).not.toThrow();
    expect(() => assertFitsRemainder(300, 0, 800.01)).toThrow(/больше остатка по заказу \(300\)/);
    // Раньше по большому остатку проходил миллион сверху.
    expect(() => assertFitsRemainder(5_000_000, 0, 5_000_500)).not.toThrow();
    expect(() => assertFitsRemainder(5_000_000, 0, 5_000_501)).toThrow(/больше остатка/);
    // Остаток, а не сумма заказа: уже принято 200 из 300 — принять можно до 600.
    expect(() => assertFitsRemainder(300, 200, 600)).not.toThrow();
    expect(() => assertFitsRemainder(300, 200, 600.01)).toThrow(/уже принято 200/);
  });

  it("сравнение в целых тийинах — двоичная дробь не решает", () => {
    expect(tiyin(0.1 + 0.2)).toBe(30);
    // 100.10 + 500 = 600.10; в double 100.1 + 500 = 600.1 ровно, а 600.1 − 0.0000001 ловится только в тийинах.
    expect(() => assertFitsRemainder(100.1, 0, 600.1)).not.toThrow();
    const src = readFileSync("api/services/payment.ts", "utf-8");
    expect(src).toContain("tiyin(amount) > tiyin(remaining) + CASH_ROUNDING_TOLERANCE_TIYIN");
    expect(src).not.toMatch(/remaining \* /);
  });
});
