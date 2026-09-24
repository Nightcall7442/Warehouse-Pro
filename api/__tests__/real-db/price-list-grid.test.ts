/**
 * Прайс-лист сеткой и магазины пачкой — на настоящей базе.
 *
 *   · setItems: ставит, меняет, убирает цену от одной штуки; ступени «от N»
 *     не трогает; то, что совпало с сохранённым, не пишется; след в журнале;
 *     цена списка доходит до заказа (resolvePrices);
 *   · setShops: отмеченные переезжают из прежнего списка организации,
 *     снятые остаются без списка; чужой магазин — отказ.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import {
  hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, countOf,
  type ServiceDb, type Seeded,
} from "./harness";

// Роутер ходит в getDb(), а не в ctx.db — подменяем на тестовую базу.
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

function ctxFor(db: ServiceDb, tenantId: number, userId: number): any {
  return {
    req: new Request("http://localhost/"), resHeaders: new Headers(), db,
    user: { id: userId, tenantId, role: "ceo", status: "active" as const, name: "Директор", email: "ceo@test.local", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test-co", name: "Тестовая компания", plan: "pro" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
  };
}

describe.skipIf(!hasRealDb)("прайс-лист сеткой", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); s = await seed("100.000"); });

  const caller = async () => (await import("../../price-list-router")).priceListRouter.createCaller(ctxFor(db, s.tenantId, s.agentId));
  const newList = async (name: string) => Number((await db.insert(schema.priceLists).values({ tenantId: s.tenantId, name, priority: 0, isActive: true } as never))[0].insertId);
  const itemsOf = async (listId: number) => (await db.select({ productId: schema.priceListItems.productId, price: schema.priceListItems.price, min: schema.priceListItems.minQuantity })
    .from(schema.priceListItems).where(eq(schema.priceListItems.priceListId, listId))).map(r => [Number(r.productId), r.price, r.min]).sort();

  it("цены: поставить, поменять, убрать; ступени целы; совпавшее не пишется; доходит до заказа", async () => {
    const c = await caller();
    const id = await newList("Опт");
    // Ступень «от 10» — её сетка не трогает.
    await db.insert(schema.priceListItems).values({ priceListId: id, productId: s.productId, minQuantity: "10.00", price: "70.00" } as never);

    let r = await c.setItems({ priceListId: id, items: [{ productId: s.productId, price: 90 }, { productId: s.secondProductId, price: 240 }] });
    expect(r).toMatchObject({ set: 2, cleared: 0 });
    expect(await itemsOf(id)).toEqual([[s.productId, "70.00", "10.00"], [s.productId, "90.00", "1.00"], [s.secondProductId, "240.00", "1.00"]].sort());

    // 90 → 90 не пишется; 240 → убрать.
    r = await c.setItems({ priceListId: id, items: [{ productId: s.productId, price: 90 }, { productId: s.secondProductId, price: null }] });
    expect(r).toMatchObject({ set: 0, cleared: 1 });
    expect(await itemsOf(id)).toEqual([[s.productId, "70.00", "10.00"], [s.productId, "90.00", "1.00"]].sort());
    expect(await countOf("audit_log", "action = 'price_list.items_set'")).toBe(2);

    // Магазину назначен — заказ считает по списку: от одной штуки 90, от десяти — ступень 70.
    await c.setShops({ priceListId: id, shopIds: [s.shopId] });
    const { resolvePrices } = await import("../../services/price-resolver");
    const priceFor = async (quantity: number) => (await resolvePrices(db as never, s.tenantId, s.shopId, [{ productId: s.productId, quantity }], new Map([[s.productId, "100.00"]]))).get(s.productId)?.price;
    expect(await priceFor(1)).toBe("90.00");
    expect(await priceFor(12)).toBe("70.00");
  });

  it("магазины: отмеченный переезжает из прежнего списка, снятый — без списка; чужой — отказ", async () => {
    const c = await caller();
    const a = await newList("А");
    const b = await newList("Б");
    const [sh2] = await db.insert(schema.shops).values({ tenantId: s.tenantId, name: "Второй магазин" } as never);
    const shop2 = Number(sh2.insertId);

    await c.setShops({ priceListId: a, shopIds: [s.shopId, shop2] });
    const r = await c.setShops({ priceListId: b, shopIds: [shop2] });
    expect(r).toMatchObject({ added: 1, removed: 0, moved: 1 });
    const where = (list: number) => db.select({ shopId: schema.priceListAssignments.shopId }).from(schema.priceListAssignments).where(eq(schema.priceListAssignments.priceListId, list));
    expect((await where(a)).map(x => Number(x.shopId))).toEqual([s.shopId]);
    expect((await where(b)).map(x => Number(x.shopId))).toEqual([shop2]);

    const off = await c.setShops({ priceListId: a, shopIds: [] });
    expect(off).toMatchObject({ added: 0, removed: 1 });
    expect(await countOf("price_list_assignments", `shop_id = ${s.shopId}`)).toBe(0);

    const [foreign] = await db.insert(schema.shops).values({ tenantId: s.otherTenantId, name: "Чужой" } as never);
    await expect(c.setShops({ priceListId: a, shopIds: [Number(foreign.insertId)] })).rejects.toThrow(/не найден/);
    await expect(c.setShops({ priceListId: a, shopIds: [999999] })).rejects.toThrow(/не найден/);
  });
});
