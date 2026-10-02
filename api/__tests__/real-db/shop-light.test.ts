/**
 * Светофор магазина — каждый цвет на подобранном магазине, через ручки.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * «Можно ли грузить» собиралось из трёх мест (долг, «Дебиторка», заказы), а
 * агент у прилавка не видел ни одного, кроме суммы долга.
 *
 * ── Что проверяется (настоящая база, shop.light / shop.lights) ──────────────
 *
 *  Засев — шесть магазинов: просрочка, долг выше лимита, долг 80% лимита,
 *  долгая пауза при ритме, ровный ритм с возвратом, два заказа давно.
 *
 *  1. Каждый цвет и причина словами-кодами с числами.
 *  2. Просрочка — тем же правилом, что «стоп отгрузки»: числа совпадают с
 *     order.shopOverdue; своя отсрочка магазина перекрывает организации в обе
 *     стороны; при выключенной остановке светофор всё равно красный, но
 *     holdsOrders = false.
 *  3. Ритм: окно от последнего заказа; при <3 днях с заказом не судим.
 *  4. Средний чек за 90 дней — доставленные минус возвраты периода.
 *  5. Последняя причина «без заказа»; визит, у которого был заказ, не в счёт.
 *  6. Пакет без N+1: запросов столько же на один магазин, сколько на все.
 *  7. Агенту — только свои (закреплённые, ничьи, из его плана); чужой
 *     магазин из ответа выпадает, карточка — null.
 *  8. Чужая организация не влияет: ни её магазин, ни её заказы.
 *
 * Нарочные поломки (каждая роняет свою проверку):
 *   • в services/overdue-hold.ts `shop.grace ?? orgGrace` → `orgGrace` — 2;
 *   • в contracts/shop-light.ts NEAR_LIMIT_SHARE 0.7 → 0.9 — 1;
 *   • в services/shop-light.ts `rh.orderDays >= RHYTHM_MIN_ORDER_DAYS` → `> 1` — 1 и 3;
 *   • в services/shop-light.ts убрать вычет возвратов (`- back.get(…)`) — 4;
 *   • в services/shop-light.ts ownShopIds убрать `isNull(shops.agentId)` — 7;
 *   • в services/shop-light.ts убрать `lo.tenant_id = ${tenantId}` из ритма — 1 и 8.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { recalcShopDebt } from "../../services/shop-debt";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

type Shops = { overdue: number; overLimit: number; nearLimit: number; pause: number; steady: number; sparse: number; foreign: number };

describe.skipIf(!hasRealDb)("светофор магазина", () => {
  let db: ServiceDb;
  let s: Seeded;
  let sh: Shops;
  let otherAgent: number;
  let otherTenantShop: number;
  let n = 0;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });

  async function setOrg(enabled: boolean, grace = 14) {
    await db.insert(schema.settings).values({ tenantId: s.tenantId, overdueHoldEnabled: enabled, overdueGraceDays: grace })
      .onDuplicateKeyUpdate({ set: { overdueHoldEnabled: enabled, overdueGraceDays: grace } });
  }
  async function shop(name: string, extra: Partial<typeof schema.shops.$inferInsert> = {}, tenantId = s.tenantId) {
    return Number((await db.insert(schema.shops).values({ tenantId, name, ...extra }))[0].insertId);
  }
  async function order(shopId: number, o: { total: string; daysAgo: number; status?: string; method?: string; deliveredDaysAgo?: number; tenantId?: number }) {
    const tenantId = o.tenantId ?? s.tenantId;
    const [r] = await db.insert(schema.orders).values({
      tenantId, shopId, agentId: s.agentId, orderNumber: `№L-${++n}`,
      status: o.status ?? "new", paymentMethod: o.method ?? "cash", subtotal: o.total, total: o.total,
      createdAt: sql`DATE_SUB(NOW(), INTERVAL ${o.daysAgo} DAY)`,
      deliveredAt: o.deliveredDaysAgo == null ? null : sql`DATE_SUB(NOW(), INTERVAL ${o.deliveredDaysAgo} DAY)`,
    } as never);
    return Number(r.insertId);
  }
  async function paid(shopId: number, orderId: number, amount: string) {
    await db.insert(schema.payments).values({ tenantId: s.tenantId, shopId, orderId, amount, type: "payment" } as never);
  }
  const recalc = (shopId: number, tenantId = s.tenantId) => db.transaction(tx => recalcShopDebt(tx, tenantId, shopId));

  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    const [u] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Другой агент", email: "a2@test.local", passwordHash: "x", role: "agent" });
    otherAgent = Number(u.insertId);
    await setOrg(false);

    sh = {
      overdue: s.shopId,
      overLimit: await shop("Выше лимита", { creditLimit: "1000.00" }),
      nearLimit: await shop("У лимита", { creditLimit: "1000.00" }),
      pause: await shop("Пропал"),
      steady: await shop("Ровный"),
      sparse: await shop("Редкий"),
      foreign: await shop("Чужой агента", { agentId: otherAgent }),
    };
    // Просрочка: доставлен 30 дней назад, оформлен 40, не оплачен; отсрочка 14.
    await order(sh.overdue, { total: "800.00", daysAgo: 40, status: "delivered", deliveredDaysAgo: 30 });
    // В долг: должен с оформления, но не доставлен — просрочиться не может.
    await order(sh.overLimit, { total: "1200.00", daysAgo: 2, method: "debt" });
    await order(sh.nearLimit, { total: "800.00", daysAgo: 2, method: "debt" });
    // Ритм раз в 10 дней, последний заказ 70 дней назад.
    for (const d of [100, 90, 80, 70]) await order(sh.pause, { total: "100.00", daysAgo: d });
    // Ровный: три доставленных оплаченных по 300 раз в неделю, возврат 100 в периоде.
    let last = 0;
    for (const d of [21, 14, 7]) { last = await order(sh.steady, { total: "300.00", daysAgo: d, status: "delivered", deliveredDaysAgo: d }); await paid(sh.steady, last, "300.00"); }
    await db.insert(schema.returns).values({ tenantId: s.tenantId, shopId: sh.steady, orderId: last, returnNumber: "ВЗ-1", status: "completed", totalAmount: "100.00" } as never);
    // Редкий: два заказа в одном окне — о ритме ещё не судим (нужно три дня с заказом).
    await order(sh.sparse, { total: "100.00", daysAgo: 130 });
    await order(sh.sparse, { total: "100.00", daysAgo: 100 });
    for (const id of Object.values(sh)) await recalc(id);

    // Чужая организация: свой магазин с просрочкой и мусорный заказ на номер нашего.
    otherTenantShop = await shop("Чужой арендатор", {}, s.otherTenantId);
    await order(otherTenantShop, { total: "500.00", daysAgo: 40, status: "delivered", deliveredDaysAgo: 30, tenantId: s.otherTenantId });
    await order(sh.steady, { total: "999999.00", daysAgo: 1, status: "delivered", deliveredDaysAgo: 1, tenantId: s.otherTenantId });
  });

  const shopRouter = async () => (await import("../../shop-router")).shopRouter;
  const as = async (role: string, userId = s.agentId) => (await shopRouter()).createCaller(ctxFor(db, s.tenantId, userId, role));
  const all = () => Object.values(sh);
  const byId = async (role = "ceo") => new Map((await (await as(role)).lights({ shopIds: all() })).map(l => [l.shopId, l]));

  it("1. каждый цвет — на своём магазине, причина кодом с числами", async () => {
    const l = await byId();
    expect(l.get(sh.overdue)).toMatchObject({ color: "red", debt: 800, overdue: 800, oldestOverdueDays: 40, reasons: [{ code: "overdue", amount: 800, oldestDays: 40 }] });
    expect(l.get(sh.overLimit)).toMatchObject({ color: "red", debt: 1200, creditLimit: 1000, reasons: [{ code: "over_limit", debt: 1200, limit: 1000 }] });
    expect(l.get(sh.nearLimit)).toMatchObject({ color: "yellow", reasons: [{ code: "near_limit", debt: 800, limit: 1000, pct: 80 }] });
    expect(l.get(sh.pause)).toMatchObject({ color: "yellow", daysSinceOrder: 70, usualIntervalDays: 10, reasons: [{ code: "long_pause", daysSince: 70, usualDays: 10 }] });
    expect(l.get(sh.steady)).toMatchObject({ color: "green", reasons: [], daysSinceOrder: 7, usualIntervalDays: 7 });
    expect(l.get(sh.sparse)).toMatchObject({ color: "green", daysSinceOrder: 100, usualIntervalDays: null });
  });

  it("2. просрочка — правилом «стоп отгрузки»: числа как у order.shopOverdue, отсрочка магазина главнее", async () => {
    const orders = (await import("../../order-router")).orderRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "agent"));
    let light = await (await as("ceo")).light({ shopId: sh.overdue });
    expect(light).toMatchObject({ color: "red", holdsOrders: false, graceDays: 14 });
    expect(await orders.shopOverdue({ shopId: sh.overdue }), "при выключенной остановке подсказки нет").toBeNull();

    await setOrg(true);
    light = await (await as("ceo")).light({ shopId: sh.overdue });
    const hold = await orders.shopOverdue({ shopId: sh.overdue });
    expect(hold).toEqual({ amount: 800, oldestDays: 40, graceDays: 14 });
    expect({ amount: light!.overdue, oldestDays: light!.oldestOverdueDays, graceDays: light!.graceDays }).toEqual(hold);
    expect(light!.holdsOrders).toBe(true);

    // Своя отсрочка 60 — уже не просрочено ни там, ни тут.
    await db.update(schema.shops).set({ paymentGraceDays: 60 }).where(eq(schema.shops.id, sh.overdue));
    expect(await orders.shopOverdue({ shopId: sh.overdue })).toBeNull();
    expect(await (await as("ceo")).light({ shopId: sh.overdue })).toMatchObject({ color: "green", overdue: 0, graceDays: 60 });

    // А организации — 60, магазину — 7: просрочено по своей.
    await setOrg(true, 60);
    await db.update(schema.shops).set({ paymentGraceDays: 7 }).where(eq(schema.shops.id, sh.overdue));
    expect(await (await as("ceo")).light({ shopId: sh.overdue })).toMatchObject({ color: "red", overdue: 800, graceDays: 7 });
  });

  it("3–4. ритм от последнего заказа; средний чек за вычетом возвратов периода", async () => {
    const l = await byId();
    expect(l.get(sh.pause)!.usualIntervalDays, "окно «от сегодня» потеряло бы ритм пропавшего магазина").toBe(10);
    expect(l.get(sh.sparse)!.usualIntervalDays).toBeNull();
    expect(l.get(sh.steady)).toMatchObject({ avgCheck: Math.round((900 - 100) / 3), avgCheckOrders: 3 });
    expect(l.get(sh.pause)).toMatchObject({ avgCheck: null, avgCheckOrders: 0 });
  });

  it("5. последняя причина «без заказа»; визит с заказом не в счёт", async () => {
    const day = async (k: number) => String(((await db.execute(sql`SELECT DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL ${k} DAY), '%Y-%m-%d') AS d`)) as unknown as [Array<{ d: string }>])[0][0].d);
    await db.insert(schema.dailyPlans).values([
      { tenantId: s.tenantId, agentId: s.agentId, shopId: sh.steady, planDate: sql`${await day(10)}` as never, status: "visited", noOrderReason: "has_stock" },
      // 7 дней назад у «Ровного» был заказ того же агента — причина не в счёт.
      { tenantId: s.tenantId, agentId: s.agentId, shopId: sh.steady, planDate: sql`${await day(7)}` as never, status: "visited", noOrderReason: "closed" },
      { tenantId: s.tenantId, agentId: s.agentId, shopId: sh.sparse, planDate: sql`${await day(3)}` as never, status: "visited", noOrderReason: "other", noOrderNote: "ремонт" },
    ]);
    const l = await byId();
    expect(l.get(sh.steady)!.lastNoOrder).toEqual({ reason: "has_stock", note: null, date: await day(10) });
    expect(l.get(sh.sparse)!.lastNoOrder).toEqual({ reason: "other", note: "ремонт", date: await day(3) });
    expect(l.get(sh.pause)!.lastNoOrder).toBeNull();
  });

  it("6. пакет без N+1: на все магазины столько же запросов, сколько на один", async () => {
    const { shopLights } = await import("../../services/shop-light");
    const counting = () => {
      const count = { n: 0 };
      const proxy = new Proxy(db as object, {
        get(target, key, recv) {
          const value = Reflect.get(target, key, recv);
          if (key === "select" || key === "execute") return (...args: unknown[]) => { count.n++; return (value as (...a: unknown[]) => unknown).apply(target, args); };
          return value;
        },
      });
      return { db: proxy as never, count };
    };
    const one = counting();
    await shopLights(one.db, s.tenantId, [sh.steady]);
    const many = counting();
    const res = await shopLights(many.db, s.tenantId, all());
    expect(res.size).toBe(all().length);
    expect(many.count.n, "запросов на список больше, чем на один магазин — расчёт по магазину").toBe(one.count.n);
    expect(many.count.n).toBeLessThanOrEqual(10);
  });

  it("7. агенту — только свои: закреплённые, ничьи и из его плана", async () => {
    const agent = await as("agent");
    const ids = (await agent.lights({ shopIds: all() })).map(l => l.shopId);
    expect(ids).not.toContain(sh.foreign);
    expect(ids, "ничьи магазины пропали у агента").toContain(sh.steady);
    expect(await agent.light({ shopId: sh.foreign })).toBeNull();
    expect(await (await as("agent", otherAgent)).light({ shopId: sh.foreign })).toMatchObject({ shopId: sh.foreign });

    await db.insert(schema.dailyPlans).values({ tenantId: s.tenantId, agentId: s.agentId, shopId: sh.foreign, planDate: sql`CURDATE()` as never });
    expect(await agent.light({ shopId: sh.foreign }), "магазин из плана агента остался чужим").toMatchObject({ shopId: sh.foreign });
    expect(await (await as("supervisor", 999)).light({ shopId: sh.foreign })).toMatchObject({ shopId: sh.foreign });
  });

  it("8. чужая организация не влияет", async () => {
    const l = await byId();
    expect(l.has(otherTenantShop)).toBe(false);
    expect(await (await as("ceo")).light({ shopId: otherTenantShop })).toBeNull();
    expect(l.get(sh.steady), "чужой заказ на номер нашего магазина попал в ритм или чек").toMatchObject({ daysSinceOrder: 7, avgCheck: 267 });
  });
});
