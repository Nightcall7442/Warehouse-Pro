import { describe, it, expect } from "vitest";
import { z } from "zod";
import { decimalString, requiredDecimalString, toFixedScale } from "./zod-decimal";

/** First issue message of a failed parse — the thing the user actually sees. */
function messageOf(result: z.ZodSafeParseResult<unknown>): string | undefined {
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe("decimalString — blank means 'not provided'", () => {
  it('falls back to the default for ""', () => {
    expect(decimalString({ scale: 3, default: "0.000" }).parse("")).toBe("0.000");
  });

  it('falls back to the default for "   " (whitespace only)', () => {
    expect(decimalString({ scale: 3, default: "0.000" }).parse("   ")).toBe("0.000");
  });

  it("falls back to the default when the value is absent", () => {
    expect(decimalString({ scale: 3, default: "0.000" }).parse(undefined)).toBe("0.000");
  });

  it("stays undefined for blank/absent when there is no default", () => {
    const schema = decimalString({ scale: 3 });
    expect(schema.parse("")).toBeUndefined();
    expect(schema.parse("  ")).toBeUndefined();
    expect(schema.parse(undefined)).toBeUndefined();
  });

  it("omits an absent key entirely, so an update never writes it", () => {
    const schema = z.object({ id: z.number(), unitWeight: decimalString({ scale: 3 }) });
    expect(Object.keys(schema.parse({ id: 1 }))).toEqual(["id"]);
  });
});

describe("requiredDecimalString — blank and absent are errors", () => {
  const schema = requiredDecimalString({ min: 0, exclusiveMin: true, message: "Цена должна быть положительной" });

  it('rejects ""', () => {
    const result = schema.safeParse("");
    expect(result.success).toBe(false);
    expect(messageOf(result)).toBe("Цена должна быть положительной");
  });

  it('rejects "   "', () => {
    const result = schema.safeParse("   ");
    expect(result.success).toBe(false);
    expect(messageOf(result)).toBe("Цена должна быть положительной");
  });

  it("rejects an absent value", () => {
    const result = schema.safeParse(undefined);
    expect(result.success).toBe(false);
    expect(messageOf(result)).toBe("Цена должна быть положительной");
  });

  it("uses a generic Russian message when none is supplied", () => {
    expect(messageOf(requiredDecimalString().safeParse(""))).toBe("Значение обязательно");
  });

  it("accepts a real value", () => {
    expect(schema.parse("123000")).toBe("123000.00");
  });
});

describe("decimalString — rejects values that are not a finite number", () => {
  const schema = decimalString();

  it.each([
    ["abc", "letters"],
    ["1,5", "comma decimal separator"],
    ["NaN", "NaN literal"],
    ["Infinity", "Infinity literal"],
    ["-Infinity", "negative Infinity literal"],
    ["1e999", "overflows to Infinity"],
    ["0x10", "hexadecimal"],
    ["1 2", "embedded space"],
    ["--1", "double sign"],
  ])('rejects "%s" (%s)', (input) => {
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
    expect(messageOf(result)).toBe("Некорректное число");
  });

  it("uses a custom invalid message when supplied", () => {
    const result = decimalString({ invalidMessage: "Введите число" }).safeParse("abc");
    expect(messageOf(result)).toBe("Введите число");
  });
});

describe("decimalString — range checks", () => {
  it('rejects "-0.5" against min 0', () => {
    const schema = decimalString({ min: 0, message: "Цена не может быть отрицательной" });
    const result = schema.safeParse("-0.5");
    expect(result.success).toBe(false);
    expect(messageOf(result)).toBe("Цена не может быть отрицательной");
  });

  it("accepts exactly the inclusive minimum", () => {
    expect(decimalString({ min: 0 }).parse("0")).toBe("0.00");
  });

  it("rejects the boundary when the minimum is exclusive", () => {
    const schema = decimalString({ min: 0, exclusiveMin: true });
    expect(schema.safeParse("0").success).toBe(false);
    expect(messageOf(schema.safeParse("0"))).toBe("Значение должно быть больше 0");
    expect(schema.parse("0.01")).toBe("0.01");
  });

  it("enforces max", () => {
    const schema = decimalString({ min: -90, max: 90, scale: 8 });
    expect(messageOf(schema.safeParse("90.5"))).toBe("Значение не может быть больше 90");
    expect(schema.parse("41.3111")).toBe("41.31110000");
  });

  it("reports the generic Russian message for an inclusive minimum", () => {
    expect(messageOf(decimalString({ min: 0 }).safeParse("-1"))).toBe("Значение не может быть меньше 0");
  });
});

/**
 * Rounding is HALF AWAY FROM ZERO, done on the digit string rather than through
 * a float, so it matches how MySQL rounds a DECIMAL on insert.
 */
describe("decimalString — scale normalisation (half away from zero)", () => {
  it('pads "5" to the declared scale', () => {
    expect(decimalString({ scale: 3 }).parse("5")).toBe("5.000");
    expect(decimalString().parse("5")).toBe("5.00");
  });

  it('rounds "1.2345" to "1.235" at scale 3 — the dropped 5 rounds up', () => {
    expect(decimalString({ scale: 3 }).parse("1.2345")).toBe("1.235");
  });

  it('rounds "1.2345" to "1.23" at scale 2 — the dropped 45 rounds down', () => {
    expect(decimalString({ scale: 2 }).parse("1.2345")).toBe("1.23");
  });

  it("rounds away from zero for negatives too", () => {
    expect(decimalString({ scale: 3, min: -10 }).parse("-1.2345")).toBe("-1.235");
  });

  it('rounds "1.005" to "1.01", where Number.toFixed would give "1.00"', () => {
    expect(decimalString().parse("1.005")).toBe("1.01");
    expect((1.005).toFixed(2)).toBe("1.00"); // documents the float trap we avoid
  });

  it("carries across the integer boundary", () => {
    expect(decimalString().parse("999.999")).toBe("1000.00");
  });

  it("never produces negative zero", () => {
    expect(decimalString({ scale: 0, min: -1 }).parse("-0.4")).toBe("0");
    expect(decimalString({ scale: 2, min: -1 }).parse("-0.001")).toBe("0.00");
  });

  it("leaves a plausible real value untouched", () => {
    expect(decimalString({ min: 0, default: "0.00" }).parse("123000.00")).toBe("123000.00");
    expect(decimalString({ scale: 3, min: 0, default: "0.000" }).parse("1.250")).toBe("1.250");
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(decimalString().parse("  42.5  ")).toBe("42.50");
  });

  it("handles exponent notation and precision beyond double via toFixedScale", () => {
    expect(decimalString().parse("1e3")).toBe("1000.00");
    // 20 significant digits — exact, because the rounding never goes through a float
    expect(toFixedScale("12345678901234567.895", 2)).toBe("12345678901234567.90");
  });
});

describe("product-router create input", () => {
  async function createInput() {
    const { productRouter } = await import("../product-router");
    // tRPC keeps the parsed input schema on the procedure definition.
    const create = productRouter._def.procedures.create as unknown as { _def: { inputs: z.ZodType[] } };
    return create._def.inputs[0];
  }

  it('accepts unitWeight: "" and yields "0.000"', async () => {
    const schema = await createInput();
    const parsed = schema.parse({
      code: "TMC-038",
      name: "Buchinger 2%",
      category: "Товар",
      costPrice: "113000",
      unitPrice: "123000",
      unit: "block",
      unitWeight: "",
      reorderPoint: "100",
    });
    expect(parsed).toMatchObject({
      code: "TMC-038",
      costPrice: "113000.00",
      unitPrice: "123000.00",
      unitWeight: "0.000",
      reorderPoint: "100.00",
    });
  });

  it("blanks every optional numeric field at once and still fills the defaults", async () => {
    const schema = await createInput();
    const parsed = schema.parse({
      code: "X-1", name: "X", costPrice: "  ", unitPrice: "1", unitWeight: "", reorderPoint: "",
    });
    expect(parsed).toMatchObject({
      costPrice: "0.00", unitPrice: "1.00", unitWeight: "0.000", reorderPoint: "10.00",
    });
  });

  it('still rejects a blank unitPrice with "Цена должна быть положительной"', async () => {
    const schema = await createInput();
    const result = schema.safeParse({ code: "X-1", name: "X", unitPrice: "" });
    expect(result.success).toBe(false);
    expect(messageOf(result)).toBe("Цена должна быть положительной");
  });

  it("still rejects a negative costPrice", async () => {
    const schema = await createInput();
    const result = schema.safeParse({ code: "X-1", name: "X", unitPrice: "10", costPrice: "-1" });
    expect(result.success).toBe(false);
    expect(messageOf(result)).toBe("Цена не может быть отрицательной");
  });
});
