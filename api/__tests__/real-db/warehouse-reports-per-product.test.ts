/**
 * Отчёты склада: одна строка на товар — на настоящей базе.
 *
 * warehouseStock хранит строку на каждый склад. «Топ по стоимости» и
 * «оборачиваемость» без фильтра по складу («все вместе») отдавали товар
 * по разу на склад — с частью остатка в каждой строке; React жаловался на
 * одинаковые ключи, а «топ-10» был топом по строкам склада (прогон
 * 20.09.2026). Здесь два склада с одним товаром: строка одна, остаток —
 * сумма; с фильтром по складу — остаток только этого склада.
 *
 * Нарочная поломка: убери groupBy у topByValue — упадёт «одна строка»;
 * верни `currentStock: warehouseStock.currentStock` — упадёт «сумма».
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import { invalidateReports } from "../../lib/report-cache";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({
  getDb: () => current,
  getPool: () => null,
}));

function ctxFor(db: ServiceDb, tenantId: number, userId: number): any {
  return {
    req: new Request("http://localhost/"), resHeaders: new Headers(), db,
    user: { id: userId, tenantId, role: "ceo", status: "active" as const, name: "Директор", email: "ceo@test.local", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date() },
    tenant: { id: tenantId, slug: "test-co", name: "Тестовая компания", plan: "pro" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
  };
}

describe.skipIf(!hasRealDb)("отчёты склада: строка на товар", () => {
  let db: ServiceDb;
  let s: Seeded;
  let secondWh = 0;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    await invalidateReports(s.tenantId, "test");
    const [w] = await db.insert(schema.warehouses).values({ tenantId: s.tenantId, name: "Второй", isDefault: false } as never);
    secondWh = Number(w.insertId);
    await db.insert(schema.warehouseStock).values({ tenantId: s.tenantId, productId: s.productId, warehouseId: secondWh, currentStock: "5.000", reserved: "0.000", available: "5.000" } as never);
  });

  const reports = async () => (await import("../../warehouse-reports-router")).warehouseReportsRouter.createCaller(ctxFor(current, s.tenantId, s.agentId));

  it("топ по стоимости: без фильтра — одна строка с суммой по складам, с фильтром — остаток склада", async () => {
    const all = await (await reports()).topByValue({ limit: 10 });
    const mine = all.filter(r => r.productId === s.productId);
    expect(mine, "товар вышел по разу на склад").toHaveLength(1);
    expect(Number(mine[0].currentStock), "остаток не сумма двух складов").toBe(15);

    await invalidateReports(s.tenantId, "test");
    const second = await (await reports()).topByValue({ limit: 10, warehouseId: secondWh });
    const row = second.find(r => r.productId === s.productId);
    expect(row && Number(row.currentStock), "фильтр по складу не сузил остаток").toBe(5);
  });

  it("оборачиваемость: одна строка на товар, остаток по складам суммируется", async () => {
    const rows = await (await reports()).turnover({ days: 30 });
    const mine = rows.filter(r => r.productId === s.productId);
    expect(mine, "товар вышел по разу на склад").toHaveLength(1);
    expect(Number(mine[0].currentStock)).toBe(15);
  });
});
