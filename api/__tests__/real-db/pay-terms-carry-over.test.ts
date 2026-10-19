/**
 * Условия оплаты переходят в новый месяц — на настоящей MySQL.
 *
 * Аудит 19.10.2026: строка нового месяца заводилась только с тем полем,
 * которое меняли, и зарплата с неё считалась по нулям. Первого числа у
 * агента пропадал оклад — «ИТОГО К ВЫПЛАТЕ» падало на всю его сумму, пока
 * директор не вводил оклад заново.
 *
 * В сентябре у агента оклад, ставка, ставка доставки, способ оплаты и
 * надбавки. Октябрьскую строку заводит по очереди каждый из четырёх путей —
 * условия сентября обязаны дожить до октября, а поменяться — только то, что
 * меняли.
 *
 * Правило — api/services/pay-terms.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import { calculateSalary } from "../../services/kpi";
import { getPeriod } from "../../lib/period";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

const SEPTEMBER = {
  baseSalary: "3000000.00", commissionRate: "5.00", deliveryRate: "15000.00",
  courierPayMode: "percent", mealAllowance: "30000.00", travelAllowance: "20000.00",
};

describe.skipIf(!hasRealDb)("условия оплаты переходят в новый месяц", () => {
  let db: ServiceDb;
  let s: Seeded;
  let ceoId: number;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  afterEach(() => vi.useRealTimers());
  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    const [ceo] = await db.insert(schema.users).values({
      tenantId: s.tenantId, name: "Директор", email: "ceo@test.local", passwordHash: "x", role: "ceo",
    } as never);
    ceoId = Number(ceo.insertId);
    await db.insert(schema.commissions).values({
      tenantId: s.tenantId, userId: s.agentId, periodType: "monthly",
      periodStart: sql`${"2026-09-01"}`, periodEnd: sql`${"2026-09-30"}`, status: "paid", ...SEPTEMBER,
    } as never);
    // Октябрь по Ташкенту: «текущий месяц» у всех четырёх путей.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T12:00:00+05:00"));
  });

  const october = async () => {
    const rows = await db.select().from(schema.commissions).where(and(
      eq(schema.commissions.userId, s.agentId), sql`${schema.commissions.periodStart} = ${"2026-10-01"}`,
    ));
    expect(rows, "строка октября не заведена или их две").toHaveLength(1);
    return rows[0];
  };

  it("расчёт зарплаты заводит октябрь с окладом и надбавками сентября", async () => {
    const { periodStart, periodEnd } = getPeriod("month", 0);
    await calculateSalary(db as never, s.agentId, s.tenantId, periodStart, periodEnd);
    expect(await october()).toMatchObject(SEPTEMBER);
    // И второй раз — уже по октябрьской строке — оклад на месте.
    const again = await calculateSalary(db as never, s.agentId, s.tenantId, periodStart, periodEnd);
    expect(again.baseSalary).toBe(3_000_000);
  });

  it("«Вычет» заводит октябрь с условиями сентября и своим вычетом", async () => {
    const { kpiRouter } = await import("../../kpi-router");
    await kpiRouter.createCaller(ctxFor(current, s.tenantId, ceoId, "ceo"))
      .setFraudDeduction({ userId: s.agentId, offset: 0, amount: 100_000 });
    expect(await october()).toMatchObject({ ...SEPTEMBER, fraudDeduction: "100000.00" });
  });

  it("«Оклад» без ставки — ставка остаётся сентябрьской, а не ноль", async () => {
    const { kpiRouter } = await import("../../kpi-router");
    await kpiRouter.createCaller(ctxFor(current, s.tenantId, ceoId, "ceo"))
      .setSalary({ userId: s.agentId, baseSalary: 3_500_000 });
    expect(await october()).toMatchObject({ ...SEPTEMBER, baseSalary: "3500000.00" });
  });

  it("«Ставка» — оклад и не переданные ставки остаются сентябрьскими", async () => {
    const { commissionRouter } = await import("../../commission-router");
    await commissionRouter.createCaller(ctxFor(current, s.tenantId, ceoId, "ceo"))
      .setRate({ userId: s.agentId, commissionRate: 7 });
    expect(await october()).toMatchObject({ ...SEPTEMBER, commissionRate: "7.00" });
  });
});
