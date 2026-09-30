import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

/**
 * Фильтр «Курьер» в «Заказах» — вход courierId у order.list и order.stats.
 *
 * Что было: у списка заказов не было отбора по курьеру. Строка «На руках» в
 * «Контроле» вела на всю очередь «Ждут расчёта», и оператор выискивал в ней
 * заказы вернувшегося курьера глазами, чтобы принять их вечером.
 *
 * Что проверяется — на настоящей базе, через ручки:
 *   · order.list({ courierId }) отдаёт только заказы этого курьера — и в
 *     очереди «Ждут расчёта» (awaitingMoney), и без неё;
 *   · плитки (order.stats) считают тот же срез, что таблица;
 *   · без courierId — как было: все заказы;
 *   · агент с чужим courierId не видит больше своего: фильтр только сужает.
 *
 * Нарочная поломка (проверено): убрать условие courierId из OrderService.list
 * — падают «только его заказы» и «очередь курьера»; из order.stats — падает
 * «плитки — тот же срез».
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

describe.skipIf(!hasRealDb)("фильтр «Курьер» у списка заказов", () => {
  let db: ServiceDb;
  let s: Seeded;
  let otherCourier = 0;
  let n = 0;
  const ids: Record<string, number> = {};

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    const [c] = await (db as any).insert(schema.users).values({ tenantId: s.tenantId, name: "Второй курьер", email: "c2@test.local", passwordHash: "x", role: "courier" });
    otherCourier = Number(c.insertId);
    const order = async (key: string, courierId: number | null, status: string, closed = false) => {
      const [r] = await (db as any).insert(schema.orders).values({
        tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, courierId, orderNumber: `КФ-${++n}`,
        status, paymentMethod: "cash", subtotal: "100.00", total: "100.00", closedAt: closed ? new Date() : null,
      });
      ids[key] = Number(r.insertId);
    };
    await order("mineAwaiting", s.courierId, "delivered");
    await order("mineClosed", s.courierId, "delivered", true);
    await order("mineShipped", s.courierId, "shipped");
    await order("otherAwaiting", otherCourier, "delivered");
    await order("noCourier", null, "delivered");
  });

  const op = async () => (await import("../../order-router")).orderRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "operator"));
  const idsOf = (r: { data: Array<{ id: number }> }) => r.data.map(o => o.id).sort((a, b) => a - b);
  const sorted = (...keys: string[]) => keys.map(k => ids[k]).sort((a, b) => a - b);

  it("только его заказы; без фильтра — все", async () => {
    const c = await op();
    expect(idsOf(await c.list({ courierId: s.courierId, pageSize: 100 }))).toEqual(sorted("mineAwaiting", "mineClosed", "mineShipped"));
    expect(idsOf(await c.list({ pageSize: 100 }))).toHaveLength(5);
  });

  it("очередь курьера: его доставленные и нерассчитанные", async () => {
    const c = await op();
    expect(idsOf(await c.list({ courierId: s.courierId, awaitingMoney: true, pageSize: 100 }))).toEqual(sorted("mineAwaiting"));
    expect(idsOf(await c.list({ courierId: otherCourier, awaitingMoney: true, pageSize: 100 }))).toEqual(sorted("otherAwaiting"));
  });

  it("плитки — тот же срез, что таблица", async () => {
    const c = await op();
    const st = await c.stats({ courierId: s.courierId });
    expect(st.total).toBe(3);
    expect(st.awaitingMoneyCount).toBe(1);
    expect((await c.stats({})).awaitingMoneyCount).toBe(3);
  });

  it("агент с courierId не видит больше своего", async () => {
    const [a] = await (db as any).insert(schema.users).values({ tenantId: s.tenantId, name: "Другой агент", email: "a2@test.local", passwordHash: "x", role: "agent" });
    const agent = (await import("../../order-router")).orderRouter.createCaller(ctxFor(db, s.tenantId, Number(a.insertId), "agent"));
    expect((await agent.list({ courierId: s.courierId, pageSize: 100 })).data).toEqual([]);
  });
});
