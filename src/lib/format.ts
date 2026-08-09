/**
 * Formats a stock/order quantity or weight for display: rounds to at most
 * `maxDecimals` places, then drops trailing zeros so a whole number reads as
 * "200" instead of "200.00" — the fixed decimals were the actual value's
 * precision, not something the reader needs to see on every row.
 */
export function formatQty(value: number | string | null | undefined, maxDecimals = 2): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "0";
  return Number(num.toFixed(maxDecimals)).toString();
}
