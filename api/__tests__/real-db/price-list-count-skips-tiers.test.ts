/**
 * «N товаров» в списке прайс-листов — на настоящей базе.
 *
 * 27.09.2026: счётчик считал все строки списка вместе со ступенями «от N»:
 * товар с ценой от одной штуки и ступенями «от 10 / от 50» шёл за три, а
 * страница списка показывала «1 своя цена». Теперь — товары со своей ценой
 * от одной штуки, как на странице.
 *
 * Нарочная поломка: убери «AND pli.min_quantity <= 1» из itemCount — тест падает.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded, ctxFor } from "./harness";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));


describe.skipIf(!hasRealDb)("счётчик товаров прайс-листа", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); s = await seed("100.000"); });

  it("ступени «от N» не считаются новыми товарами; товар только со ступенями — не своя цена", async () => {
    const c = (await import("../../price-list-router")).priceListRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "ceo"));
    const [ins] = await db.insert(schema.priceLists).values({ tenantId: s.tenantId, name: "Опт", priority: 0, isActive: true } as never);
    const id = Number(ins.insertId);

    await c.setItems({ priceListId: id, items: [{ productId: s.productId, price: 90 }] });
    await c.upsertItem({ priceListId: id, productId: s.productId, price: 85, minQuantity: 10 });
    await c.upsertItem({ priceListId: id, productId: s.productId, price: 80, minQuantity: 50 });
    // У второго товара — только ступень: цена от одной штуки у него карточки.
    await c.upsertItem({ priceListId: id, productId: s.secondProductId, price: 200, minQuantity: 10 });

    const row = (await c.list()).find(r => Number(r.id) === id)!;
    expect(Number(row.itemCount)).toBe(1);
  });
});
