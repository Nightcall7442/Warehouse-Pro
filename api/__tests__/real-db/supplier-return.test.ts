import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, stockOf, countOf, type ServiceDb, type Seeded } from "./harness";

/**
 * Возврат товара поставщику на настоящей базе: товар уходит со склада
 * движением supplier_return, долг по поставке гасится строкой «возврат
 * товара» по себестоимости — не больше остатка; повтор по ключу — дубль.
 */
function ctxFor(db: ServiceDb, tenantId: number, userId: number): any {
  return {
    req: new Request("http://localhost/"), resHeaders: new Headers(), db,
    user: { id: userId, tenantId, role: "operator", status: "active" as const, name: "Оператор", email: "op@test.local", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test-co", name: "Тестовая компания", plan: "pro" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
  };
}

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
