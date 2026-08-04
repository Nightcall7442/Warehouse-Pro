/**
 * The order lifecycle, named once.
 *
 * `orders.status` is a MySQL enum:
 *   new · processing · shipped · pending · delivered · cancelled · returned
 *
 * Forty-four query sites used to hard-code `["delivered", "completed"]` as
 * "the sale happened". `completed` has never been a member of that enum — no
 * row in production has ever carried it — so every one of those filters was
 * comparing an enum column against a value it could not hold. MySQL silently
 * matches nothing rather than erroring, which is why it survived: the queries
 * returned the right rows via `delivered` alone while the type-checker reported
 * two dozen errors about it.
 *
 * Naming the sets here keeps a rename of the lifecycle to one edit, and lets
 * `order-status-invariant.test.ts` fail if a literal status list reappears.
 */

/** Still moving through the pipeline — nothing final has happened to the goods. */
export const OPEN_ORDER_STATUSES = ["new", "processing", "shipped", "pending"] as const;

/** Goods are no longer in play, whatever the outcome. */
export const CLOSED_ORDER_STATUSES = ["delivered", "cancelled", "returned"] as const;

/**
 * The sale actually happened: goods handed over, money owed or paid.
 * This is the set every revenue, KPI, commission and forecast query wants.
 */
export const REVENUE_ORDER_STATUSES = ["delivered"] as const;

export type OrderStatus =
  | (typeof OPEN_ORDER_STATUSES)[number]
  | (typeof CLOSED_ORDER_STATUSES)[number];

/** Goods are still reserved against the warehouse. */
export function holdsStock(status: string): boolean {
  return (OPEN_ORDER_STATUSES as readonly string[]).includes(status);
}

/** Goods have left the warehouse for good. */
export function deductsStock(status: string): boolean {
  return (REVENUE_ORDER_STATUSES as readonly string[]).includes(status);
}
