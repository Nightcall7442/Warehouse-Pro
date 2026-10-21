import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, stockOf, countOf, type ServiceDb, type Seeded } from "./harness";

/**
 * Возврат товара поставщику на настоящей базе: товар уходит со склада
 * движением supplier_return, долг по поставке гасится строкой «возврат
 * товара» по себестоимости — не больше остатка; повтор по ключу — дубль.
 *
 * Склад возврата без явного выбора — тот, куда поставку приняли: форма
 * возврата склада не присылает, а приход по заказу поставщику ложится на
 * склад заказа (ADR 0012, 0013).
 *
 * Нарочная поломка: в supplier.returnGoods убери чтение склада прихода —
 * падают оба теста «склад приёмки»; верни в подзапрос «свободно» товар как
 * ${products.id} — падают они же: строка остатка на филиале не совпадает
 * номером с товаром, и «свободно» читалось как 0.
 */

describe.skipIf(!hasRealDb)("возврат товара поставщику", () => {
  let db: ServiceDb;
  let s: Seeded;
  let supplyId: number;

  beforeAll(async () => { db = await connectRealDb(); }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    const d = db as any;
    const [sup] = await d.insert(schema.suppliers).values({ tenantId: s.tenantId, name: "Завод" });
    const [sup1] = await d.insert(schema.supplies).values({
      tenantId: s.tenantId, supplierId: Number(sup.insertId), supplyNumber: "SUP-R-1", amount: "50000.00", currency: "UZS",
      supplyDate: new Date("2026-09-01"),
    });
    supplyId = Number(sup1.insertId);
    // себестоимость товара 9 000 — по ней и считается возврат
    await d.update(schema.products).set({ costPrice: "9000.00" }).where(sql`id = ${s.productId}`);
  });

  const caller = async () => (await import("../../supplier-router")).supplierRouter.createCaller(ctxFor(db, s.tenantId, s.agentId));

  it("списывает со склада и гасит долг по себестоимости; повтор по ключу — дубль", async () => {
    const c = await caller();
    const key = crypto.randomUUID();
    const r = await c.returnGoods({ supplyId, items: [{ productId: s.productId, quantity: "3" }], notes: "брак", idempotencyKey: key });
    expect(r).toMatchObject({ credited: 27000, debt: 23000, uncredited: 0 });

    expect((await stockOf(s.productId)).current).toBe(7);
    expect(await countOf("stock_movements", "reference_type = 'supplier_return'")).toBe(1);
    expect(await countOf("supplier_payments", "payment_method = 'return'")).toBe(1);

    const again = await c.returnGoods({ supplyId, items: [{ productId: s.productId, quantity: "3" }], idempotencyKey: key });
    expect(again).toMatchObject({ duplicate: true });
    expect((await stockOf(s.productId)).current).toBe(7);
  });

  it("больше остатка долга не гасит — лишнее названо, а не ушло в минус; больше свободного — отказ", async () => {
    const c = await caller();
    const r = await c.returnGoods({ supplyId, items: [{ productId: s.productId, quantity: "7", unitCost: "10000" }], idempotencyKey: crypto.randomUUID() });
    expect(r).toMatchObject({ credited: 50000, debt: 0, uncredited: 20000 });
    await expect(c.returnGoods({ supplyId, items: [{ productId: s.productId, quantity: "5" }], idempotencyKey: crypto.randomUUID() }))
      .rejects.toThrow(/свободно 3/);
  });
});

