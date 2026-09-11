/**
 * Оклад и план продаж — разные числа в разных таблицах.
 *
 * До этого оба писались в sales_targets.target_amount: супервайзер применял
 * нормы месяца — в ведомости появлялся «оклад» в 45 млн; директор ставил
 * оклад — план агента становился окладом. Здесь на настоящей базе: оклад
 * читается из commissions.base_salary, план — из sales_targets, и одно не
 * подменяет другое.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { calculateSalary, calculateAgentKpi } from "../../services/kpi";
import {
  hasRealDb, connectRealDb, closeRealDb, truncateAll, seed,
  type ServiceDb, type Seeded,
} from "./harness";

const describeIf = hasRealDb ? describe : describe.skip;

describeIf("оклад против плана на настоящей базе", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); });
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); s = await seed(); });

  it("зарплата берёт оклад из условий оплаты, KPI — план из норм", async () => {
    const start = new Date(2026, 8, 1); // сентябрь 2026 по локальному времени процесса
    const end = new Date(2026, 8, 30, 23, 59, 59);

    await db.insert(schema.commissions).values({
      tenantId: s.tenantId, userId: s.agentId, periodType: "monthly",
      periodStart: sql`'2026-09-01'`, periodEnd: sql`'2026-09-30'`,
      baseSalary: "3000000.00", commissionRate: "5.00",
      salesAmount: "0.00", commissionAmount: "0.00",
    } as never);
    await db.insert(schema.salesTargets).values({
      tenantId: s.tenantId, userId: s.agentId, periodType: "monthly",
      periodStart: sql`'2026-09-01'`, periodEnd: sql`'2026-09-30'`,
      targetAmount: "45000000.00",
    } as never);

    const salary = await calculateSalary(db as never, s.agentId, s.tenantId, start, end);
    const kpi = await calculateAgentKpi(db as never, s.agentId, s.tenantId, start, end);

    expect(salary.baseSalary).toBe(3_000_000);
    expect(kpi.targetRevenue).toBe(45_000_000);
  });

  it("без строки условий оплаты оклад нулевой, даже если план задан", async () => {
    const start = new Date(2026, 8, 1);
    const end = new Date(2026, 8, 30, 23, 59, 59);
    await db.insert(schema.salesTargets).values({
      tenantId: s.tenantId, userId: s.agentId, periodType: "monthly",
      periodStart: sql`'2026-09-01'`, periodEnd: sql`'2026-09-30'`,
      targetAmount: "45000000.00",
    } as never);
    const salary = await calculateSalary(db as never, s.agentId, s.tenantId, start, end);
    expect(salary.baseSalary).toBe(0);
  });
});
