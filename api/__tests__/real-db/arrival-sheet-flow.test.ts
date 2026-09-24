import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, stockOf, countOf, type ServiceDb, type Seeded } from "./harness";

/**
 * Приход по накладной → разгрузка → проведение, на настоящей базе.
 *
 * Приход заводят по бумаге поставщика до разгрузки: «пришло» ещё нулём.
 * При разгрузке строки правятся целиком (setItems) — вписывают, сколько
 * приехало. Проведение кладёт на склад только приехавшее: строка с нулём
 * остаток, цену карточки и журнал движений не трогает. Проведённый приход
 * не правится; товар дважды в одном приходе — отказ.
 */
function ctxFor(db: ServiceDb, tenantId: number, userId: number): any {
  return {
    req: new Request("http://localhost/"), resHeaders: new Headers(), db,
    user: { id: userId, tenantId, role: "operator", status: "active" as const, name: "Оператор", email: "op@test.local", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test-co", name: "Тестовая компания", plan: "pro" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
  };
}
const today = () => new Date().toISOString().slice(0, 10);

describe.skipIf(!hasRealDb)("приход по накладной: разгрузка сеткой и проведение", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); s = await seed("10.000"); });

  const caller = async () => (await import("../../arrival-router")).arrivalRouter.createCaller(ctxFor(db, s.tenantId, s.agentId));
  const priceOf = async (id: number) => (await db.select({ c: schema.products.costPrice, u: schema.products.unitPrice }).from(schema.products).where(eq(schema.products.id, id)))[0]!;

  it("по накладной → вписали пришедшее → провели: на склад только приехавшее", async () => {
    const c = await caller();
    const { id } = await c.create({
      arrivalDate: today(), fuelCost: "0.00", tollCost: "0.00", otherCost: "0.00",
      items: [
        { productId: s.productId, quantity: "0", expectedQuantity: "10", costPrice: "90.00" },
        { productId: s.secondProductId, quantity: "0", expectedQuantity: "5", sellingPrice: "999.00" },
      ],
    });
    expect(await countOf("arrival_items", `arrival_id = ${id} AND quantity = 0`)).toBe(2);

    // Разгрузка: первого приехало 8 из 10, второго — ничего.
    await c.setItems({ id, items: [
      { productId: s.productId, quantity: "8", expectedQuantity: "10", costPrice: "90.00" },
      { productId: s.secondProductId, quantity: "0", expectedQuantity: "5", sellingPrice: "999.00" },
    ] });
    const doc = (await c.getById({ id }))!;
    expect(doc.items.map(i => [i.productId, i.quantity, i.expectedQuantity])).toEqual([[s.productId, 8, 10], [s.secondProductId, 0, 5]]);
    expect(doc.items[0].unit).toBeTruthy();

    const secondBefore = await priceOf(s.secondProductId);
    await c.update({ id, status: "completed" });
    expect((await stockOf(s.productId)).current).toBe(18);
    expect((await stockOf(s.secondProductId)).current).toBe(10);
    expect(Number((await priceOf(s.productId)).c)).toBe(90);
    // Не приехавшее не двигает ни цену карточки, ни журнал.
    expect(await priceOf(s.secondProductId)).toEqual(secondBefore);
    expect(await countOf("stock_movements", `reference_id = ${id} AND product_id = ${s.secondProductId}`)).toBe(0);

    await expect(c.setItems({ id, items: [{ productId: s.productId, quantity: "1" }] })).rejects.toThrow(/проведён/);
  });

  it("товар дважды — отказ; пустая строка и отрицательное — отказ схемой", async () => {
    const c = await caller();
    const { id } = await c.create({ arrivalDate: today(), fuelCost: "0.00", tollCost: "0.00", otherCost: "0.00", items: [{ productId: s.productId, quantity: "1" }] });
    await expect(c.setItems({ id, items: [{ productId: s.productId, quantity: "1" }, { productId: s.productId, quantity: "2" }] })).rejects.toThrow(/дважды/);
    await expect(c.setItems({ id, items: [{ productId: s.productId, quantity: "0" }] })).rejects.toThrow(/ни количества/);
    await expect(c.setItems({ id, items: [{ productId: s.productId, quantity: "-1" }] })).rejects.toThrow();
    // Отказ ничего не стёр: строка на месте.
    expect(await countOf("arrival_items", `arrival_id = ${id}`)).toBe(1);
  });
});
