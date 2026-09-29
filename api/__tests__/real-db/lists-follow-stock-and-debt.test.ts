import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { invalidateReports } from "../../lib/report-cache";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

/**
 * Остаток и долг в списках — не старше последней записи.
 *
 * Что было: каталог (product.listAll, product.list), список магазинов
 * (shop.list) и справочник агента (agent.availableShops) лежали в кэше по три
 * минуты, а заказы, приходы, возвраты и оплаты сбрасывали только кэш отчётов
 * (invalidateReports). Агент видел «в наличии 10» у распроданного товара и
 * получал отказ на заказе; должник висел в списке с долгом уже после оплаты.
 *
 * Что проверяется — на настоящей базе и настоящими путями записи:
 *   · заказ (OrderService.create) → каталог агента показывает остаток за
 *     вычетом резерва, и product.list оператора тоже;
 *   · оплата (PaymentService.addPayment) → shop.list и availableShops
 *     показывают новый долг;
 *   · правка мимо сервисов записи (без invalidateReports) — списки
 *     по-прежнему отдаются из кэша: кэш не выключен, он следует за данными.
 *
 * Нарочная поломка: в withTenantDataCache (lib/cache.ts) убери номер данных
 * из ключа — падают «заказ» и «оплата».
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

describe.skipIf(!hasRealDb)("списки с остатком и долгом следуют за записью", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    // После TRUNCATE номер организации повторяется, а ответы прошлого теста
    // ещё лежат в памяти процесса — сброс, как после записи.
    await invalidateReports(s.tenantId, "test");
  });

  const products = async () => (await import("../../product-router")).productRouter;
  const available = async (role = "agent") => {
    const rows = await (await products()).createCaller(ctxFor(db, s.tenantId, s.agentId, role)).listAll();
    return Number(rows.find(p => Number(p.id) === s.productId)!.available);
  };
  const listed = async () => {
    const r = await (await products()).createCaller(ctxFor(db, s.tenantId, s.agentId, "operator")).list({ pageSize: 50 });
    return Number(r.data.find(p => Number(p.id) === s.productId)!.available);
  };
  const shopDebt = async () => {
    const r = await (await import("../../shop-router")).shopRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "operator")).list({ pageSize: 50 });
    return Number(r.data.find(x => x.id === s.shopId)!.debt);
  };
  const directoryDebt = async () => {
    const r = await (await import("../../agent-router")).agentRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "agent")).availableShops({ limit: 30 });
    return Number(r.find(x => x.id === s.shopId)!.debt);
  };

  it("заказ: каталог агента и список товаров сразу показывают остаток за вычетом резерва", async () => {
    expect(await available()).toBe(10);
    expect(await listed()).toBe(10);

    const { OrderService } = await import("../../services/order");
    await OrderService.create(db, s.tenantId, s.agentId, {
      shopId: s.shopId, paymentMethod: "cash", items: [{ productId: s.productId, quantity: "7" }],
    });

    expect(await available(), "каталог агента показал остаток до заказа").toBe(3);
    expect(await listed(), "product.list показал остаток до заказа").toBe(3);
  });

  it("оплата: долг магазина в shop.list и в справочнике агента — уже после оплаты", async () => {
    const { OrderService } = await import("../../services/order");
    await OrderService.create(db, s.tenantId, s.agentId, {
      shopId: s.shopId, paymentMethod: "debt", items: [{ productId: s.productId, quantity: "4" }],
    });
    expect(await shopDebt()).toBe(400);
    expect(await directoryDebt()).toBe(400);

    const { PaymentService } = await import("../../services/payment");
    await PaymentService.addPayment(db as never, s.tenantId, { shopId: s.shopId, amount: "150", createdBy: s.agentId });

    expect(await shopDebt(), "shop.list держал долг до оплаты").toBe(250);
    expect(await directoryDebt(), "справочник агента держал долг до оплаты").toBe(250);
  });

  it("без записи через сервисы — ответ из кэша: база не перечитывается", async () => {
    expect(await available()).toBe(10);
    expect(await shopDebt()).toBe(0);

    // Правка мимо сервисов записи: invalidateReports никто не позвал.
    await db.update(schema.warehouseStock).set({ available: "1.000" } as never).where(eq(schema.warehouseStock.productId, s.productId));
    await db.update(schema.shops).set({ debt: "999.00" } as never).where(eq(schema.shops.id, s.shopId));
    expect(await available()).toBe(10);
    expect(await shopDebt()).toBe(0);

    // Сброс организации — и списки перечитаны.
    await invalidateReports(s.tenantId, "test");
    expect(await available()).toBe(1);
    expect(await shopDebt()).toBe(999);
  });
});
