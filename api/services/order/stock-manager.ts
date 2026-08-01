import { eq, and, sql } from "drizzle-orm";
import { warehouseStock, warehouses } from "@db/schema";
import { assertAvailableForReservation, assertSufficientForDeduction } from "./validator";
import { DomainError } from "../../lib/domain-error";
import type { OrderLine, Tx } from "./types";

/**
 * Reserve / release / deduct for an order's lines.
 *
 * All three write one batched `UPDATE ... CASE` per call rather than a statement
 * per line, and all three lock the affected rows first: two concurrent orders for
 * the same product would otherwise both read the same `available` and both pass
 * the check.
 */

/**
 * Every stock movement in an order's lifecycle must target the same warehouse.
 * The order row does not record one, so the default warehouse is the single
 * source of truth: reservation on create, release on cancel/delete, deduction on
 * completion. An explicit non-default warehouseId is rejected rather than
 * silently reserved in one warehouse and released from another.
 */
export async function resolveOrderWarehouse(tx: Tx, tenantId: number, requested?: number): Promise<number> {
  const [defaultWh] = await tx.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true))).limit(1);
  const whId = defaultWh?.id;
  if (!whId) throw DomainError.conflict("Склад по умолчанию не найден");
  if (requested !== undefined && requested !== whId) {
    throw DomainError.badRequest("Заказ можно оформить только со склада по умолчанию");
  }
  return whId;
}

const productList = (items: OrderLine[]) => sql.join(items.map(i => sql`${i.productId}`), sql`, `);

const caseWhen = (items: OrderLine[], body: (item: OrderLine) => ReturnType<typeof sql>) =>
  sql.join(items.map(body), sql`\n`);

/** Lock the stock rows for these products in this warehouse, and read them back. */
async function lockRows(tx: Tx, tenantId: number, warehouseId: number, items: OrderLine[]) {
  return tx.select({
    productId: warehouseStock.productId,
    available: warehouseStock.available,
    currentStock: warehouseStock.currentStock,
  })
    .from(warehouseStock)
    .where(and(
      sql`${warehouseStock.productId} IN (${productList(items)})`,
      eq(warehouseStock.tenantId, tenantId),
      eq(warehouseStock.warehouseId, warehouseId),
    ))
    .for("update");
}

