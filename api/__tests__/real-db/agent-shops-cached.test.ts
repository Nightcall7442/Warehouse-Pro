import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { invalidateReports } from "../../lib/report-cache";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

/**
 * «Магазины» агента — из кэша, но долг и новые точки не отстают.
 *
 * Что было: agent.myShops (раздел «Магазины» в PWA и в мобилке) на каждый
 * заход читал все активные магазины организации заново, без кэша: у клиента
 * с тремя тысячами точек — полный проход по shops на каждое открытие экрана
 * каждым агентом.
 *
 * Что проверяется — на настоящей базе и настоящими путями записи:
 *   · заказ в долг (OrderService.create) и оплата (PaymentService.addPayment)
 *     — долг в списке агента сразу новый, хотя список был в кэше;
 *   · магазин, созданный агентом (agent.createShop), виден сразу;
 *   · правка мимо сервисов записи — ответ по-прежнему из кэша: кэш включён,
 *     база не перечитывается на каждый заход;
 *   · чужая организация свои магазины не видит и чужих не получает — ключ
 *     кэша у каждой свой.
 *
 * Нарочная поломка: в myShops (agent-router.ts) замени withTenantDataCache на
 * withCache — падает «заказ в долг и оплата»; убери префикс `shops:<tenantId>`
 * из ключа — падает «новый магазин»; убери tenantId из ключа — падает «чужая
 * организация»; верни чтение без кэша — падает «мимо сервисов».
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

describe.skipIf(!hasRealDb)("agent.myShops: кэш следует за записью", () => {
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
    await invalidateReports(s.otherTenantId, "test");
  });

  const agentRouter = async () => (await import("../../agent-router")).agentRouter;
  const myShops = async (tenantId = s.tenantId, userId = s.agentId) =>
    (await agentRouter()).createCaller(ctxFor(db, tenantId, userId, "agent")).myShops();
  const debtOf = async (shopId = s.shopId) => Number((await myShops()).find(x => x.id === shopId)!.debt);

  it("заказ в долг и оплата: долг в списке агента — уже после записи", async () => {
    expect(await debtOf()).toBe(0);

    const { OrderService } = await import("../../services/order");
    await OrderService.create(db, s.tenantId, s.agentId, {
      shopId: s.shopId, paymentMethod: "debt", items: [{ productId: s.productId, quantity: "4" }],
    });
    expect(await debtOf(), "список агента держал долг до заказа").toBe(400);

    const { PaymentService } = await import("../../services/payment");
    await PaymentService.addPayment(db as never, s.tenantId, { shopId: s.shopId, amount: "150", createdBy: s.agentId });
    expect(await debtOf(), "список агента держал долг до оплаты").toBe(250);
  });

  it("новый магазин агента виден сразу", async () => {
    expect((await myShops()).map(x => x.name)).toEqual(["Магазин Альфа"]);

    const created = await (await agentRouter()).createCaller(ctxFor(db, s.tenantId, s.agentId, "agent"))
      .createShop({ name: "Лавка у рынка", district: "Чорсу" });

    const names = (await myShops()).map(x => x.name).sort();
    expect(names, "созданный магазин не появился в списке").toEqual(["Лавка у рынка", "Магазин Альфа"]);
    expect((await myShops()).find(x => x.id === created.id)?.agentId).toBe(s.agentId);
  });

  it("мимо сервисов записи — ответ из кэша: база не перечитывается", async () => {
    expect(await debtOf()).toBe(0);

    // Правка мимо сервисов записи: ни invalidateReports, ни сброса префикса.
    await db.update(schema.shops).set({ debt: "999.00" } as never).where(eq(schema.shops.id, s.shopId));
    expect(await debtOf(), "список перечитан из базы — кэша нет").toBe(0);

    await invalidateReports(s.tenantId, "test");
    expect(await debtOf()).toBe(999);
  });

  it("чужая организация: у каждой свой список и свой ключ", async () => {
    const [otherShop] = await db.insert(schema.shops).values({ tenantId: s.otherTenantId, name: "Соседская точка" } as never);
    const [otherAgent] = await db.insert(schema.users).values({
      tenantId: s.otherTenantId, name: "Чужой агент", email: "other-agent@test.local", passwordHash: "x", role: "agent",
    } as never);

    // Сначала наш — чтобы его ответ лёг в кэш раньше чужого запроса.
    expect((await myShops()).map(x => x.name)).toEqual(["Магазин Альфа"]);
    const theirs = await myShops(s.otherTenantId, Number(otherAgent.insertId));
    expect(theirs.map(x => x.id)).toEqual([Number(otherShop.insertId)]);
    expect((await myShops()).map(x => x.name)).toEqual(["Магазин Альфа"]);
  });
});
