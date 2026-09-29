import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

/**
 * Плитки «Приходов» — по всем приходам, а не по странице.
 *
 * Что было: «Всего приходов», «Расходы», «Завершены» и «Долг поставщикам»
 * складывались на экране из 25 строк текущей страницы. Долг поставщикам
 * выходил заниженным и менялся от листания, хотя директор читает его как весь
 * долг («Долг поставщикам — сумма по незакрытым поставкам»).
 *
 * Что проверяется — на настоящей базе, 30 приходов (больше страницы):
 *   · сводка одинакова на первой и второй странице и равна сумме по всем;
 *   · долг разложен по валютам: доллары не подмешаны к сумам;
 *   · фильтр статуса сужает и сводку; чужая организация не попадает.
 *
 * Нарочная поломка: в arrival.list считай сводку по `data` (строкам страницы)
 * — падает «одинакова на каждой странице»; убери условие по валюте — падает
 * «доллары отдельно».
 */
describe.skipIf(!hasRealDb)("arrival.list: сводка над списком — по всем приходам", () => {
  let db: ServiceDb;
  let s: Seeded;
  const N = 30;
  const expected = { total: N, expenses: 0, completed: 0, debtUzs: 0, debtUsd: 0, completedOnly: { total: 0, expenses: 0, debtUzs: 0 } };

  beforeAll(async () => { db = await connectRealDb(); }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    Object.assign(expected, { expenses: 0, completed: 0, debtUzs: 0, debtUsd: 0, completedOnly: { total: 0, expenses: 0, debtUzs: 0 } });
    const d = db as any;
    const [sup] = await d.insert(schema.suppliers).values({ tenantId: s.tenantId, name: "Завод" });
    const supplierId = Number(sup.insertId);

    for (let i = 1; i <= N; i++) {
      const status = i % 3 === 0 ? "completed" : "pending";
      const expense = 10 * i;
      const [a] = await d.insert(schema.arrivals).values({
        tenantId: s.tenantId, arrivalNumber: `ARR-${i}`, arrivalDate: new Date("2026-09-01"), status,
        fuelCost: String(expense), tollCost: "0.00", otherCost: "0.00", totalExpense: String(expense),
      });
      const arrivalId = Number(a.insertId);
      // Каждый десятый — долларовая поставка, остальные в сумах.
      const currency = i % 10 === 0 ? "USD" : "UZS";
      const amount = 1000 * i;
      const [sp] = await d.insert(schema.supplies).values({
        tenantId: s.tenantId, supplierId, arrivalId, supplyNumber: `SUP-${i}`, amount: String(amount), currency, supplyDate: new Date("2026-09-01"),
      });
      // По нечётным заплачено 300 — долг меньше суммы поставки.
      const paid = i % 2 === 1 ? 300 : 0;
      if (paid) await d.insert(schema.supplierPayments).values({ tenantId: s.tenantId, supplierId, supplyId: Number(sp.insertId), amount: String(paid), paidAt: new Date() });

      expected.expenses += expense;
      if (status === "completed") expected.completed++;
      if (currency === "USD") expected.debtUsd += amount - paid; else expected.debtUzs += amount - paid;
      if (status === "completed") {
        expected.completedOnly.total++;
        expected.completedOnly.expenses += expense;
        if (currency === "UZS") expected.completedOnly.debtUzs += amount - paid;
      }
    }

    // Соседняя организация: её приход и долг в сводку попасть не должны.
    const [oa] = await d.insert(schema.arrivals).values({
      tenantId: s.otherTenantId, arrivalNumber: "ARR-OTHER", arrivalDate: new Date("2026-09-01"), status: "completed",
      fuelCost: "777.00", tollCost: "0.00", otherCost: "0.00", totalExpense: "777.00",
    });
    const [os] = await d.insert(schema.suppliers).values({ tenantId: s.otherTenantId, name: "Чужой завод" });
    await d.insert(schema.supplies).values({
      tenantId: s.otherTenantId, supplierId: Number(os.insertId), arrivalId: Number(oa.insertId), supplyNumber: "SUP-OTHER", amount: "99999.00", currency: "UZS", supplyDate: new Date("2026-09-01"),
    });
  });

  const list = async (input: Record<string, unknown>) =>
    (await import("../../arrival-router")).arrivalRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "operator")).list(input as never);

  it("одинакова на каждой странице и равна сумме по всем приходам", async () => {
    const p1 = await list({ page: 1, pageSize: 25 });
    const p2 = await list({ page: 2, pageSize: 25 });
    expect(p1.data).toHaveLength(25);
    expect(p2.data).toHaveLength(5);
    const want = { total: N, expenses: expected.expenses, completed: expected.completed, debtUzs: expected.debtUzs, debtUsd: expected.debtUsd };
    expect(p1.summary, "сводка первой страницы — не по всем приходам").toEqual(want);
    expect(p2.summary, "сводка меняется от листания").toEqual(want);
  });

  it("доллары отдельно: в долг в сумах не подмешаны", async () => {
    const { summary } = await list({ page: 1, pageSize: 25 });
    expect(summary.debtUsd).toBe(10000 + 20000 + 30000); // приходы 10, 20, 30 — без оплат
    expect(summary.debtUzs).toBe(expected.debtUzs);
    expect(summary.debtUzs + summary.debtUsd).toBe(expected.debtUzs + expected.debtUsd);
  });

  it("фильтр статуса сужает и сводку", async () => {
    const { summary, total } = await list({ page: 1, pageSize: 25, status: "completed" });
    expect(total).toBe(expected.completedOnly.total);
    expect(summary).toMatchObject({
      total: expected.completedOnly.total, completed: expected.completedOnly.total,
      expenses: expected.completedOnly.expenses, debtUzs: expected.completedOnly.debtUzs,
    });
  });
});
