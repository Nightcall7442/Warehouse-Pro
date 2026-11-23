/**
 * Полевой оформляет заказ только по прайс-листу своего магазина.
 *
 * Решение владельца 23.11.2026 (бизнес-аудит 19.11.2026, п. 10): агент ставил
 * розничной точке «Опт VIP» и так давал скидку мимо порога полевой скидки.
 * Офис по-прежнему выбирает любой список организации.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as schema from "@db/schema";
import { OrderService } from "../../services/order";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

describe.skipIf(!hasRealDb)("прайс-лист полевого — только магазина", () => {
  let db: ServiceDb;
  let s: Seeded;
  let shopList: number;
  let vip: number;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("100.000");
    const [a] = await db.insert(schema.priceLists).values({ tenantId: s.tenantId, name: "Розница", priority: 1, isActive: true, markupPct: "0.00" } as never);
    shopList = Number(a.insertId);
    await db.insert(schema.priceListAssignments).values({ priceListId: shopList, shopId: s.shopId } as never);
    const [b] = await db.insert(schema.priceLists).values({ tenantId: s.tenantId, name: "Опт VIP", priority: 5, isActive: true, markupPct: "-40.00" } as never);
    vip = Number(b.insertId);
  });

  const order = (priceListId: number, shopPriceListsOnly: boolean, key: string) => OrderService.create(db, s.tenantId, s.agentId, {
    shopId: s.shopId, items: [{ productId: s.productId, quantity: "2" }], priceListId, shopPriceListsOnly, idempotencyKey: key,
  });

  it("чужой магазину список полевому — отказ; список магазина — проходит", async () => {
    await expect(order(vip, true, "f-1")).rejects.toThrow(/не привязан к магазину/);
    await expect(order(shopList, true, "f-2")).resolves.toBeTruthy();
  });

  it("офис выбирает любой список", async () => {
    await expect(order(vip, false, "o-1")).resolves.toBeTruthy();
  });

  it("форма заказа: полевому — только списки магазина, офису — все", async () => {
    const { priceListRouter } = await import("../../price-list-router");
    const asAgent = await priceListRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "agent")).forShop({ shopId: s.shopId });
    expect(asAgent.lists.map(l => l.name)).toEqual(["Розница"]);
    const asOffice = await priceListRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "operator")).forShop({ shopId: s.shopId });
    expect(asOffice.lists.map(l => l.name)).toEqual(["Опт VIP", "Розница"]);
  });

  it("ручка создания заказа ставит правило всем, кроме офиса", () => {
    const src = readFileSync("api/order-router.ts", "utf-8");
    expect(src).toContain('shopPriceListsOnly: !["ceo", "operator"].includes(ctx.user.role)');
  });
});
