/**
 * FIX: P2.1 — the decisions behind the dead-stock and reorder reports.
 *
 * Both used to be expressed entirely in SQL: dead stock as a GROUP BY over a
 * three-table fan-out with a HAVING, and the sales velocity as a correlated
 * subquery evaluated once per candidate product. The queries are now plain
 * aggregates, and the judgement — what counts as dead, how much to order — lives
 * here, where it can be tested without a database.
 */

const DAY_MS = 86_400_000;

/** Sentinel for "never sold". The UI sorts on this column, so it must stay orderable. */
export const NEVER_SOLD_DAYS = 99_999;

export type StockRow = {
  productId: number | null;
  currentStock: string | null;
  costPrice: string | null;
};

export type DeadStockVerdict = {
  value: string;
  lastOrderDate: Date | null;
  daysSinceOrder: number;
  isDead: boolean;
};

/**
 * Value on hand, staleness, and whether the product counts as dead.
 *
 * A product that never sold is dead by definition — the old HAVING clause treated
 * it the same way, and it is the case that matters most: stock bought and never
 * moved.
 */
export function assessStock(
  row: StockRow,
  lastOrderDate: Date | null,
  cutoff: Date,
  now: number = Date.now(),
): DeadStockVerdict {
  const value = (Number(row.currentStock ?? 0) * Number(row.costPrice ?? 0)).toFixed(2);
  const daysSinceOrder = lastOrderDate
    ? Math.floor((now - lastOrderDate.getTime()) / DAY_MS)
    : NEVER_SOLD_DAYS;

  return {
    value,
    lastOrderDate,
    daysSinceOrder,
    isDead: !lastOrderDate || lastOrderDate < cutoff,
  };
}

export type ReorderInput = {
  currentStock: string | null;
  reorderPoint: string | null;
  costPrice: string | null;
};

export type ReorderSuggestion = {
  avgDailySales: string;
  daysUntilStockout: number;
  suggestedQty: number;
  suggestedCost: number;
};

/** Days of cover a product has left, or 999 when nothing is selling. */
export function daysUntilStockout(currentStock: number, avgDailySales: number): number {
  if (avgDailySales <= 0) return 999;
  return Math.round(currentStock / avgDailySales);
}

/**
 * How much to order: enough to reach twice the reorder point.
 *
 * The doubling is the existing rule, kept as-is — it is a business choice, not an
 * optimisation, and changing it here would silently change every purchase order.
 */
export function suggestReorder(
  row: ReorderInput,
  soldInWindow: number,
  windowDays = 30,
): ReorderSuggestion {
  const avgDaily = windowDays > 0 ? soldInWindow / windowDays : 0;
  const current = Number(row.currentStock ?? 0);
  const reorderAt = Number(row.reorderPoint ?? 0);
  const suggestedQty = Math.max(0, reorderAt * 2 - current);

  return {
    avgDailySales: avgDaily.toFixed(1),
    daysUntilStockout: daysUntilStockout(current, avgDaily),
    suggestedQty: Math.round(suggestedQty),
    suggestedCost: Math.round(suggestedQty * Number(row.costPrice ?? 0)),
  };
}
