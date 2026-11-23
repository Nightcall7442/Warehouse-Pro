import { describe, it, expect } from "vitest";
import { parseImportNumber } from "../lib/import-number";

/*
  Число из ячейки импорта (бизнес-аудит 19.11.2026): «1 200,50» читалось как
  120050 — запятая выбрасывалась вместе с пробелами.
*/
describe("parseImportNumber", () => {
  it.each([
    ["1 200,50", 1200.5],
    ["1 200 000", 1200000],
    ["12 000 сум", 12000],
    ["850 000 so'm", 850000],
    ["1200,5", 1200.5],
    ["0,250", 0.25],
    ["1.200,50", 1200.5],
    ["1,200.50", 1200.5],
    ["12,000", 12000],
    ["1,200,000", 1200000],
    ["1.200.000", 1200000],
    ["1200.75", 1200.75],
    ["1'200'000", 1200000],
    ["−500", -500],
    ["42", 42],
  ])("%s → %d", (raw, expected) => {
    expect(parseImportNumber(raw)).toBeCloseTo(expected, 6);
  });

  it("число из ячейки Excel и результат формулы берутся как есть", () => {
    expect(parseImportNumber(12000.5)).toBe(12000.5);
    expect(parseImportNumber({ formula: "A1*2", result: 300 } as never)).toBe(300);
  });

  it("пусто — не указано, мусор — ошибка, а не ноль", () => {
    expect(parseImportNumber("")).toBeUndefined();
    expect(parseImportNumber(null)).toBeUndefined();
    expect(parseImportNumber("  ")).toBeUndefined();
    expect(parseImportNumber("abc")).toBeNull();
    expect(parseImportNumber("12-5")).toBeNull();
    expect(parseImportNumber("1,2,3")).toBeNull();
    expect(parseImportNumber("1.2.3")).toBeNull();
  });
});
