import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { cache } from "../../lib/cache";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded, ctxFor } from "./harness";

/**
 * Приход на настоящей базе: версия строк, шапка проведённого, товар в пути.
 *
 *   · setItems с версией, которую уже сменила чужая правка, — CONFLICT, и
 *     посчитанное первым цело; версия сдвигается даже в ту же секунду;
 *   · шапку проведённого прихода (топливо → итог в P&L) не переписать;
 *   · прогноз видит в пути строку «по накладной», где «пришло» ещё ноль.
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

const today = () => new Date().toISOString().slice(0, 10);

describe.skipIf(!hasRealDb)("приход: версия строк, проведённая шапка, товар в пути", () => {
  let s: Seeded;

  beforeAll(async () => { current = await connectRealDb(); }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  // Прогноз кэшируется по организации, а номера организаций после TRUNCATE
  // повторяются: без сброса второй тест читал бы ответ первого.
  beforeEach(async () => { await truncateAll(); cache.invalidatePrefix("forecast:"); s = await seed("10.000"); });

  const caller = async () => (await import("../../arrival-router")).arrivalRouter.createCaller(ctxFor(current, s.tenantId, s.agentId));
  const itemsOf = async (id: number) => (await current.select({ p: schema.arrivalItems.productId, q: schema.arrivalItems.quantity })
    .from(schema.arrivalItems).where(eq(schema.arrivalItems.arrivalId, id))).map(r => [r.p, Number(r.q)]).sort();

  it("чужая версия — CONFLICT, посчитанное первым цело; своя — проходит", async () => {
    const c = await caller();
    const { id } = await c.create({
      arrivalDate: today(), fuelCost: "0.00", tollCost: "0.00", otherCost: "0.00",
      items: [{ productId: s.productId, quantity: "0", expectedQuantity: "40" }, { productId: s.secondProductId, quantity: "0", expectedQuantity: "20" }],
    });
    const opened = (await c.getById({ id }))!.updatedAt;

    // Первый оператор — в ту же секунду, что и создание: версия всё равно сдвигается.
    await c.setItems({ id, updatedAt: opened, items: [{ productId: s.productId, quantity: "40", expectedQuantity: "40" }, { productId: s.secondProductId, quantity: "0", expectedQuantity: "20" }] });
    const counted = await itemsOf(id);

    await expect(c.setItems({ id, updatedAt: opened, items: [{ productId: s.productId, quantity: "0", expectedQuantity: "40" }, { productId: s.secondProductId, quantity: "20", expectedQuantity: "20" }] }))
      .rejects.toMatchObject({ code: "CONFLICT", message: "Документ изменили, пока вы правили — обновите страницу" });
    expect(await itemsOf(id), "чужой набор затёр посчитанное").toEqual(counted);

    const fresh = (await c.getById({ id }))!.updatedAt;
    expect(fresh.getTime()).toBeGreaterThan(opened.getTime());
    await c.setItems({ id, updatedAt: fresh, items: [{ productId: s.productId, quantity: "40", expectedQuantity: "40" }, { productId: s.secondProductId, quantity: "20", expectedQuantity: "20" }] });
    expect(await itemsOf(id)).toEqual([[s.productId, 40], [s.secondProductId, 20]].sort());
  });

  it("шапка проведённого не правится: расход и итог в P&L прежние", async () => {
    const c = await caller();
    const { id } = await c.create({
      arrivalDate: today(), fuelCost: "100.00", tollCost: "0.00", otherCost: "0.00",
      items: [{ productId: s.productId, quantity: "5", costPrice: "90.00" }],
    });
    await c.update({ id, status: "completed" });

    await expect(c.update({ id, fuelCost: "999.00" })).rejects.toMatchObject({
      code: "BAD_REQUEST", message: expect.stringMatching(/шапка не правится/),
    });
    const [row] = await current.select({ fuel: schema.arrivals.fuelCost, total: schema.arrivals.totalExpense })
      .from(schema.arrivals).where(eq(schema.arrivals.id, id));
    expect(Number(row!.fuel)).toBe(100);
    expect(Number(row!.total)).toBe(100);
  });

  it("в пути — и строка «по накладной» с нулём в «пришло»; посчитанное важнее бумаги", async () => {
    const c = await caller();
    await c.create({
      arrivalDate: today(), fuelCost: "0.00", tollCost: "0.00", otherCost: "0.00",
      items: [{ productId: s.productId, quantity: "0", expectedQuantity: "100" }, { productId: s.secondProductId, quantity: "7", expectedQuantity: "10" }],
    });
    const { predictStockouts } = await import("../../services/stock-predictor");
    const byProduct = new Map((await predictStockouts(s.tenantId, 29)).map(p => [p.productId, p.pendingArrivals]));
    expect(byProduct.get(s.productId), "товар по накладной не виден в пути").toBe(100);
    expect(byProduct.get(s.secondProductId)).toBe(7);
  });

  it("в пути и во время разгрузки: на склад ещё ничего не легло", async () => {
    const c = await caller();
    const { id } = await c.create({
      arrivalDate: today(), fuelCost: "0.00", tollCost: "0.00", otherCost: "0.00",
      items: [{ productId: s.productId, quantity: "0", expectedQuantity: "60" }],
    });
    await c.update({ id, status: "unloading" });
    const { predictStockouts } = await import("../../services/stock-predictor");
    const byProduct = new Map((await predictStockouts(s.tenantId, 29)).map(p => [p.productId, p.pendingArrivals]));
    expect(byProduct.get(s.productId), "товар у ворот выпал из «в пути»").toBe(60);
  });
});
