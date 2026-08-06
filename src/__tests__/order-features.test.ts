import { describe, it, expect } from "vitest";

// ── Unit tests for order service logic ──

describe("Order Status Transitions", () => {
  const validTransitions: Record<string, string[]> = {
    new:                  ["processing", "cancelled"],
    processing:           ["new", "shipped", "cancelled"],
    shipped:              ["processing", "delivered", "pending", "returned", "partially_returned", "partial_return_kept", "cancelled"],
    pending:              ["shipped", "delivered", "cancelled"],
    delivered:            ["returned", "partially_returned", "partial_return_kept"],
    partially_returned:   ["returned", "delivered"],
    partial_return_kept:  ["delivered"],
    returned:             [],
    cancelled:            [],
  };

  it("allows new → processing", () => {
    expect(validTransitions["new"]).toContain("processing");
  });

  it("allows processing → new (backward)", () => {
    expect(validTransitions["processing"]).toContain("new");
  });

  it("allows processing → shipped", () => {
    expect(validTransitions["processing"]).toContain("shipped");
  });

  it("allows shipped → delivered", () => {
    expect(validTransitions["shipped"]).toContain("delivered");
  });

  it("allows shipped → processing (backward)", () => {
    expect(validTransitions["shipped"]).toContain("processing");
  });

  it("blocks returned → anything", () => {
    expect(validTransitions["returned"]).toHaveLength(0);
  });

  it("blocks cancelled → anything", () => {
    expect(validTransitions["cancelled"]).toHaveLength(0);
  });

  it("blocks new → delivered (must go through processing/shipped)", () => {
    expect(validTransitions["new"]).not.toContain("delivered");
  });

  it("allows delivered → returned", () => {
    expect(validTransitions["delivered"]).toContain("returned");
  });

  it("allows delivered → partially_returned", () => {
    expect(validTransitions["delivered"]).toContain("partially_returned");
  });
});

describe("Stock Status Helpers", () => {
  function holdsStock(status: string): boolean {
    return ["new", "processing", "shipped", "pending"].includes(status);
  }

  function deductsStock(status: string): boolean {
    return status === "delivered" || status === "partial_return_kept";
  }

  function releasesStock(status: string): boolean {
    return status === "cancelled" || status === "returned" || status === "partially_returned";
  }

  it("holdsStock for active statuses", () => {
    expect(holdsStock("new")).toBe(true);
    expect(holdsStock("processing")).toBe(true);
    expect(holdsStock("shipped")).toBe(true);
    expect(holdsStock("pending")).toBe(true);
  });

  it("does not hold stock for terminal statuses", () => {
    expect(holdsStock("delivered")).toBe(false);
    expect(holdsStock("cancelled")).toBe(false);
    expect(holdsStock("returned")).toBe(false);
  });

  it("deductsStock only on delivery", () => {
    expect(deductsStock("delivered")).toBe(true);
    expect(deductsStock("partial_return_kept")).toBe(true);
    expect(deductsStock("new")).toBe(false);
    expect(deductsStock("cancelled")).toBe(false);
  });

  it("releasesStock on cancel/return", () => {
    expect(releasesStock("cancelled")).toBe(true);
    expect(releasesStock("returned")).toBe(true);
    expect(releasesStock("partially_returned")).toBe(true);
    expect(releasesStock("delivered")).toBe(false);
  });
});

describe("Unit Label Translation", () => {
  const UNIT_RU: Record<string, string> = {
    kg: "кг", l: "л", pcs: "шт", box: "блок", pack: "упак", m: "м", block: "блок",
  };

  function unitLabel(unit: string | null | undefined): string {
    return UNIT_RU[unit ?? "pcs"] ?? "шт";
  }

  it("translates common units", () => {
    expect(unitLabel("kg")).toBe("кг");
    expect(unitLabel("pcs")).toBe("шт");
    expect(unitLabel("box")).toBe("блок");
    expect(unitLabel("pack")).toBe("упак");
    expect(unitLabel("m")).toBe("м");
  });

  it("translates block to блок", () => {
    expect(unitLabel("block")).toBe("блок");
  });

  it("defaults to шт for unknown", () => {
    expect(unitLabel("unknown")).toBe("шт");
    expect(unitLabel(null)).toBe("шт");
    expect(unitLabel(undefined)).toBe("шт");
  });
});

