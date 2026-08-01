import { describe, it, expect } from "vitest";
import {
  assessStock,
  suggestReorder,
  daysUntilStockout,
  NEVER_SOLD_DAYS,
} from "./replenishment";

/**
 * These two reports drive purchasing decisions, and until P2.1 neither had a
 * single test — the logic was buried in a GROUP BY … HAVING and a correlated
 * subquery. The rewrite kept the rules identical; these lock them down.
 */

const NOW = new Date("2026-08-01T12:00:00Z").getTime();
const CUTOFF_30D = new Date(NOW - 30 * 86_400_000);

const stock = (currentStock: string | null, costPrice: string | null = "1000.00") =>
  ({ productId: 1, currentStock, costPrice });

describe("assessStock", () => {
  it("values the stock on hand at cost", () => {
    const verdict = assessStock(stock("12", "1500.50"), new Date(NOW), CUTOFF_30D, NOW);
    expect(verdict.value).toBe("18006.00");
  });

  it("treats a product that never sold as dead", () => {
    const verdict = assessStock(stock("5"), null, CUTOFF_30D, NOW);
    expect(verdict.isDead).toBe(true);
    expect(verdict.daysSinceOrder).toBe(NEVER_SOLD_DAYS);
    expect(verdict.lastOrderDate).toBeNull();
  });

  it("treats a sale inside the window as alive", () => {
    const soldYesterday = new Date(NOW - 86_400_000);
    const verdict = assessStock(stock("5"), soldYesterday, CUTOFF_30D, NOW);
    expect(verdict.isDead).toBe(false);
    expect(verdict.daysSinceOrder).toBe(1);
  });

  it("treats a sale older than the window as dead", () => {
    const soldLongAgo = new Date(NOW - 45 * 86_400_000);
    const verdict = assessStock(stock("5"), soldLongAgo, CUTOFF_30D, NOW);
    expect(verdict.isDead).toBe(true);
    expect(verdict.daysSinceOrder).toBe(45);
  });

  it("counts a sale exactly on the boundary as alive", () => {
    // The cutoff is the oldest moment that still counts, matching the old
    // `createdAt >= cutoff` in the HAVING clause.
    const verdict = assessStock(stock("5"), CUTOFF_30D, CUTOFF_30D, NOW);
    expect(verdict.isDead).toBe(false);
    expect(verdict.daysSinceOrder).toBe(30);
  });

  it("survives missing stock and cost figures", () => {
    const verdict = assessStock(stock(null, null), null, CUTOFF_30D, NOW);
    expect(verdict.value).toBe("0.00");
    expect(verdict.isDead).toBe(true);
  });
});

describe("daysUntilStockout", () => {
  it("divides stock by velocity", () => {
    expect(daysUntilStockout(100, 4)).toBe(25);
    expect(daysUntilStockout(10, 3)).toBe(3); // rounded
  });

  it("returns 999 when nothing is selling", () => {
    expect(daysUntilStockout(100, 0)).toBe(999);
    expect(daysUntilStockout(0, 0)).toBe(999);
  });

  it("returns 0 when the shelf is already empty", () => {
    expect(daysUntilStockout(0, 5)).toBe(0);
  });
});

describe("suggestReorder", () => {
  const row = { currentStock: "10", reorderPoint: "50", costPrice: "2000" };

  it("orders up to twice the reorder point", () => {
    // 50 * 2 - 10 = 90 units at 2000 each.
    const s = suggestReorder(row, 0);
    expect(s.suggestedQty).toBe(90);
    expect(s.suggestedCost).toBe(180_000);
  });

  it("suggests nothing when stock is already above twice the point", () => {
    expect(suggestReorder({ ...row, currentStock: "200" }, 300).suggestedQty).toBe(0);
    expect(suggestReorder({ ...row, currentStock: "200" }, 300).suggestedCost).toBe(0);
  });

  it("averages the window's sales into a daily rate", () => {
    expect(suggestReorder(row, 300).avgDailySales).toBe("10.0");
    expect(suggestReorder(row, 45).avgDailySales).toBe("1.5");
    expect(suggestReorder(row, 0).avgDailySales).toBe("0.0");
  });

  it("derives the runway from that rate", () => {
    // 10 in stock, 300 sold in 30 days → 10/day → one day left.
    expect(suggestReorder(row, 300).daysUntilStockout).toBe(1);
    expect(suggestReorder(row, 0).daysUntilStockout).toBe(999);
  });

  it("honours a different window length", () => {
    expect(suggestReorder(row, 70, 7).avgDailySales).toBe("10.0");
  });

  it("does not divide by a zero-length window", () => {
    expect(suggestReorder(row, 100, 0).avgDailySales).toBe("0.0");
  });

  it("survives missing figures", () => {
    const s = suggestReorder({ currentStock: null, reorderPoint: null, costPrice: null }, 0);
    expect(s).toEqual({
      avgDailySales: "0.0",
      daysUntilStockout: 999,
      suggestedQty: 0,
      suggestedCost: 0,
    });
  });
});
