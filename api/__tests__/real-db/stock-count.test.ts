import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, stockOf, countOf, type ServiceDb, type Seeded } from "./harness";

/**
 * Инвентаризация как документ — на настоящей базе, потому что суть в том,
 * что происходит с остатком при применении: setStock через дверь (резерв
 * обрезается, партии подрезаются), движение «инвентаризация» на разницу,
 * непосчитанные строки не тронуты, повторное применение невозможно.
 */
function ctxFor(db: ServiceDb, tenantId: number, userId: number): any {
  return {
    req: new Request("http://localhost/"), resHeaders: new Headers(), db,
    user: { id: userId, tenantId, role: "operator", status: "active" as const, name: "Оператор", email: "op@test.local", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test-co", name: "Тестовая компания", plan: "pro" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
  };
}

describe.skipIf(!hasRealDb)("инвентаризация на настоящей базе", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); }, 120_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); s = await seed("10.000"); });

  const caller = async () => (await import("../../stock-count-router")).stockCountRouter.createCaller(ctxFor(db, s.tenantId, s.agentId));

  it("черновик снимает остатки; применение ставит посчитанное, пишет движение, непосчитанное не трогает", async () => {
    const c = await caller();
    const { id, number } = await c.create({ warehouseId: s.warehouseId });
    expect(number).toBe("ИНВ-1");

    const doc = await c.get({ id });
    const mine = doc.items.find(i => i.productId === s.productId)!;
    expect(Number(mine.expected)).toBe(10);
    expect(mine.counted).toBeNull();

    // резерв 4 из 10: после пересчёта в 7 резерв остаётся 4, available 3
    await db.execute(sql`UPDATE warehouse_stock SET reserved = 4, available = 6 WHERE product_id = ${s.productId}`);

    await c.setCounted({ id, productId: s.productId, counted: 7 });
    // второй товар не считали — его строка остаётся как была
    const r = await c.applyCount({ id });
    expect(r).toMatchObject({ applied: 1, changed: 1, surplus: 0, shortage: 3 });

    const st = await stockOf(s.productId);
    expect(st.current).toBe(7);
    expect(st.reserved).toBe(4);
    expect(st.available).toBe(3);
    const second = await stockOf(s.secondProductId);
    expect(second.current).toBe(10);

    expect(await countOf("stock_movements", `reference_type = 'inventory' AND reference_id = ${id}`)).toBe(1);
    const [rows] = await db.execute(sql`SELECT type, quantity FROM stock_movements WHERE reference_type = 'inventory'`) as unknown as [Array<{ type: string; quantity: string }>];
    expect(rows[0]).toMatchObject({ type: "out", quantity: "3.00" });

    const after = await c.get({ id });
    expect(after.status).toBe("applied");
    await expect(c.applyCount({ id })).rejects.toThrow(/уже применён/);
    await expect(c.setCounted({ id, productId: s.productId, counted: 1 })).rejects.toThrow(/уже применён/);
  });

  it("сканер прибавляет по единице; пересчёт «нашёл больше» — движение in", async () => {
    const c = await caller();
    const { id } = await c.create({ warehouseId: s.warehouseId });
    await c.setCounted({ id, productId: s.productId, delta: 1 });
    await c.setCounted({ id, productId: s.productId, delta: 1 });
    const r1 = await c.setCounted({ id, productId: s.productId, delta: 1 });
    expect(r1.counted).toBe(3);
    await c.setCounted({ id, productId: s.productId, counted: 12 });
    const r = await c.applyCount({ id });
    expect(r).toMatchObject({ changed: 1, surplus: 2, shortage: 0 });
    expect((await stockOf(s.productId)).current).toBe(12);
  });

  it("чужая организация документа не видит; отмена черновика остаток не трогает", async () => {
    const c = await caller();
    const { id } = await c.create({ warehouseId: s.warehouseId });
    const foreign = (await import("../../stock-count-router")).stockCountRouter.createCaller(ctxFor(db, s.otherTenantId, s.agentId));
    await expect(foreign.get({ id })).rejects.toThrow(/не найдена/);
    await c.setCounted({ id, productId: s.productId, counted: 1 });
    await c.cancel({ id });
    expect((await stockOf(s.productId)).current).toBe(10);
    expect((await c.get({ id })).status).toBe("cancelled");
  });
});
