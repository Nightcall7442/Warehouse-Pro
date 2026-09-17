import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql, eq } from "drizzle-orm";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, stockOf, type ServiceDb, type Seeded } from "./harness";
import * as schema from "@db/schema";

/**
 * Себестоимость при приходе на настоящей базе (просьба Serena Trade).
 *
 * Товар лежит: 10 шт., себестоимость 55 000. Приход 10 шт. по 60 000:
 *   · «последняя закупка» (по умолчанию) — в карточке 60 000, журнала усреднения нет;
 *   · «средняя по остатку» — 57 500 (равные объёмы = «пополам»), журнал есть;
 *   · следующий приход 20 шт. по 50 000 при 20 на складе по 57 500 → 53 750;
 *   · приход без цены — карточка не трогается; партия хранит СВОЮ закупку.
 */
function ctxFor(db: ServiceDb, tenantId: number, userId: number): any {
  return {
    req: new Request("http://localhost/"), resHeaders: new Headers(), db,
    user: { id: userId, tenantId, role: "operator", status: "active" as const, name: "Оператор", email: "op@test.local", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test-co", name: "Тестовая компания", plan: "pro" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
  };
}
const today = () => new Date().toISOString().slice(0, 10);

describe.skipIf(!hasRealDb)("себестоимость при приходе: последняя / средняя", () => {
  let db: ServiceDb;
  let s: Seeded;
  beforeAll(async () => { db = await connectRealDb(); }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll(); s = await seed("10.000");
    await (db as any).update(schema.products).set({ costPrice: "55000.00" }).where(eq(schema.products.id, s.productId));
    await (db as any).insert(schema.settings).values({ tenantId: s.tenantId, companyName: "Тест" }).catch(() => {});
  });
  const caller = async () => (await import("../../arrival-router")).arrivalRouter.createCaller(ctxFor(db, s.tenantId, s.agentId));
  const cost = async () => Number((await (db as any).select({ c: schema.products.costPrice }).from(schema.products).where(eq(schema.products.id, s.productId)))[0].c);
  const arrive = async (qty: string, costPrice?: string) => {
    const c = await caller();
    const { id } = await c.create({ arrivalDate: today(), fuelCost: "0.00", tollCost: "0.00", otherCost: "0.00", items: [{ productId: s.productId, quantity: qty, ...(costPrice ? { costPrice } : {}) }] });
    await c.update({ id, status: "completed" });
    return id;
  };
  const averaged = async () => (await (db as any).execute(sql`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'product.cost_averaged'`) as any)[0][0].n;

  it("по умолчанию — последняя закупка: 60 000 и никакого усреднения", async () => {
    await arrive("10", "60000.00");
    expect(await cost()).toBe(60000);
    expect((await stockOf(s.productId)).current).toBe(20);
    expect(Number(await averaged())).toBe(0);
  });

  it("средняя по остатку: 57 500 → 53 750; без цены — не трогать; партия помнит свою закупку", async () => {
    await (db as any).update(schema.settings).set({ costMethod: "average" }).where(eq(schema.settings.tenantId, s.tenantId));
    await arrive("10", "60000.00");
    expect(await cost()).toBe(57500);
    expect(Number(await averaged())).toBe(1);
    await arrive("20", "50000.00");
    expect(await cost()).toBe(53750);
    await arrive("5");
    expect(await cost()).toBe(53750);
    expect((await stockOf(s.productId)).current).toBe(45);
    expect(Number(await averaged())).toBe(2);
    const c = await caller();
    const { id } = await c.create({ arrivalDate: today(), fuelCost: "0.00", tollCost: "0.00", otherCost: "0.00", items: [{ productId: s.productId, quantity: "4", costPrice: "70000.00", batchNumber: "B-7", expiresAt: today() }] });
    await c.update({ id, status: "completed" });
    const [[batch]] = await (db as any).execute(sql`SELECT cost_price AS cp FROM stock_batches WHERE batch_number = 'B-7'`) as unknown as [Array<{ cp: string }>];
    expect(Number(batch.cp)).toBe(70000);
    // (45 × 53 750 + 4 × 70 000) / 49 = 55 076.53
    expect(await cost()).toBe(55076.53);
  });
});
