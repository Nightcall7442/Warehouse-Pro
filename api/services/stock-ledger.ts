import { sql } from "drizzle-orm";
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

/* ═══════════════════════════════════════════════════════════════════════════
   ДВЕРЬ ДЛЯ ОСТАТКА

   ── Что было ────────────────────────────────────────────────────────────────

   warehouse_stock меняют девятнадцать мест сырым SQL в двенадцати файлах.
   Единой двери нет; StockService.reserve/release/deduct — три операции, ради
   которых служба и писалась, — не вызывает НИКТО. Каждый путь считает остаток
   сам, и каждый по-своему: где-то available правится, где-то нет, где-то
   строку остатка сначала ищут и вставляют, если не нашли, а где-то нет — и
   тогда движение товара пропадает молча.

   Отсюда же невозможность учёта по партиям: пристроить его к девятнадцати
   разным записям значит завести второй источник правды о деньгах.

   ── Почему по одной операции ────────────────────────────────────────────────

   Дверь строится не разом. Каждая операция появляется здесь ВМЕСТЕ со своим
   вызовом — иначе это будет ещё один StockService: пять функций, ноль
   вызовов. Ratchet в api/__tests__/arrival-batch-expiry.test.ts держит число
   оставшихся сырых UPDATE и опускается по мере переноса.

   ── Почему движение и остаток пишутся вместе ───────────────────────────────

   Раньше это были два вызова подряд, и второй можно было забыть: журнал
   движений тогда расходится с остатком, а разошедшийся журнал не проверяет
   уже ничего. Здесь их не разнять.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Товар пришёл на склад.
 *
 * Приход, возврат от магазина, оприходование — всё, что УВЕЛИЧИВАЕТ остаток на
 * складе. Резерв не трогается: отложенное под чужой заказ остаётся отложенным.
 *
 * Строки остатка может ещё не быть — тогда она заводится. Это не мелочь: в
 * возвратах стоял голый UPDATE, и на товаре, которого не было на этом складе,
 * он не совпадал ни с одной строкой. Возврат принимали, товар списывали с
 * магазина, а на склад он не попадал — молча.
 *
 * Одним запросом, а не «поискать и вставить»: INSERT .. ON DUPLICATE KEY
 * UPDATE атомарен на уровне строки, и два одновременных прихода одного товара
 * складываются, а не перетирают друг друга.
 */
export async function receiveStock(
  tx: LedgerWriter,
  entry: {
    tenantId: number;
    warehouseId: number;
    productId: number;
    /** Сколько пришло. Положительное; ноль ничего не делает. */
    quantity: number | string;
    reason: StockMovementReason;
    referenceId?: number | null;
    notes?: string | null;
  },
): Promise<void> {
  const qty = Math.abs(Number(entry.quantity));
  if (!Number.isFinite(qty) || qty === 0) return;

  await tx.execute(sql`
    INSERT INTO warehouse_stock (tenant_id, warehouse_id, product_id, current_stock, reserved, available)
    VALUES (${entry.tenantId}, ${entry.warehouseId}, ${entry.productId}, ${qty}, 0, ${qty})
    ON DUPLICATE KEY UPDATE
      current_stock = current_stock + ${qty},
      available     = available + ${qty}
  `);

  await recordStockMovement(tx, {
    tenantId: entry.tenantId,
    warehouseId: entry.warehouseId,
    productId: entry.productId,
    type: "in",
    quantity: qty,
    reason: entry.reason,
    referenceId: entry.referenceId ?? null,
    notes: entry.notes ?? null,
  });
}
