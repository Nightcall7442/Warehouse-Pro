/**
 * Сутки на настоящей MySQL — ташкентские.
 *
 * ── Почему на настоящей базе ────────────────────────────────────────────────
 *
 * Ошибка жила между JS и сессией MySQL: граница «2026-10-13 00:00:00» и
 * DATE(created_at) сравнивались в UTC, то есть с 05:00 по Ташкенту. Заглушка
 * не знает ни пояса сессии, ни того, как drizzle пишет TIMESTAMP, — поймать
 * это можно только здесь.
 *
 * ── Заказы ──────────────────────────────────────────────────────────────────
 *
 *   по UTC               по Ташкенту          сумма
 *   12.10 18:30          12.10 23:30           800   — двенадцатое
 *   12.10 22:30          13.10 03:30           100   — тринадцатое (раньше — 12-е)
 *   13.10 18:30          13.10 23:30           200   — тринадцатое
 *   13.10 19:30          14.10 00:30           400   — четырнадцатое (раньше — 13-е)
 *
 * За 13-е — ровно 100 + 200 = 300 и два заказа: в списке «Заказов», в P&L и
 * в графике «Отчётов».
 *
 * Страж исходников — api/__tests__/server-days-are-tashkent.test.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import { invalidateReports } from "../../lib/report-cache";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({
  getDb: () => current,
  getPool: () => null,
}));

const ORDERS = [
  { at: "2026-10-12T18:30:00Z", total: "800.00" },
  { at: "2026-10-12T22:30:00Z", total: "100.00" },
  { at: "2026-10-13T18:30:00Z", total: "200.00" },
  { at: "2026-10-13T19:30:00Z", total: "400.00" },
] as const;

describe.skipIf(!hasRealDb)("сутки по Ташкенту на настоящей базе", () => {
  let db: ServiceDb;
  let s: Seeded;
  const ids = new Map<string, number>();

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    await invalidateReports(s.tenantId, "test");
    ids.clear();
    for (const o of ORDERS) {
      const [row] = await db.insert(schema.orders).values({
        tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId,
        orderNumber: `№${o.at.slice(5, 16)}`,
        status: "delivered", paymentMethod: "cash", subtotal: o.total, total: o.total,
        createdAt: new Date(o.at),
      } as never);
      const orderId = Number(row.insertId);
      ids.set(o.at, orderId);
      await db.insert(schema.orderItems).values({
        orderId, productId: s.productId, quantity: "1.00",
        unitPrice: o.total, costPrice: "0.00", subtotal: o.total,
      } as never);
    }
    // План визита — колонка DATE: хранит сам день и не сдвигается.
    await db.insert(schema.dailyPlans).values({
      tenantId: s.tenantId, agentId: s.agentId, shopId: s.shopId,
      planDate: new Date("2026-10-13T00:00:00Z"), status: "visited",
    } as never);
  });

  it("отметка времени ложится в базу тем же моментом", async () => {
    // Основа всего остального: drizzle пишет и читает TIMESTAMP в UTC.
    const [o] = await db.select({ createdAt: schema.orders.createdAt }).from(schema.orders)
      .where(eq(schema.orders.id, ids.get("2026-10-12T22:30:00Z")!));
    expect(o.createdAt.toISOString()).toBe("2026-10-12T22:30:00.000Z");
  });

  it("«Заказы» за 13-е — заказы с полуночи до полуночи по Ташкенту", async () => {
    const { orderRouter } = await import("../../order-router");
    const res = await orderRouter.createCaller(ctxFor(current, s.tenantId, s.agentId, "ceo"))
      .list({ dateFrom: "2026-10-13", dateTo: "2026-10-13", pageSize: 100 });
    expect(res.data.map(o => o.id).sort((a, b) => a - b)).toEqual(
      [ids.get("2026-10-12T22:30:00Z")!, ids.get("2026-10-13T18:30:00Z")!].sort((a, b) => a - b),
    );
  });

  it("P&L за 13-е — выручка двух заказов этого дня", async () => {
    const { analyticsRouter } = await import("../../analytics-router");
    const pnl = await analyticsRouter.createCaller(ctxFor(current, s.tenantId, s.agentId, "ceo"))
      .pnl({ from: "2026-10-13", to: "2026-10-13", compareWithPrev: false });
    expect(pnl.current.revenue).toBe(300);
  });

  it("график «Отчётов» делит заказы по ташкентским суткам, визиты — по дню плана", async () => {
    const { reportsRouter } = await import("../../reports-router");
    const chart = await reportsRouter.createCaller(ctxFor(current, s.tenantId, s.agentId, "ceo"))
      .getVisitChart({ from: "2026-10-12", to: "2026-10-14" });
    expect(chart).toEqual([
      { date: "2026-10-12", visits: 0, orders: 1, revenue: 800 },
      { date: "2026-10-13", visits: 1, orders: 2, revenue: 300 },
      { date: "2026-10-14", visits: 0, orders: 1, revenue: 400 },
    ]);
  });
});
