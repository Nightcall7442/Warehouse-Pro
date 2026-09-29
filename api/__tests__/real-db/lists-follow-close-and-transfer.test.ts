import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import * as schema from "@db/schema";
import { invalidateReports } from "../../lib/report-cache";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

/**
 * «Закрыть расчёт» и перемещение между складами тоже освежают списки.
 *
 * Что было: списки с остатком и долгом (shop.list, agent.availableShops,
 * product.listAll) стали следовать за номером данных организации — его
 * поднимает invalidateReports. Но два сервиса записи его не звали вовсе:
 *   · «Закрыть расчёт» (OrderCloseService.close) — офис принял доплату картой
 *     или наличными сверх заявленного, долг магазина пересчитан, а список
 *     магазинов и справочник агента ещё три минуты показывали старый долг
 *     (и отчёты — старые деньги);
 *   · перемещение документом (transferStock) — товар ушёл с основного склада,
 *     а каталог агента ещё три минуты показывал его «в наличии».
 *
 * Что проверяется — на настоящей базе и настоящими путями записи:
 *   · после «Закрыть расчёт» с «Ещё принято» долг в shop.list и в
 *     справочнике агента — уже новый;
 *   · после перемещения с основного склада каталог агента показывает остаток
 *     за вычетом ушедшего.
 *
 * Нарочная поломка: убери invalidateReports из OrderCloseService.close —
 * падает «закрыть расчёт»; из transferStock — падает «перемещение».
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/telegram", async (orig) => ({ ...(await orig<object>()), sendTelegram: vi.fn(async () => true), notifyTenantRole: vi.fn(async () => undefined) }));

describe.skipIf(!hasRealDb)("закрытие расчёта и перемещение освежают списки", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    // После TRUNCATE номер организации повторяется — ответы прошлого теста не должны всплыть.
    await invalidateReports(s.tenantId, "test");
  });

  const shopDebt = async () => {
    const r = await (await import("../../shop-router")).shopRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "operator")).list({ pageSize: 50 });
    return Number(r.data.find(x => x.id === s.shopId)!.debt);
  };
  const directoryDebt = async () => {
    const r = await (await import("../../agent-router")).agentRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "agent")).availableShops({ limit: 30 });
    return Number(r.find(x => x.id === s.shopId)!.debt);
  };
  const available = async () => {
    const rows = await (await import("../../product-router")).productRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "agent")).listAll();
    return Number(rows.find(p => Number(p.id) === s.productId)!.available);
  };

  it("закрыть расчёт с доплатой картой: долг в списке магазинов и у агента — сразу новый", async () => {
    const { OrderService } = await import("../../services/order");
    const r = await OrderService.create(db, s.tenantId, s.agentId, {
      shopId: s.shopId, paymentMethod: "cash", items: [{ productId: s.productId, quantity: "3" }],
    });
    const id = (r as { id: number }).id;
    const courierRouter = (await import("../../courier-router")).courierRouter;
    await courierRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "operator")).assignCourier({ orderId: id, courierId: s.courierId });
    const courier = courierRouter.createCaller(ctxFor(db, s.tenantId, s.courierId, "courier"));
    await courier.markOutForDelivery({ orderId: id });
    // 3 × 100 = 300; магазин отдал курьеру 100 — долг 200.
    await courier.completeDelivery({ orderId: id, result: "partial_paid", paymentMethod: "cash", paidAmount: "100" });
    expect(await shopDebt()).toBe(200);
    expect(await directoryDebt()).toBe(200);

    const [ceo] = await (db as any).insert(schema.users).values({ tenantId: s.tenantId, name: "Директор", email: "ceo@test.local", passwordHash: "x", role: "ceo" });
    const { OrderCloseService } = await import("../../services/order-close");
    await OrderCloseService.close(db as any, s.tenantId, { id: Number(ceo.insertId), name: "Директор", role: "ceo" }, {
      orderId: id, cashReceived: 100, extra: [{ method: "card", amount: 50 }], acceptDebt: true,
    });

    expect(await shopDebt(), "shop.list держал долг до закрытия расчёта").toBe(150);
    expect(await directoryDebt(), "справочник агента держал долг до закрытия расчёта").toBe(150);
  });

  it("перемещение с основного склада: каталог агента сразу без ушедшего", async () => {
    expect(await available()).toBe(10);

    const [w] = await (db as any).insert(schema.warehouses).values({ tenantId: s.tenantId, name: "Второй склад" });
    const { transferStock } = await import("../../services/stock-transfer");
    await transferStock(db as any, s.tenantId, { id: s.agentId, name: "Оператор", role: "operator" }, {
      fromWarehouseId: s.warehouseId, toWarehouseId: Number(w.insertId), items: [{ productId: s.productId, quantity: 4 }],
    });

    expect(await available(), "каталог агента показал товар, уехавший на другой склад").toBe(6);
  });
});
