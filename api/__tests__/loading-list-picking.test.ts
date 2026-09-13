/**
 * Сверка собранного с нужным — без базы.
 *
 * Лист был бумагой; теперь кладовщик подтверждает каждую строку. Правила
 * простые, и именно поэтому их надо держать явно: не названная строка — «как
 * в листе», а не ноль; больше заказанного не грузят; недостача — это список,
 * а не молчание.
 */
import { describe, it, expect } from "vitest";
import { applyPicks } from "../services/loading-list";

const lines = [
  { productId: 1, name: "Вода 1,5", required: 4 },
  { productId: 2, name: "Сок 1л", required: 2 },
];

describe("сверка сборки", () => {
  it("не названная строка считается собранной полностью", () => {
    const r = applyPicks(lines, [{ productId: 1, pickedQty: "3.00" }]);
    expect(r.picked.get(2)).toBe(2);
    expect(r.shortages).toEqual([{ productId: 1, name: "Вода 1,5", required: 4, picked: 3 }]);
  });

  it("всё по списку — недостачи нет", () => {
    expect(applyPicks(lines, []).shortages).toEqual([]);
    expect(applyPicks(lines, [{ productId: 1, pickedQty: "4" }, { productId: 2, pickedQty: 2 }]).shortages).toEqual([]);
  });

  it("больше заказанного не грузят", () => {
    expect(() => applyPicks(lines, [{ productId: 2, pickedQty: "3" }])).toThrow(/больше заказанного/);
  });

  it("отрицательное и не число — отказ", () => {
    expect(() => applyPicks(lines, [{ productId: 1, pickedQty: "-1" }])).toThrow(/не меньше нуля/);
    expect(() => applyPicks(lines, [{ productId: 1, pickedQty: "abc" }])).toThrow(/не меньше нуля/);
  });

  it("товар, которого нет в листе, — отказ, а не молчаливый пропуск", () => {
    expect(() => applyPicks(lines, [{ productId: 9, pickedQty: "1" }])).toThrow(/нет товаров/);
  });

  it("ноль — это собрано ноль, а не «как в листе»", () => {
    const r = applyPicks(lines, [{ productId: 1, pickedQty: "0" }]);
    expect(r.picked.get(1)).toBe(0);
    expect(r.shortages[0]).toMatchObject({ productId: 1, picked: 0 });
  });
});
