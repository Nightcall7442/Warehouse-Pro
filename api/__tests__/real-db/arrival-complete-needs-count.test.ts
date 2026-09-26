import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, stockOf, countOf, type ServiceDb, type Seeded } from "./harness";

/**
 * Приход, где ничего не посчитано, не проводится — на настоящей базе.
 *
 * Приход по накладной заводят нулями в «Пришло». Раньше проведение такого
 * документа проходило: на склад не ложилось ничего, статус становился
 * «проведён», и дальше строки не правились, а приход не удалялся —
 * разгруженный товар внести было некуда, долг поставщику висел на пустом
 * документе. Теперь отказ, и документ остаётся живым: после отказа строки
 * правятся, и проведение с посчитанной строкой проходит.
 */
function ctxFor(db: ServiceDb, tenantId: number, userId: number): any {
  return {
    req: new Request("http://localhost/"), resHeaders: new Headers(), db,
    user: { id: userId, tenantId, role: "operator", status: "active" as const, name: "Оператор", email: "op@test.local", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test-co", name: "Тестовая компания", plan: "pro" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
  };
}
const today = () => new Date().toISOString().slice(0, 10);

describe.skipIf(!hasRealDb)("проведение прихода без посчитанных строк", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); s = await seed("10.000"); });

  const caller = async () => (await import("../../arrival-router")).arrivalRouter.createCaller(ctxFor(db, s.tenantId, s.agentId));
  const statusOf = async (id: number) => (await db.select({ st: schema.arrivals.status }).from(schema.arrivals).where(eq(schema.arrivals.id, id)))[0]!.st;

  it("все нулём — отказ; ни остатка, ни движений, ни статуса; после пересчёта проводится", async () => {
    const c = await caller();
    const { id } = await c.create({
      arrivalDate: today(), fuelCost: "0.00", tollCost: "0.00", otherCost: "0.00",
      items: [
        { productId: s.productId, quantity: "0", expectedQuantity: "10", costPrice: "90.00" },
        { productId: s.secondProductId, quantity: "0", expectedQuantity: "5" },
      ],
      supplier: { newSupplierName: "Завод", amount: "900000", currency: "UZS" },
    });
    await c.update({ id, status: "unloading" });

    await expect(c.update({ id, status: "completed" })).rejects.toMatchObject({
      code: "BAD_REQUEST", message: expect.stringMatching(/Ничего не посчитано/),
    });
    expect(await statusOf(id)).toBe("unloading");
    expect((await stockOf(s.productId)).current).toBe(10);
    expect((await stockOf(s.secondProductId)).current).toBe(10);
    expect(await countOf("stock_movements", `reference_type = 'arrival' AND reference_id = ${id}`)).toBe(0);

    // Документ жив: строки правятся, проведение с посчитанной строкой проходит.
    await c.setItems({ id, items: [
      { productId: s.productId, quantity: "8", expectedQuantity: "10", costPrice: "90.00" },
      { productId: s.secondProductId, quantity: "0", expectedQuantity: "5" },
    ] });
    await c.update({ id, status: "completed" });
    expect(await statusOf(id)).toBe("completed");
    expect((await stockOf(s.productId)).current).toBe(18);
    expect((await stockOf(s.secondProductId)).current).toBe(10);
  });

  it("приход совсем без строк — тоже отказ, и его можно удалить", async () => {
    const c = await caller();
    const { id } = await c.create({ arrivalDate: today(), fuelCost: "0.00", tollCost: "0.00", otherCost: "0.00" });
    await expect(c.update({ id, status: "completed" })).rejects.toThrow(/Ничего не посчитано/);
    expect(await statusOf(id)).toBe("pending");
    await c.delete({ id });
    expect(await countOf("arrivals", `id = ${id}`)).toBe(0);
  });
});
