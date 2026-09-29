import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { invalidateReports } from "../../lib/report-cache";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

/**
 * Поиск магазина для пикеров — на сервере, по всем точкам организации.
 *
 * Что было: пикеры веба (быстрый заказ, мастер заказа, фильтр отчётов,
 * расписание) брали 200–500 самых новых магазинов и искали у себя; давний
 * клиент не находился, телефон не искался.
 *
 * Что проверяется — настоящим SQL agent.availableShops с окном в 30 строк:
 *   · самый старый из 520 находится по названию, телефону, району и городу;
 *   · окно держится: без поиска — ровно limit строк;
 *   · архивный магазин и чужая организация в ответ не попадают — для всех
 *     ролей, которые оформляют заказ (оператор, агент).
 *
 * Нарочная поломка: убери район и город из условия поиска в listActiveShops
 * (api/agent-router.ts) — падает «по району и городу».
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

describe.skipIf(!hasRealDb)("agent.availableShops: поиск по всем магазинам", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    await invalidateReports(s.tenantId, "test");
    const d = db as any;
    // «Магазин Альфа» из seed — самый старый; добавляем ещё 519 новее.
    await d.update(schema.shops).set({ ownerName: "Алишер", phone: "+998 90 111 22 33", district: "Чиланзар", city: "Самарканд" }).where(eq(schema.shops.id, s.shopId));
    const rows = Array.from({ length: 519 }, (_, i) => ({
      tenantId: s.tenantId, name: `Точка ${String(i).padStart(3, "0")}`, phone: `+998 97 000 ${String(i).padStart(4, "0")}`, district: "Юнусабад", city: "Ташкент",
    }));
    await d.insert(schema.shops).values(rows);
    await d.insert(schema.shops).values([
      { tenantId: s.tenantId, name: "Альфа закрытая", phone: "+998 90 111 22 33", status: "inactive" },
      { tenantId: s.otherTenantId, name: "Альфа чужая", phone: "+998 90 111 22 33", district: "Чиланзар" },
    ]);
  });

  const find = async (search: string | undefined, role = "operator") =>
    (await (await import("../../agent-router")).agentRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, role)).availableShops({ search, limit: 30 }))
      .map(x => x.name);

  it("самый старый из 520 — по названию и телефону", async () => {
    expect(await find("Альфа")).toEqual(["Магазин Альфа"]);
    expect(await find("111 22 33")).toEqual(["Магазин Альфа"]);
    expect(await find("111 22 33", "agent"), "агенту — тот же ответ").toEqual(["Магазин Альфа"]);
  });

  it("по району и городу", async () => {
    expect(await find("Чиланзар")).toEqual(["Магазин Альфа"]);
    expect(await find("Самарканд")).toEqual(["Магазин Альфа"]);
  });

  it("окно держится, архив и чужие не попадают", async () => {
    expect(await find(undefined)).toHaveLength(30);
    expect(await find("Юнусабад")).toHaveLength(30);
    expect(await find("закрытая")).toEqual([]);
    expect(await find("чужая")).toEqual([]);
  });
});