describe("Clean Number Formatting", () => {
  function cleanNum(val: string | number | null | undefined): string {
    const n = Number(val ?? 0);
    if (n === 0) return "0";
    if (n === Math.floor(n)) return n.toLocaleString("ru-RU");
    return n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  it("removes trailing zeros", () => {
    expect(cleanNum("70.00")).toBe("70");
    expect(cleanNum("60.00")).toBe("60");
    expect(cleanNum(100)).toBe("100");
  });

  it("keeps meaningful decimals", () => {
    expect(cleanNum("12.50")).toContain("12,5");
    expect(cleanNum("100.12")).toContain("100,12");
  });

  it("handles zero", () => {
    expect(cleanNum("0")).toBe("0");
    expect(cleanNum("0.00")).toBe("0");
    expect(cleanNum(null)).toBe("0");
    expect(cleanNum(undefined)).toBe("0");
  });

  it("handles large numbers", () => {
    expect(cleanNum("1234567")).toContain("1");
  });
});

describe("Debt Status Classification", () => {
  function debtStatus(amount: number): string {
    if (amount <= 0) return "paid";
    if (amount <= 500_000) return "low";
    if (amount <= 1_000_000) return "high";
    return "critical";
  }

  it("classifies zero debt as paid", () => {
    expect(debtStatus(0)).toBe("paid");
    expect(debtStatus(-100)).toBe("paid");
  });

  it("classifies low debt", () => {
    expect(debtStatus(100_000)).toBe("low");
    expect(debtStatus(500_000)).toBe("low");
  });

  it("classifies high debt", () => {
    expect(debtStatus(500_001)).toBe("high");
    expect(debtStatus(1_000_000)).toBe("high");
  });

  it("classifies critical debt", () => {
    expect(debtStatus(1_000_001)).toBe("critical");
    expect(debtStatus(5_000_000)).toBe("critical");
  });
});

describe("Order Calculations", () => {
  function calcSubtotal(items: Array<{ qty: number; price: number }>): number {
    return items.reduce((sum, i) => sum + i.qty * i.price, 0);
  }

  function calcDiscount(percent: number, subtotal: number): number {
    const pct = Math.min(100, Math.max(0, percent));
    return subtotal * (pct / 100);
  }

  function calcTotal(subtotal: number, discount: number): number {
    return subtotal - discount;
  }

  it("calculates subtotal correctly", () => {
    expect(calcSubtotal([{ qty: 10, price: 50000 }, { qty: 5, price: 10000 }])).toBe(550000);
  });

  it("calculates discount percentage", () => {
    expect(calcDiscount(10, 100000)).toBe(10000);
    expect(calcDiscount(0, 100000)).toBe(0);
    expect(calcDiscount(100, 100000)).toBe(100000);
  });

  it("clamps discount to 0-100", () => {
    expect(calcDiscount(-10, 100000)).toBe(0);
    expect(calcDiscount(150, 100000)).toBe(100000);
  });

  it("calculates total after discount", () => {
    expect(calcTotal(100000, 10000)).toBe(90000);
  });
});

describe("Selection Persistence", () => {
  it("serializes Set to JSON array", () => {
    const set = new Set([1, 2, 3]);
    const json = JSON.stringify([...set]);
    expect(json).toBe("[1,2,3]");
  });

  it("deserializes JSON array to Set", () => {
    const json = "[1,2,3]";
    const set = new Set(JSON.parse(json));
    expect(set.size).toBe(3);
    expect(set.has(1)).toBe(true);
    expect(set.has(4)).toBe(false);
  });

  it("handles empty set", () => {
    const set = new Set<number>();
    const json = JSON.stringify([...set]);
    expect(json).toBe("[]");
    const restored = new Set(JSON.parse(json));
    expect(restored.size).toBe(0);
  });
});