describe.skipIf(!hasRealDb)("возврат поставщику — со склада приёмки", () => {
  let db: ServiceDb;
  let s: Seeded;
  let supplierId: number;
  let ceoId: number;
  let branch: number;

  beforeAll(async () => { db = await connectRealDb(); }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    const d = db as any;
    const [sup] = await d.insert(schema.suppliers).values({ tenantId: s.tenantId, name: "Завод", paymentTermsDays: 10 });
    supplierId = Number(sup.insertId);
    const [ceo] = await d.insert(schema.users).values({ tenantId: s.tenantId, name: "Директор", email: "ceo-return@test.local", passwordHash: "x", role: "ceo" });
    ceoId = Number(ceo.insertId);
    // Склад приёмки — не точка продаж: возврат с него не зависит от продажи.
    const [wh] = await d.insert(schema.warehouses).values({ tenantId: s.tenantId, name: "Филиал", isDefault: false });
    branch = Number(wh.insertId);
  });

  const rows = async <T,>(q: ReturnType<typeof sql>): Promise<T[]> => ((await (db as any).execute(q)) as [T[]])[0];
  const stockAt = async (warehouseId: number) =>
    Number((await rows<{ c: string }>(sql`SELECT current_stock AS c FROM warehouse_stock WHERE product_id = ${s.productId} AND warehouse_id = ${warehouseId}`))[0]?.c ?? 0);
  const asOperator = () => ctxFor(db, s.tenantId, s.agentId, "operator");

  it("склад приёмки: приход по заказу на филиал — возврат без склада уходит с филиала", async () => {
    const po = (await import("../../purchase-order-router")).purchaseOrderRouter;
    const op = po.createCaller(asOperator());
    const { id } = await op.create({ supplierId, currency: "UZS", warehouseId: branch, items: [{ productId: s.productId, quantity: "10", unitPrice: "80" }] });
    await po.createCaller(ctxFor(db, s.tenantId, ceoId, "ceo")).approve({ id });
    const { arrivalId } = await op.receive({ id, arrivalDate: "2026-10-01" });
    const arr = (await import("../../arrival-router")).arrivalRouter.createCaller(asOperator());
    await arr.setItems({ id: arrivalId, items: [{ productId: s.productId, quantity: "10", expectedQuantity: "10", costPrice: "80.00" }] });
    await arr.update({ id: arrivalId, status: "completed" });
    expect([await stockAt(branch), await stockAt(s.warehouseId)]).toEqual([10, 10]);

    const sup = (await import("../../supplier-router")).supplierRouter.createCaller(asOperator());
    const [supply] = await rows<{ id: number }>(sql`SELECT id FROM supplies WHERE arrival_id = ${arrivalId}`);
    // Форма называет склад, с которого уйдёт товар.
    const list = await sup.supplies({ supplierId });
    expect(list.data.find(r => r.id === Number(supply.id))?.receivedWarehouseName).toBe("Филиал");

    // Ровно то, что шлёт форма возврата: без склада.
    await sup.returnGoods({ supplyId: Number(supply.id), items: [{ productId: s.productId, quantity: "3" }], notes: "брак", idempotencyKey: crypto.randomUUID() });
    expect([await stockAt(branch), await stockAt(s.warehouseId)]).toEqual([7, 10]);
    const [move] = await rows<{ w: number }>(sql`SELECT warehouse_id AS w FROM stock_movements WHERE reference_type = 'supplier_return'`);
    expect(Number(move.w)).toBe(branch);
  });

  it("склад приёмки: обычный приход, проведённый на филиал, помнит склад — возврат с него же", async () => {
    const arr = (await import("../../arrival-router")).arrivalRouter.createCaller(asOperator());
    const created = await arr.create({
      arrivalDate: "2026-10-01",
      items: [{ productId: s.productId, quantity: "5", costPrice: "80.00" }],
      supplier: { supplierId, amount: "400.00", currency: "UZS" },
    });
    const arrivalId = Number(created.id);
    await arr.update({ id: arrivalId, status: "completed", warehouseId: branch });
    const [a] = await rows<{ w: number | null }>(sql`SELECT warehouse_id AS w FROM arrivals WHERE id = ${arrivalId}`);
    expect(Number(a.w)).toBe(branch);
    expect(await stockAt(branch)).toBe(5);

    const sup = (await import("../../supplier-router")).supplierRouter.createCaller(asOperator());
    const [supply] = await rows<{ id: number }>(sql`SELECT id FROM supplies WHERE arrival_id = ${arrivalId}`);
    await sup.returnGoods({ supplyId: Number(supply.id), items: [{ productId: s.productId, quantity: "2" }], idempotencyKey: crypto.randomUUID() });
    expect([await stockAt(branch), await stockAt(s.warehouseId)]).toEqual([3, 10]);
  });

  it("поставка без склада в приходе — возврат с основного, как раньше; явный склад — с него", async () => {
    const d = db as any;
    const [sp] = await d.insert(schema.supplies).values({
      tenantId: s.tenantId, supplierId, supplyNumber: "SUP-R-2", amount: "5000.00", currency: "UZS", supplyDate: new Date("2026-09-01"),
    });
    const sup = (await import("../../supplier-router")).supplierRouter.createCaller(asOperator());
    await sup.returnGoods({ supplyId: Number(sp.insertId), items: [{ productId: s.productId, quantity: "1" }], idempotencyKey: crypto.randomUUID() });
    expect(await stockAt(s.warehouseId)).toBe(9);
    // Явный склад, где товара нет, — отказ «свободно 0», а не тихое списание с основного.
    await expect(sup.returnGoods({ supplyId: Number(sp.insertId), warehouseId: branch, items: [{ productId: s.productId, quantity: "1" }], idempotencyKey: crypto.randomUUID() }))
      .rejects.toThrow(/свободно 0/);
    expect((await sup.supplies({ supplierId })).data.find(r => r.id === Number(sp.insertId))?.receivedWarehouseName).toBeNull();
  });
});
