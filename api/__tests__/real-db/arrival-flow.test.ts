import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, stockOf, countOf, type ServiceDb, type Seeded } from "./harness";

/**
 * Приход через роутер на настоящей базе: создать с партией и поставщиком →
 * провести → остаток и партия на месте, повтор проведения — отказ, удалить
 * проведённый нельзя, черновик уходит вместе со строками и поставкой.
 * Раньше это лежало в роутере (services/arrival.ts теперь) и проверялось
 * только подделкой; здесь — настоящий tRPC-вызов и настоящие ключи.
 */
function ctxFor(db: ServiceDb, tenantId: number, userId: number): any {
  return {
    req: new Request("http://localhost/"), resHeaders: new Headers(), db,
    user: { id: userId, tenantId, role: "operator", status: "active" as const, name: "Оператор", email: "op@test.local", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test-co", name: "Тестовая компания", plan: "pro" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
  };
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!hasRealDb)("приход: создать → провести → удалить", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); s = await seed("10.000"); });

  const caller = async () => (await import("../../arrival-router")).arrivalRouter.createCaller(ctxFor(db, s.tenantId, s.agentId));

  it("проведение кладёт остаток через дверь, партию с себестоимостью и заводит поставку; повтор — отказ", async () => {
    const c = await caller();
    const { id } = await c.create({
      arrivalDate: inDays(0), fuelCost: "0.00", tollCost: "0.00", otherCost: "0.00",
      items: [
        { productId: s.productId, quantity: "5", costPrice: "80.00", batchNumber: "L-1", expiresAt: inDays(30) },
        { productId: s.secondProductId, quantity: "3" },
      ],
      supplier: { newSupplierName: "Завод", amount: "640.00", currency: "UZS" },
    });
    expect(await countOf("arrival_items", `arrival_id = ${id}`)).toBe(2);
    expect(await countOf("supplies", `arrival_id = ${id}`)).toBe(1);
    // черновик остаток не трогает
    expect((await stockOf(s.productId)).current).toBe(10);

    const r = await c.update({ id, status: "completed" });
    expect(r).toMatchObject({ success: true });
    expect((await stockOf(s.productId)).current).toBe(15);
    expect((await stockOf(s.secondProductId)).current).toBe(13);
    const [[batch]] = await (db as any).execute(sql`SELECT quantity, cost_price AS cp FROM stock_batches WHERE product_id = ${s.productId} AND batch_number = 'L-1'`) as unknown as [Array<{ quantity: string; cp: string }>];
    expect(Number(batch.quantity)).toBe(5);
    expect(Number(batch.cp)).toBe(80);
    expect(await countOf("stock_movements", `reference_type = 'arrival' AND reference_id = ${id}`)).toBe(2);

    // повтор проведения (двойной клик, повтор запроса) — отказ, остаток не двоится
    await expect(c.update({ id, status: "completed" })).rejects.toThrow(/уже завершён/);
    expect((await stockOf(s.productId)).current).toBe(15);
    // и удалить проведённый нельзя
    await expect(c.delete({ id })).rejects.toThrow(/завершённый/);
  });

  it("срок годности раньше даты прихода — отказ; черновик удаляется со строками и поставкой", async () => {
    const c = await caller();
    await expect(c.create({
      arrivalDate: inDays(0), fuelCost: "0.00", tollCost: "0.00", otherCost: "0.00",
      items: [{ productId: s.productId, quantity: "1", batchNumber: "OLD", expiresAt: inDays(-1) }],
    })).rejects.toThrow(/раньше даты прихода/);

    const { id } = await c.create({
      arrivalDate: inDays(0), fuelCost: "0.00", tollCost: "0.00", otherCost: "0.00",
      items: [{ productId: s.productId, quantity: "2" }],
      supplier: { newSupplierName: "Завод", amount: "100.00", currency: "UZS" },
    });
    await c.delete({ id });
    expect(await countOf("arrivals", `id = ${id}`)).toBe(0);
    expect(await countOf("arrival_items", `arrival_id = ${id}`)).toBe(0);
    expect(await countOf("supplies", `arrival_id = ${id}`)).toBe(0);
    expect((await stockOf(s.productId)).current).toBe(10);
  });
});
