/**
 * The in-memory twin of `recalcShopDebt`'s SQL.
 *
 * `shops.debt` stopped being a running balance nudged by deltas and became a
 * value derived from the underlying records — one `UPDATE shops SET debt = …`
 * with a subquery per source. The suites' fake `execute` still emulated the old
 * shape, reading `values[0]` as a delta when the new statement binds only
 * `[shopId, tenantId]`; the debt therefore never moved and four lifecycle tests
 * failed while the production code was correct.
 *
 * Rather than teach each suite to parse that statement, this reproduces the
 * same rule over the fake tables. Keep it in step with
 * `api/services/shop-debt.ts` — `shop-debt-invariant.test.ts` guards the
 * production side; this is what the lifecycle tests measure against.
 */

export interface DebtOrder {
  id: number;
  tenantId: number;
  shopId: number;
  status: string;
  total: string | number;
  paymentMethod?: string | null;
  deletedAt?: Date | null;
}

export interface DebtPayment {
  tenantId: number;
  shopId: number;
  orderId?: number | null;
  type: string;
  amount: string | number;
}

export interface DebtReturn {
  tenantId: number;
  shopId: number;
  status: string;
  totalAmount: string | number;
}

export interface DebtTables {
  orders: DebtOrder[];
  payments?: DebtPayment[];
  returns?: DebtReturn[];
}

const num = (v: unknown) => Number(v ?? 0) || 0;

/** Returns what the shop owes, as the DECIMAL(15,2) string the column holds. */
export function deriveShopDebt(tenantId: number, shopId: number, t: DebtTables): string {
  const payments = t.payments ?? [];
  const returns = t.returns ?? [];

  const mine = <T extends { tenantId: number; shopId: number }>(rows: T[]) =>
    rows.filter(r => r.tenantId === tenantId && r.shopId === shopId);

  // Obligations arising from this shop's orders.
  const fromOrders = mine(t.orders)
    .filter(o => !o.deletedAt)
    .reduce((sum, o) => {
      if (o.status === "cancelled" || o.status === "returned") return sum;
      const owes = o.paymentMethod === "debt" || o.status === "delivered";
      if (!owes) return sum;
      const paid = payments
        .filter(p => p.type === "payment" && p.orderId === o.id)
        .reduce((s, p) => s + num(p.amount), 0);
      return sum + Math.max(0, num(o.total) - paid);
    }, 0);

  // Entries recorded against the shop rather than any one order.
  const shopLevel = mine(payments).filter(p => p.orderId == null);
  const manualDebt = shopLevel.filter(p => p.type === "debt").reduce((s, p) => s + num(p.amount), 0);
  const manualPaid = shopLevel.filter(p => p.type === "payment").reduce((s, p) => s + num(p.amount), 0);

  // Returned goods are no longer owed for.
  const returned = mine(returns)
    .filter(r => r.status === "completed")
    .reduce((s, r) => s + num(r.totalAmount), 0);

  return Math.max(0, fromOrders + manualDebt - manualPaid - returned).toFixed(2);
}

/**
 * True when a fake `execute` was handed the debt recalculation. The statement
 * binds `[shopId, tenantId]` and nothing else.
 */
export function isShopDebtRecalc(fullSql: string): boolean {
  return fullSql.includes("UPDATE shops") && fullSql.includes("debt");
}
