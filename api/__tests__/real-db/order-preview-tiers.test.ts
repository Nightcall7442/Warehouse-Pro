import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import * as schema from "@db/schema";
import { priceAt } from "@contracts/price-tiers";
import { cache } from "../../lib/cache";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

/**
 * Предпросмотр заказа считает ту же цену, что заказ.
 *
 * Каталог отдавал экрану цену при количестве 1, а заказ сервер считал по
 * ступени «от N»: «Итог» и офлайн-итог расходились с накладной. Теперь
 * каталог отдаёт ступени, и экран выбирает цену тем же pickTier — здесь это
 * сверено на настоящей базе: priceAt(каталог) === resolvePrices(заказ) на
 * каждом количестве, включая дробное.
 *
 * Нарочные поломки: не отдавай tiers из resolveCatalog — падает «совпадает
 * с заказом»; верни в pickTier фильтр «порог ≤ количества» без исключения
 * для порога ≤ 1 — падает «полкило».
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

describe.skipIf(!hasRealDb)("предпросмотр заказа: ступени цены", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  // Каталог кэшируется по организации, а номера после TRUNCATE повторяются.
  beforeEach(async () => { await truncateAll(); cache.invalidatePrefix("products:"); s = await seed("100.000"); });

  const list = async (priority: number) => Number((await db.insert(schema.priceLists).values({ tenantId: s.tenantId, name: `Список ${priority}`, priority, isActive: true } as never))[0].insertId);
  const row = (priceListId: number, minQuantity: string, price: string) =>
    db.insert(schema.priceListItems).values({ priceListId, productId: s.productId, minQuantity, price } as never);
  const assign = (priceListId: number) => db.insert(schema.priceListAssignments).values({ priceListId, shopId: s.shopId } as never);
  const catalog = async () => {
    const r = await (await import("../../product-router")).productRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "agent")).listAll({ shopId: s.shopId });
    return r.find(p => Number(p.id) === s.productId)!;
  };
  const order = async (quantity: number) => {
    const { resolvePrices } = await import("../../services/price-resolver");
    return (await resolvePrices(db as never, s.tenantId, s.shopId, [{ productId: s.productId, quantity }], new Map([[s.productId, "100.00"]]))).get(s.productId)!.price;
  };

  it("каталог отдаёт ступени, и цена на экране совпадает с заказом на любом количестве", async () => {
    const id = await list(0);
    await row(id, "1.00", "90.00");
    await row(id, "10.00", "84.00");
    await row(id, "50.00", "80.00");
    await assign(id);

    const p = await catalog();
    expect(p.unitPrice).toBe("90.00");
    expect(p.tiers, "каталог не отдал ступени — экран покажет цену от одной штуки").not.toBeNull();
    for (const q of [1, 9, 10, 12, 49, 50, 60]) {
      expect(priceAt(p.unitPrice, p.tiers, q), `количество ${q}`).toBe(await order(q));
    }
    expect([priceAt(p.unitPrice, p.tiers, 12), priceAt(p.unitPrice, p.tiers, 60)]).toEqual(["84.00", "80.00"]);
  });

  it("product.list (правка состава заказа) отдаёт те же ступени, а priceList.getPrice считает как заказ", async () => {
    const id = await list(0);
    await row(id, "1.00", "90.00");
    await row(id, "10.00", "84.00");
    await assign(id);
    const listed = (await (await import("../../product-router")).productRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "operator")).list({ shopId: s.shopId, pageSize: 500 }))
      .data.find(p => Number(p.id) === s.productId)!;
    expect(listed.tiers, "product.list не отдал ступени — правка состава покажет цену одной штуки").not.toBeNull();
    const plr = (await import("../../price-list-router")).priceListRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "agent"));
    for (const q of [1, 12, 0.5]) {
      expect(priceAt(listed.unitPrice, listed.tiers, q), `list, количество ${q}`).toBe(await order(q));
      expect((await plr.getPrice({ productId: s.productId, shopId: s.shopId, quantity: q })).price, `getPrice, количество ${q}`).toBe(await order(q));
    }
    // Магазин без списка — карточка и source «default».
    await db.delete(schema.priceListAssignments);
    expect(await plr.getPrice({ productId: s.productId, shopId: s.shopId, quantity: 12 })).toEqual({ price: "100.00", source: "default" });
  });

  it("полкило — по цене от одной штуки из списка, а не по карточке", async () => {
    const id = await list(0);
    await row(id, "1.00", "90.00");
    await assign(id);
    expect(await order(0.5), "дробное количество ушло мимо прайс-листа").toBe("90.00");
    const p = await catalog();
    expect(p.tiers, "у товара без ступеней «от N» ступени не нужны").toBeNull();
    expect(priceAt(p.unitPrice, p.tiers, 0.5)).toBe(await order(0.5));
  });

  it("ступень без цены от одной штуки: ниже порога — правило списка, выше — ступень", async () => {
    const id = await list(0);
    await db.update(schema.priceLists).set({ markupPct: "-10.00" } as never);
    await row(id, "20.00", "70.00");
    await assign(id);
    const p = await catalog();
    expect(p.unitPrice).toBe("90.00"); // 100 − 10 %
    for (const q of [1, 19, 20, 25]) expect(priceAt(p.unitPrice, p.tiers, q), `количество ${q}`).toBe(await order(q));
  });

  it("два списка: побеждает приоритет, даже если у младшего есть ступень", async () => {
    const hi = await list(5);
    const lo = await list(1);
    await row(hi, "1.00", "95.00");
    await row(lo, "10.00", "60.00");
    await assign(hi);
    await assign(lo);
    const p = await catalog();
    for (const q of [1, 10, 30]) expect(priceAt(p.unitPrice, p.tiers, q), `количество ${q}`).toBe(await order(q));
    expect(await order(30)).toBe("95.00");
  });
});
