import { describe, it, expect } from "vitest";
import { normalizeMoney, to1CDate, from1CDate, mapProduct1C, mapOrder1C, sanitizeText, mapUnit } from "../onec-transform";

describe("normalizeMoney", () => {
  it("converts number to 2 decimal places", () => {
    expect(normalizeMoney(1500)).toBe("1500.00");
    expect(normalizeMoney(0)).toBe("0.00");
    expect(normalizeMoney(99.9)).toBe("99.90");
  });

  it("converts string to 2 decimal places", () => {
    expect(normalizeMoney("1500.5")).toBe("1500.50");
    expect(normalizeMoney("0")).toBe("0.00");
  });
});

describe("to1CDate", () => {
  it("formats date for 1C without Z suffix", () => {
    const date = new Date("2025-06-15T10:30:00Z");
    const result = to1CDate(date);
    expect(result).toContain("2025-06-15");
    expect(result).not.toContain("Z");
  });
});

describe("from1CDate", () => {
  it("parses date string", () => {
    const result = from1CDate("2025-06-15T10:30:00");
    expect(result).toBeInstanceOf(Date);
    expect(result.getFullYear()).toBe(2025);
  });

  it("passes through Date object", () => {
    const d = new Date("2025-01-01");
    expect(from1CDate(d)).toBe(d);
  });
});

describe("mapProduct1C", () => {
  it("maps 1C product to WP format", () => {
    const item = {
      Ref_Key: "uuid-123",
      Code: "001",
      Description: "Test Product",
      Price: 1500,
      Unit: "шт",
    };
    const result = mapProduct1C(item);
    expect(result.externalId).toBe("uuid-123");
    expect(result.name).toBe("Test Product");
    expect(result.code).toBe("001");
    expect(result.unitPrice).toBe("1500.00");
    expect(result.unit).toBe("шт");
    expect(result.category).toBeNull();
  });

  it("preserves category when provided", () => {
    const item = {
      Ref_Key: "uuid-456",
      Code: "002",
      Description: "Product B",
      Price: 100,
      Unit: "кг",
      Category: "Electronics",
    };
    const result = mapProduct1C(item);
    expect(result.category).toBe("Electronics");
  });

  it("defaults unit to шт when empty", () => {
    const item = {
      Ref_Key: "uuid-789",
      Code: "003",
      Description: "Product C",
      Price: 50,
      Unit: "",
    };
    const result = mapProduct1C(item);
    expect(result.unit).toBe("шт");
  });
});

describe("mapOrder1C", () => {
  it("maps WP order to 1C format", () => {
    const order = {
      id: 1,
      orderNumber: "ORD-001",
      createdAt: new Date("2025-06-15T10:30:00Z"),
      shopExternalId: "shop-uuid-abc",
      items: [
        { productExternalId: "prod-uuid-1", quantity: 5, unitPrice: 100 },
        { productExternalId: "prod-uuid-2", quantity: 2, unitPrice: 250.5 },
      ],
    };
    const result = mapOrder1C(order);
    expect(result.Number).toBe("ORD-001");
    expect(result.Контрагент_Key).toBe("shop-uuid-abc");
    expect(result.Товары).toHaveLength(2);
    expect(result.Товары[0].Номенклатура_Key).toBe("prod-uuid-1");
    expect(result.Товары[0].Количество).toBe(5);
    expect(result.Товары[0].Цена).toBe("100.00");
  });
});

describe("sanitizeText", () => {
  it("removes control characters", () => {
    expect(sanitizeText("hello\x00world")).toBe("helloworld");
    expect(sanitizeText("test\x07text")).toBe("testtext");
  });

  it("preserves normal text", () => {
    expect(sanitizeText("Hello World!")).toBe("Hello World!");
  });
});

describe("mapUnit", () => {
  it("maps Russian units to English", () => {
    expect(mapUnit("шт")).toBe("pcs");
    expect(mapUnit("кг")).toBe("kg");
    expect(mapUnit("л")).toBe("l");
    expect(mapUnit("м")).toBe("m");
    expect(mapUnit("ящ")).toBe("box");
    expect(mapUnit("уп")).toBe("pack");
  });

  it("defaults to pcs for unknown unit", () => {
    expect(mapUnit("something")).toBe("pcs");
  });

  it("handles case-insensitive input", () => {
    expect(mapUnit("ШТ")).toBe("pcs");
    expect(mapUnit("КГ")).toBe("kg");
  });
});
