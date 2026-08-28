import { describe, it, expect } from "vitest";
import { z } from "zod";
import { decimalOrDefault } from "../lib/zod-decimal";

/**
 * Проверено в настоящем браузере: поле type="number" на «12,5» отдаёт пустую
 * строку. На сервере она превращалась в значение по умолчанию, то есть в
 * ноль. А если запятая доходила до сервера целиком — из мобильного приложения
 * или вставкой — MySQL обрезал строку по запятой и записывал 12 вместо 12.5.
 */
describe("десятичное поле формы", () => {
  const schema = decimalOrDefault("0.00");

  it("запятая — разделитель, а не конец числа", () => {
    expect(schema.parse("12,5")).toBe("12.5");
    expect(schema.parse("1 250,75")).toBe("1250.75");
    expect(schema.parse("1\u00A0250")).toBe("1250");
  });

  it("пустое поле берёт значение по умолчанию", () => {
    // Ради этого функция и появилась: "" в колонке DECIMAL — ошибка 500.
    expect(schema.parse("")).toBe("0.00");
    expect(schema.parse("   ")).toBe("0.00");
    expect(decimalOrDefault("10.00").parse("")).toBe("10.00");
  });

  it("не число — отказ, а не тихая запись мусора", () => {
    for (const bad of ["abc", "12abc", "1.2.3", "--5", "1e5", "12,5,7"]) {
      expect(() => schema.parse(bad), `«${bad}» прошло на запись`).toThrow();
    }
  });

  it("обычные значения проходят как были", () => {
    expect(schema.parse("0")).toBe("0");
    expect(schema.parse("12.50")).toBe("12.50");
    expect(schema.parse("0.001")).toBe("0.001");
    expect(schema.parse("-5.5")).toBe("-5.5");
  });

  it("число вместо строки тоже принимается", () => {
    expect(schema.parse(12.5)).toBe("12.5");
  });

  it("необязательное поле и значение по умолчанию работают как раньше", () => {
    expect(decimalOrDefault("0.00").optional().parse(undefined)).toBeUndefined();
    expect(decimalOrDefault("0.00").default("0.00").parse(undefined)).toBe("0.00");
  });

  it("проверки поверх продолжают работать", () => {
    const positive = decimalOrDefault("0.00").refine(v => Number(v) >= 0, "Цена не может быть отрицательной");
    expect(positive.parse("5")).toBe("5");
    expect(() => positive.parse("-5")).toThrow("Цена не может быть отрицательной");
  });

  it("схема остаётся пригодной внутри объекта", () => {
    const item = z.object({ costPrice: decimalOrDefault("0.00").optional() });
    expect(item.parse({ costPrice: "12,5" })).toEqual({ costPrice: "12.5" });
    expect(item.parse({})).toEqual({});
  });
});
