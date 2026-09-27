import { describe, it, expect } from "vitest";
import { pickTier, priceAt, isBaseTier } from "@contracts/price-tiers";

/**
 * Одно правило выбора цены по количеству — для сервера и экрана.
 * Поведение на настоящей базе сверяет real-db/order-preview-tiers.test.ts.
 */
const t = (minQuantity: string, price: string, priority = 0) => ({ minQuantity, price, priority });

describe("pickTier", () => {
  it("больший подходящий порог внутри списка", () => {
    const rows = [t("1.00", "90.00"), t("10.00", "84.00"), t("50.00", "80.00")];
    expect([1, 9, 10, 49, 50, 500].map(q => pickTier(rows, q)?.price)).toEqual(["90.00", "90.00", "84.00", "84.00", "80.00", "80.00"]);
  });

  it("порог ≤ 1 — цена от одной штуки, и для дробного количества тоже", () => {
    expect(isBaseTier("1.00")).toBe(true);
    expect(isBaseTier("1.01")).toBe(false);
    expect(pickTier([t("1.00", "90.00"), t("10.00", "84.00")], 0.5)?.price, "полкило ушло мимо списка").toBe("90.00");
    expect(pickTier([t("10.00", "84.00")], 0.5)).toBeUndefined();
  });

  it("приоритет списка важнее порога", () => {
    expect(pickTier([t("1.00", "95.00", 5), t("10.00", "60.00", 1)], 30)?.price).toBe("95.00");
  });
});

describe("priceAt", () => {
  it("без ступеней — цена каталога; со ступенями — ступень, не подошла — цена каталога", () => {
    expect(priceAt("90.00", null, 100)).toBe("90.00");
    expect(priceAt("90.00", [], 100)).toBe("90.00");
    expect(priceAt("90.00", [t("20.00", "70.00")], 5)).toBe("90.00");
    expect(priceAt("90.00", [t("20.00", "70.00")], 25)).toBe("70.00");
  });
});
