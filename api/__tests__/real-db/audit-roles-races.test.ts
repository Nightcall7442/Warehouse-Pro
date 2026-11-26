/**
 * Роли и гонки бизнес-аудита 19.11.2026 — на настоящей MySQL.
 *
 *   · агент не переносит чужой магазин в свою территорию (первую ставит);
 *   · долг по территориям курьеру не показывается;
 *   · ключей API у организации не больше MAX_KEYS;
 *   · курьер не проводит доставку заказа, который офис уже отменил;
 *   · завершённый за это время приход не удаляется.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { OrderService } from "../../services/order";
import { markDelivered, completeDelivery } from "../../services/courier-delivery";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, stockOf, type ServiceDb, type Seeded } from "./harness";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

describe.skipIf(!hasRealDb)("роли и гонки", () => {
  let db: ServiceDb;
  let s: Seeded;
  let ceoId: number;
  let terrA: number;
  let terrB: number;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    const [ceo] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Директор", email: "ceo@test.local", passwordHash: "x", role: "ceo" } as never);
    ceoId = Number(ceo.insertId);
    const [a] = await db.insert(schema.territories).values({ tenantId: s.tenantId, name: "Юг" } as never);
    const [b] = await db.insert(schema.territories).values({ tenantId: s.tenantId, name: "Север" } as never);
    terrA = Number(a.insertId); terrB = Number(b.insertId);
  });

  const agentApi = async () => (await import("../../agent-router")).agentRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "agent"));
  const territoryOf = async () => (await db.select({ t: schema.shops.territoryId }).from(schema.shops).where(eq(schema.shops.id, s.shopId)))[0].t;

  it("агент ставит территорию магазину без неё, но не переносит в другую", async () => {
    const agent = await agentApi();
    await agent.updateMyShop({ id: s.shopId, territoryId: terrA });
    expect(await territoryOf()).toBe(terrA);
    await expect(agent.updateMyShop({ id: s.shopId, territoryId: terrB })).rejects.toThrow(/может офис/);
    expect(await territoryOf()).toBe(terrA);
    // Та же территория и правка прочих полей — проходят.
    await agent.updateMyShop({ id: s.shopId, territoryId: terrA, phone: "+998901234567" });
  });

  it("долг по территориям: директору — сумма, курьеру — null", async () => {
    await db.update(schema.shops).set({ territoryId: terrA, debt: "1500.00" } as never).where(eq(schema.shops.id, s.shopId));
    const router = (await import("../../territory-router")).territoryRouter;
    const ceoRows = await router.createCaller(ctxFor(db, s.tenantId, ceoId, "ceo")).list();
    expect(Number(ceoRows.find(r => r.id === terrA)?.totalDebt)).toBe(1500);
    const courierRows = await router.createCaller(ctxFor(db, s.tenantId, s.courierId, "courier")).list();
    expect(courierRows.find(r => r.id === terrA)?.totalDebt).toBeNull();
    expect(courierRows.find(r => r.id === terrA)?.shopCount).toBeDefined();
  });

  it("ключей API не больше предела", async () => {
    const { apiKeyRouter, MAX_KEYS } = await import("../../api-key-router");
    const ceo = apiKeyRouter.createCaller(ctxFor(db, s.tenantId, ceoId, "ceo"));
    for (let i = 0; i < MAX_KEYS; i++) await ceo.create({ name: `k${i}`, scopes: ["read"] });
    await expect(ceo.create({ name: "лишний", scopes: ["read"] })).rejects.toThrow(/отзовите ненужный/);
  });

  describe("курьер и отменённый заказ", () => {
    let orderId: number;
    beforeEach(async () => {
      const r = await OrderService.create(db, s.tenantId, s.agentId, {
        shopId: s.shopId, paymentMethod: "cash", items: [{ productId: s.productId, quantity: "4" }],
      });
      orderId = (r as { id: number }).id;
      const operator = (await import("../../courier-router")).courierRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "operator"));
      await operator.assignCourier({ orderId, courierId: s.courierId });
      // Офис отменил заказ, а телефон курьера об этом ещё не знает:
      // доставка остаётся назначенной, как в момент гонки.
      await db.execute(sql`UPDATE orders SET status = 'cancelled' WHERE id = ${orderId}`);
    });

    it("«доставил» по отменённому заказу не проходит и товар не списывает", async () => {
      const before = await stockOf(s.productId);
      await expect(markDelivered(db as never, s.tenantId, s.courierId, { orderId })).rejects.toThrow();
      const [o] = await db.select({ status: schema.orders.status }).from(schema.orders).where(eq(schema.orders.id, orderId));
      expect(o.status).toBe("cancelled");
      expect((await stockOf(s.productId)).current).toBe(before.current);
    });

    it("«завершить доставку» по отменённому заказу не проходит", async () => {
      const before = await stockOf(s.productId);
      await expect(completeDelivery(db as never, s.tenantId, s.courierId, {
        orderId, result: "delivered_paid", paymentMethod: "cash", paidAmount: "400",
      } as never)).rejects.toThrow();
      expect((await stockOf(s.productId)).current).toBe(before.current);
    });
  });

  it("приход, который успели завершить, не удаляется", async () => {
    const [ar] = await db.insert(schema.arrivals).values({ tenantId: s.tenantId, arrivalNumber: "A-1", status: "pending", arrivalDate: "2026-11-20" } as never);
    const id = Number(ar.insertId);
    const { deleteArrival } = await import("../../services/arrival");
    // Проверка статуса видит черновик, а к записи приход уже проведён.
    let flipped = false;
    const racing = new Proxy(db as object, {
      get(target, prop, receiver) {
        if (prop === "transaction" && !flipped) {
          flipped = true;
          return async (fn: (tx: unknown) => Promise<unknown>) => {
            await db.execute(sql`UPDATE arrivals SET status = 'completed' WHERE id = ${id}`);
            return (db as any).transaction(fn);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    await expect(deleteArrival(racing as never, s.tenantId, id)).rejects.toThrow(/завершённый/);
    expect((await db.select({ id: schema.arrivals.id }).from(schema.arrivals).where(eq(schema.arrivals.id, id))).length).toBe(1);
  });
});
