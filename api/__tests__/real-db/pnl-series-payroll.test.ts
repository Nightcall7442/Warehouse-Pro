/**
 * Линия «Чистая прибыль» на графике P&L сходится с итогом периода.
 *
 * Итог периода (current.netProfit) вычитает и расходы по приходам, и выданную
 * зарплату. Ряды графика — помесячный trend и series по дням/неделям —
 * вычитали только приходы: в периоде с выплатой линия шла выше итога ровно на
 * фонд оплаты труда, и сумма точек графика не совпадала с числом над ним.
 *
 * На настоящей MySQL: группировка выплат по дню и месяцу — это SQL, заглушке
 * её не проверить.
 *
 * Нарочная поломка: убери выплаты из sumsBy в analytics-router — упадут все
 * три теста; верни помесячный ряд только по месяцам с выручкой — упадёт
 * «месяц только с выплатой».
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import { invalidateReports } from "../../lib/report-cache";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({
  getDb: () => current,
  getPool: () => null,
}));

const round2 = (v: number) => Math.round(v * 100) / 100;

describe.skipIf(!hasRealDb)("P&L: зарплата в линии чистой прибыли", () => {
  let s: Seeded;

  beforeAll(async () => { current = await connectRealDb(); }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    await invalidateReports(s.tenantId, "test");
  });

  async function deliveredOrder(at: string, total: string, cost: string) {
    const [row] = await current.insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId,
      orderNumber: `№${Math.random().toString(36).slice(2, 8)}`,
      status: "delivered", paymentMethod: "cash", subtotal: total, total,
      createdAt: new Date(at),
    } as never);
    await current.insert(schema.orderItems).values({
      orderId: Number(row.insertId), productId: s.productId, quantity: "1.00",
      unitPrice: total, costPrice: cost, subtotal: total,
    } as never);
  }

  async function payout(at: string, amount: string) {
    await current.insert(schema.salaryPayouts).values({
      tenantId: s.tenantId, userId: s.agentId, amount, paidAt: new Date(at), createdBy: s.agentId,
    } as never);
  }

  const pnl = async (from: string, to: string) =>
    (await import("../../analytics-router")).analyticsRouter
      .createCaller(ctxFor(current, s.tenantId, s.agentId, "ceo"))
      .pnl({ from, to, compareWithPrev: false });

  it("сумма линии по дням и по месяцам — это итог периода, с зарплатой", async () => {
    await deliveredOrder("2026-09-10T10:00:00", "1000.00", "600.00");
    await deliveredOrder("2026-09-15T11:00:00", "500.00", "300.00");
    await payout("2026-09-15T12:00:00", "150.00");

    const month = await pnl("2026-09-01", "2026-09-30");
    expect(month.current).toMatchObject({ revenue: 1500, cogs: 900, payrollExpenses: 150, netProfit: 450 });
    expect(month.series.granularity).toBe("day");

    const daySum = round2(month.series.points.reduce((a, p) => a + p.netProfit, 0));
    expect(daySum, "линия по дням не вычла зарплату").toBe(month.current.netProfit);
    const payday = month.series.points.find(p => p.start === "2026-09-15")!;
    expect(payday).toMatchObject({ revenue: 500, operatingExpenses: 150, netProfit: 50 });

    // Тот же сентябрь в годовом окне — помесячная строка trend и series.
    const year = await pnl("2026-01-01", "2026-12-31");
    expect(year.series.granularity).toBe("month");
    const sep = year.trend.find(r => r.month === "2026-09")!;
    expect(sep, "помесячная строка не вычла зарплату").toMatchObject({ operatingExpenses: 150, netProfit: 450 });
    expect(year.series.points.find(p => p.start === "2026-09-01")).toMatchObject({ netProfit: 450 });
  });

  it("месяц только с выплатой — строка ряда, а не пропуск; сумма ряда — итог года", async () => {
    await deliveredOrder("2026-09-10T10:00:00", "1000.00", "600.00");
    await payout("2026-07-05T10:00:00", "50.00");

    const year = await pnl("2026-01-01", "2026-12-31");
    expect(year.trend.map(r => r.month)).toEqual(["2026-07", "2026-09"]);
    expect(year.trend[0]).toMatchObject({ revenue: 0, operatingExpenses: 50, netProfit: -50, orderCount: 0 });
    expect(round2(year.trend.reduce((a, r) => a + r.netProfit, 0))).toBe(year.current.netProfit);
    expect(round2(year.series.points.reduce((a, p) => a + p.netProfit, 0))).toBe(year.current.netProfit);
  });

  it("день только с выплатой — убыточный день на графике, а не пропуск", async () => {
    await deliveredOrder("2026-09-10T10:00:00", "1000.00", "600.00");
    await payout("2026-09-20T09:00:00", "80.00");

    const res = await pnl("2026-09-01", "2026-09-30");
    const payday = res.series.points.find(p => p.start === "2026-09-20")!;
    expect(payday).toMatchObject({ revenue: 0, operatingExpenses: 80, netProfit: -80 });
    expect(round2(res.series.points.reduce((a, p) => a + p.netProfit, 0))).toBe(res.current.netProfit);
  });
});
