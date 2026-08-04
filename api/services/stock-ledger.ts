import { stockMovements } from "@db/schema";

type Db = ReturnType<typeof import("../queries/connection").getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Movements are normally written inside the transaction that moved the stock,
 * so the two commit together. A few callers (the spreadsheet import) run
 * statement-by-statement without one and pass the connection directly.
 */
type LedgerWriter = Tx | Db;

/**
 * Why a movement is being recorded. Keeping these as one list means the
 * history reads consistently no matter which part of the system moved the
 * goods, and makes it obvious when a new flow needs a new entry here rather
 * than a free-text note.
 */
export type StockMovementReason =
  | "arrival"            // goods received from a supplier
  | "order_delivery"     // goods handed to a shop
  | "order_return"       // goods came back from a shop
  | "order_edit"         // a delivered order's lines were corrected after the fact
  | "return_completed"   // a formal return was approved and restocked
  | "transfer_out"       // left this warehouse for another
  | "transfer_in"        // arrived here from another warehouse
  | "manual_adjustment"  // a person corrected the count
  | "import"             // set by a spreadsheet import
  | "onec_sync";         // set by the 1C integration

/**
 * Records one movement of physical goods.
 *
 * Only changes to `current_stock` belong here: reserving stock for an open
 * order shuffles `reserved` and `available` but moves nothing, so it is not a
 * movement. That distinction is what makes the ledger meaningful — the sum of
 * a product's movements is what has actually entered and left the warehouse.
 *
 * `quantity` is always positive; direction lives in `type`. Callers pass the
 * magnitude of the change they are about to make (or just made) to
 * `current_stock`, in the same transaction, so the two can never disagree.
 */
export async function recordStockMovement(
  tx: LedgerWriter,
  entry: {
    tenantId: number;
    warehouseId: number;
    productId: number;
    /** "in" = current_stock rose, "out" = it fell, "adjustment" = set outright. */
    type: "in" | "out" | "adjustment";
    quantity: number | string;
    reason: StockMovementReason;
    /** The order, arrival, transfer or return this movement came from. */
    referenceId?: number | null;
    notes?: string | null;
  },
): Promise<void> {
  const magnitude = Math.abs(Number(entry.quantity));
  // A zero-quantity movement records nothing and only clutters the history.
  if (!Number.isFinite(magnitude) || magnitude === 0) return;

  await tx.insert(stockMovements).values({
    tenantId: entry.tenantId,
    warehouseId: entry.warehouseId,
    productId: entry.productId,
    type: entry.type,
    quantity: magnitude.toFixed(2),
    referenceType: entry.reason,
    referenceId: entry.referenceId ?? null,
    notes: entry.notes ?? null,
  });
}
