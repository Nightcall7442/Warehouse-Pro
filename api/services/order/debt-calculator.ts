import { sql } from "drizzle-orm";
import { holdsStock } from "./validator";
import type { Tx } from "./types";

/**
 * A shop's receivable follows its credit orders.
 *
 * Only `debt` orders touch it, and only while the order still holds stock: once an
 * order is completed the goods have changed hands, so cancelling or deleting it
 * later must not wipe the receivable. Every rule that decides *whether* the debt
 * moves lives here, so the four lifecycle operations don't each re-derive it.
 */

const CREDIT = "debt";

/** Orders paid on credit add to the shop's debt; reversing them must take it back. */
export async function adjustShopDebt(tx: Tx, tenantId: number, shopId: number, delta: number): Promise<void> {
  if (delta === 0) return;
  await tx.execute(sql`
    UPDATE shops
    SET debt = GREATEST(0, CAST(debt AS DECIMAL(12,2)) + ${delta})
    WHERE id = ${shopId} AND tenant_id = ${tenantId}
  `);
}

type CreditOrder = { status: string; shopId: number; total: string; paymentMethod: string | null };

function isCredit(order: { paymentMethod: string | null }): boolean {
  return order.paymentMethod === CREDIT;
}

export const OrderDebtCalculator = {
  adjustShopDebt,

  /** On creation a credit order books the whole total as a receivable. */
  async onCreate(tx: Tx, tenantId: number, shopId: number, paymentMethod: string | undefined, total: number): Promise<void> {
    if (paymentMethod !== CREDIT || total <= 0) return;
    // Raw increment rather than adjustShopDebt: creation cannot leave a negative
    // balance, so the GREATEST(0, …) clamp is not needed here.
    await tx.execute(sql`
      UPDATE shops SET debt = debt + ${total} WHERE id = ${shopId} AND tenant_id = ${tenantId}
    `);
  },

  /** Cancelling an open credit order releases the receivable it created. */
  async onCancel(tx: Tx, tenantId: number, order: CreditOrder): Promise<void> {
    if (!isCredit(order)) return;
    await adjustShopDebt(tx, tenantId, order.shopId, -Number(order.total));
  },

  /**
   * Same as cancelling, but reached through a status change: only an order that
   * still holds stock gives its receivable back. Completed orders keep theirs.
   */
  async onStatusCancel(tx: Tx, tenantId: number, order: CreditOrder): Promise<void> {
    if (!isCredit(order) || !holdsStock(order.status)) return;
    await adjustShopDebt(tx, tenantId, order.shopId, -Number(order.total));
  },

  /** Deleting a still-open credit order withdraws the receivable. */
  async onDelete(tx: Tx, tenantId: number, order: CreditOrder): Promise<void> {
    if (!isCredit(order) || !holdsStock(order.status)) return;
    await adjustShopDebt(tx, tenantId, order.shopId, -Number(order.total));
  },

  /** Mirror of onDelete: the receivable comes back with the order. */
  async onRestore(tx: Tx, tenantId: number, order: CreditOrder): Promise<void> {
    if (!isCredit(order) || !holdsStock(order.status)) return;
    await adjustShopDebt(tx, tenantId, order.shopId, Number(order.total));
  },

  /**
   * A re-discounted credit order moves the receivable by the difference — booking
   * the new total on top of the old one would overstate it.
   */
  async onTotalChanged(tx: Tx, tenantId: number, order: CreditOrder, newTotal: number): Promise<void> {
    if (!isCredit(order) || !holdsStock(order.status)) return;
    await adjustShopDebt(tx, tenantId, order.shopId, newTotal - Number(order.total));
  },
};
