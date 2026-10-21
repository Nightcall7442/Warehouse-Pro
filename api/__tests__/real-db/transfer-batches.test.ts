/**
 * Перемещение между складами и партии — на настоящей базе.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Проверка «хватает ли товара» смотрела на available, а available считает и
 * просроченные партии. Списание же по FEFO (transfer_out) просрочку не берёт.
 * Склад с десятью единицами в одной просроченной партии отдавал перемещение на
 * десять: current_stock падал до нуля, а строка партии оставалась с десятью —
 * партий становилось больше, чем лежит на полке, и отчёт «что сгорает» звал
 * списывать товар, которого нет.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · перемещение по FEFO не берёт просроченное: годного — available минус
 *     просрочка; больше — отказ с названием товара, остаток и партии целы;
 *   · то же правило у прежнего «провести застрявшее» (completeTransfer).
 *
 * Главный инвариант после каждого шага: SUM(партий) <= current_stock.
 *
 * Нарочная поломка: убери вычет просрочки в stock-transfer.ts — падает
 * «просроченное не уезжает»; в completeTransfer — падает «застрявшее».
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { receiveStock } from "../../services/stock-ledger";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const LATER = inDays(400);
const SOON = inDays(60);
const GONE = inDays(-3);

describe.skipIf(!hasRealDb)("перемещение и партии на настоящей базе", () => {
  let db: ServiceDb;
  let s: Seeded;
  let second: number;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("0.000");
    const [w] = await (db as any).insert(schema.warehouses).values({ tenantId: s.tenantId, name: "Второй склад" });
    second = Number(w.insertId);
  });

  const actor = () => ({ id: s.agentId, name: "Оператор", role: "operator" });

  const receive = (quantity: number, batch?: { batchNumber?: string | null; expiresAt?: string | null; costPrice?: string | null }, warehouseId = s.warehouseId, productId = s.productId) =>
    receiveStock(db as never, { tenantId: s.tenantId, warehouseId, productId, quantity, reason: "arrival", batch: batch ?? null });

  async function stockAt(warehouseId: number, productId = s.productId) {
    const [rows] = await db.execute(sql`
      SELECT current_stock AS c, reserved AS r, available AS a FROM warehouse_stock
      WHERE tenant_id = ${s.tenantId} AND warehouse_id = ${warehouseId} AND product_id = ${productId}
    `) as unknown as [Array<{ c: string; r: string; a: string }>];
    const r = rows[0];
    return { current: Number(r?.c ?? 0), reserved: Number(r?.r ?? 0), available: Number(r?.a ?? 0) };
  }

  async function batchesAt(warehouseId: number, productId = s.productId) {
    const [rows] = await db.execute(sql`
      SELECT batch_number AS b, DATE_FORMAT(expires_at, '%Y-%m-%d') AS e, quantity AS q, cost_price AS cost
      FROM stock_batches WHERE tenant_id = ${s.tenantId} AND warehouse_id = ${warehouseId} AND product_id = ${productId}
      ORDER BY expires_at IS NULL, expires_at, received_at, id
    `) as unknown as [Array<{ b: string | null; e: string | null; q: string; cost: string | null }>];
    return rows.map(r => ({ batch: r.b, expires: r.e, qty: Number(r.q), cost: r.cost }));
  }

  /** Партий не больше, чем лежит на полке — на обоих складах. */
  async function expectInvariant(productId = s.productId) {
    for (const wh of [s.warehouseId, second]) {
      const st = await stockAt(wh, productId);
      const inBatches = (await batchesAt(wh, productId)).reduce((sum, b) => sum + b.qty, 0);
      expect(inBatches, `склад ${wh}: партий (${inBatches}) больше, чем остатка (${st.current})`).toBeLessThanOrEqual(st.current);
    }
  }

  const transfer = async (quantity: number) => {
    const { transferStock } = await import("../../services/stock-transfer");
    return transferStock(db as never, s.tenantId, actor(), {
      fromWarehouseId: s.warehouseId, toWarehouseId: second, items: [{ productId: s.productId, quantity }],
    });
  };

  it("просроченное не уезжает по FEFO: годного — available минус просрочка", async () => {
    await receive(10, { batchNumber: "GONE", expiresAt: GONE });

    // Вся полка — одна сгоревшая партия: переместить нечего.
    await expect(transfer(10)).rejects.toThrow(/«Товар».*из них 10 просрочено/);
    expect(await stockAt(s.warehouseId), "отказ сдвинул остаток").toEqual({ current: 10, reserved: 0, available: 10 });
    expect((await batchesAt(s.warehouseId)).map(b => [b.batch, b.qty])).toEqual([["GONE", 10]]);
    await expectInvariant();

    // Рядом пять без партии: их — можно, шестую — нет.
    await receive(5);
    await expect(transfer(6)).rejects.toThrow(/переместить можно 5/);
    await transfer(5);
    expect((await stockAt(s.warehouseId)).current).toBe(10);
    expect((await stockAt(second)).current).toBe(5);
    expect((await batchesAt(s.warehouseId)).map(b => [b.batch, b.qty]), "уехала просрочка").toEqual([["GONE", 10]]);
    await expectInvariant();
  });

  it("застрявшее «в пути» (completeTransfer) — то же правило", async () => {
    await receive(4, { batchNumber: "GONE", expiresAt: GONE });
    await receive(3, { batchNumber: "OK", expiresAt: SOON });
    const [row] = await (db as any).insert(schema.stockTransfers).values({
      tenantId: s.tenantId, fromWarehouseId: s.warehouseId, toWarehouseId: second,
      productId: s.productId, quantity: "5.00", status: "pending", createdBy: s.agentId,
    });
    const transferId = Number(row.insertId);
    const { warehouseMultiRouter } = await import("../../warehouse-multi-router");
    const ceo = warehouseMultiRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "ceo"));

    await expect(ceo.completeTransfer({ transferId })).rejects.toThrow(/из них 4 просрочено/);
    expect((await stockAt(s.warehouseId)).current).toBe(7);
    await expectInvariant();

    // Годного хватает — проводится, просрочка остаётся на месте.
    await (db as any).update(schema.stockTransfers).set({ quantity: "3.00" }).where(sql`id = ${transferId}`);
    await ceo.completeTransfer({ transferId });
    expect((await stockAt(s.warehouseId)).current).toBe(4);
    expect((await batchesAt(s.warehouseId)).map(b => [b.batch, b.qty])).toEqual([["GONE", 4]]);
    await expectInvariant();
  });

  it("годный товар уезжает как прежде; LATER остаётся партией у источника", async () => {
    await receive(6, { batchNumber: "L", expiresAt: LATER });
    await transfer(2);
    expect((await stockAt(s.warehouseId)).current).toBe(4);
    expect((await stockAt(second)).current).toBe(2);
    await expectInvariant();
  });
});