export const OrderStockManager = {
  resolveOrderWarehouse,

  /**
   * Move quantities from `available` into `reserved` for a new order.
   * Returns the warehouse the reservation landed in, which later transitions reuse.
   */
  async reserve(tx: Tx, tenantId: number, items: OrderLine[], requestedWarehouseId?: number): Promise<number> {
    const warehouseId = await resolveOrderWarehouse(tx, tenantId, requestedWarehouseId);
    if (items.length === 0) return warehouseId;

    const rows = await lockRows(tx, tenantId, warehouseId, items);
    const available = new Map(rows.map(r => [Number(r.productId), Number(r.available ?? 0)]));
    // A product with no stock row in this warehouse has nothing available.
    for (const item of items) {
      if (!available.has(item.productId)) available.set(item.productId, 0);
    }
    assertAvailableForReservation(items, available);

    // P0-2 FIX: Include warehouse_id in UPDATE to prevent cross-warehouse corruption
    await tx.execute(sql`
      UPDATE warehouse_stock
      SET
        reserved = reserved + CASE ${caseWhen(items, i =>
          sql`WHEN product_id = ${i.productId} THEN ${Number(i.quantity)}`)} ELSE 0 END,
        available = available - CASE ${caseWhen(items, i =>
          sql`WHEN product_id = ${i.productId} THEN ${Number(i.quantity)}`)} ELSE 0 END
      WHERE product_id IN (${productList(items)})
        AND tenant_id = ${tenantId}
        AND warehouse_id = ${warehouseId}
    `);

    return warehouseId;
  },

  /** Give a reservation back: `reserved` down, `available` up. */
  async release(tx: Tx, tenantId: number, items: OrderLine[]): Promise<void> {
    if (items.length === 0) return;
    const warehouseId = await resolveOrderWarehouse(tx, tenantId);
    await lockRows(tx, tenantId, warehouseId, items);

    await tx.execute(sql`
      UPDATE warehouse_stock
      SET
        reserved = CASE ${caseWhen(items, i =>
          sql`WHEN product_id = ${i.productId} THEN reserved - ${Number(i.quantity)}`)} ELSE reserved END,
        available = CASE ${caseWhen(items, i =>
          sql`WHEN product_id = ${i.productId} THEN available + ${Number(i.quantity)}`)} ELSE available END
      WHERE product_id IN (${productList(items)})
        AND tenant_id = ${tenantId}
        AND warehouse_id = ${warehouseId}
    `);
  },

  /**
   * Ship the goods: `current_stock` and `reserved` both come down.
   *
   * The post-update re-read is not redundant paranoia — the check above it reads
   * `current_stock` under a row lock, but a concurrent adjustment outside this
   * transaction can still leave the column negative, and a negative on-hand figure
   * corrupts every stock report afterwards. If it happens the movement is undone
   * and the caller sees the same "not enough stock" error.
   */
  async deduct(tx: Tx, tenantId: number, items: OrderLine[]): Promise<void> {
    if (items.length === 0) return;
    const warehouseId = await resolveOrderWarehouse(tx, tenantId);

    const rows = await lockRows(tx, tenantId, warehouseId, items);
    assertSufficientForDeduction(
      items,
      new Map(rows.map(r => [Number(r.productId), Number(r.currentStock)])),
    );

    await tx.execute(sql`
      UPDATE warehouse_stock
      SET
        current_stock = CASE ${caseWhen(items, i =>
          sql`WHEN product_id = ${i.productId} THEN current_stock - ${Number(i.quantity)}`)} ELSE current_stock END,
        reserved = CASE ${caseWhen(items, i =>
          sql`WHEN product_id = ${i.productId} THEN reserved - ${Number(i.quantity)}`)} ELSE reserved END
      WHERE product_id IN (${productList(items)})
        AND tenant_id = ${tenantId}
        AND warehouse_id = ${warehouseId}
    `);

    const updated = await tx.select({ productId: warehouseStock.productId, currentStock: warehouseStock.currentStock })
      .from(warehouseStock)
      .where(and(
        eq(warehouseStock.tenantId, tenantId),
        eq(warehouseStock.warehouseId, warehouseId),
        sql`${warehouseStock.productId} IN (${productList(items)})`,
      ));
    const short = items.filter(item => {
      const row = updated.find(r => Number(r.productId) === item.productId);
      return row && Number(row.currentStock) < 0;
    });
    if (short.length === 0) return;

    await tx.execute(sql`
      UPDATE warehouse_stock
      SET
        current_stock = CASE ${caseWhen(short, i =>
          sql`WHEN product_id = ${i.productId} THEN current_stock + ${Number(i.quantity)}`)} ELSE current_stock END,
        reserved = CASE ${caseWhen(short, i =>
          sql`WHEN product_id = ${i.productId} THEN reserved + ${Number(i.quantity)}`)} ELSE reserved END
      WHERE product_id IN (${productList(short)})
        AND tenant_id = ${tenantId}
        AND warehouse_id = ${warehouseId}
    `);
    throw DomainError.conflict(`Недостаточно товара на складе: ${short.map(i => `${i.productId}`).join(", ")}`);
  },

  /**
   * Re-reserve the lines of an order being restored, one product at a time.
   *
   * Unlike `reserve` this reports which product fell short, because a restore is
   * an operator action on an existing order and "which item blocks it" is the
   * question they need answered.
   */
  async reReserveForRestore(tx: Tx, tenantId: number, items: OrderLine[]): Promise<void> {
    if (items.length === 0) return;
    const warehouseId = await resolveOrderWarehouse(tx, tenantId);
    await lockRows(tx, tenantId, warehouseId, items);

    for (const item of items) {
      const qty = Number(item.quantity);
      const [stock] = await tx.select({ available: warehouseStock.available })
        .from(warehouseStock)
        .where(and(
          eq(warehouseStock.productId, item.productId),
          eq(warehouseStock.tenantId, tenantId),
          eq(warehouseStock.warehouseId, warehouseId),
        ))
        .limit(1);
      const available = Number(stock?.available ?? 0);
      if (available < qty) {
        throw DomainError.conflict(`Недостаточно товара на складе для восстановления (товар ID ${item.productId}: доступно ${available}, нужно ${qty})`);
      }
      await tx.execute(sql`
        UPDATE warehouse_stock
        SET available = available - ${qty}, reserved = reserved + ${qty}
        WHERE product_id = ${item.productId} AND tenant_id = ${tenantId} AND warehouse_id = ${warehouseId}
      `);
    }
  },
};
