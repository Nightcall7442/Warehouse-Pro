import { sql } from "drizzle-orm";

type Tx = Parameters<Parameters<ReturnType<typeof import("../queries/connection").getDb>["transaction"]>[0]>[0];

/**
 * `shops.debt` is a cached running balance, and for a long time every caller
 * maintained it by hand — "add the total here", "subtract what was paid
 * there". That approach produced a steady trickle of bugs: a delivery that
 * booked nothing because the order wasn't marked "в долг", a partial payment
 * that subtracted from a balance nothing had ever been added to, two helpers
 * composed in one transaction where the second read a status the first had
 * just written and drew the wrong conclusion from it. Each was individually
 * plausible; together they meant real money silently vanished from the
 * debtor list.
 *
 * So the balance is no longer maintained incrementally. It is *derived*:
 * this function recomputes it from the underlying records, and every mutation
 * that can affect what a shop owes simply calls it once it is done. That
 * makes the write idempotent and order-independent — running it twice, or
 * after an unrelated change, can't drift — and removes the entire class of
 * "we forgot to adjust the balance on this path" bug, because there is no
 * adjustment to forget.
 *
 * ── What a shop owes ────────────────────────────────────────────────────────
 *
 * Per order, unless it was cancelled or fully returned (nothing is owed for
 * goods that never stayed with the shop):
 *
 *   • a credit order ("в долг") owes from the moment it is created — that is
 *     what selling on credit means;
 *   • any other order owes only once the goods actually left, i.e. the order
 *     reached "delivered";
 *   • in both cases what's owed is the total minus whatever has been paid
 *     against that specific order.
 *
 * Plus shop-level entries not tied to any order: manual "новый долг" rows add,
 * manual payments subtract. Completed returns subtract too — the goods came
 * back, so their value is no longer owed.
 *
 * Floored at zero: an overpayment is not a negative debt.
 */
export async function recalcShopDebt(tx: Tx, tenantId: number, shopId: number): Promise<void> {
  await tx.execute(sql`
    UPDATE shops s
    SET s.debt = GREATEST(0,
      -- Obligations arising from this shop's orders.
      COALESCE((
        SELECT SUM(
          CASE
            WHEN o.status IN ('cancelled', 'returned') THEN 0
            WHEN o.payment_method = 'debt' OR o.status = 'delivered'
              THEN GREATEST(0, CAST(o.total AS DECIMAL(15,2)) - COALESCE(op.paid, 0))
            ELSE 0
          END
        )
        FROM orders o
        LEFT JOIN (
          SELECT order_id, SUM(CAST(amount AS DECIMAL(15,2))) AS paid
          FROM payments
          WHERE type = 'payment' AND order_id IS NOT NULL
          GROUP BY order_id
        ) op ON op.order_id = o.id
        WHERE o.shop_id = s.id AND o.tenant_id = s.tenant_id AND o.deleted_at IS NULL
      ), 0)
      -- Shop-level entries recorded directly against the shop, not an order.
      + COALESCE((
        SELECT SUM(CAST(amount AS DECIMAL(15,2))) FROM payments
        WHERE shop_id = s.id AND tenant_id = s.tenant_id AND type = 'debt' AND order_id IS NULL
      ), 0)
      - COALESCE((
        SELECT SUM(CAST(amount AS DECIMAL(15,2))) FROM payments
        WHERE shop_id = s.id AND tenant_id = s.tenant_id AND type = 'payment' AND order_id IS NULL
      ), 0)
      -- Returned goods are no longer owed for.
      --
      -- Skipped when the return's own order is already cancelled or returned,
      -- because that order contributed 0 above — its whole value is written
      -- off already. Subtracting the return document on top would take the
      -- same money off twice. The floor at the end hides that for a shop whose
      -- only order this is, but on a shop with other open orders the surplus
      -- eats into a balance it has nothing to do with.
      --
      -- Returns against a still-delivered order (the partial case: shop kept
      -- some, handed the rest back) do subtract, which is the whole point of
      -- the document.
      - COALESCE((
        SELECT SUM(CAST(r.total_amount AS DECIMAL(15,2))) FROM returns r
        WHERE r.shop_id = s.id AND r.tenant_id = s.tenant_id AND r.status = 'completed'
          AND (
            r.order_id IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM orders o3
              WHERE o3.id = r.order_id AND o3.status IN ('cancelled', 'returned')
            )
          )
      ), 0)
    )
    WHERE s.id = ${shopId} AND s.tenant_id = ${tenantId}
  `);
}
