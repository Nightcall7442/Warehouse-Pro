/**
 * «Рассчитать» и экран зарплаты пишут в строку комиссии одно и то же число —
 * на настоящей MySQL.
 *
 * Аудит 19.10.2026, «Две формулы комиссии пишут в одну строку»: «Рассчитать»
 * умножал продажи на одну ставку человека, а экран зарплаты учитывал ставки
 * по товарам. Оба пишут одну и ту же месячную строку, и финансист утверждал
 * то, что посчиталось последним: у организации со ставками по товарам сумма
 * в ведомости зависела от того, кто последним нажал кнопку или открыл экран.
 *
 * Теперь оба зовут один расчёт (services/commission-base.ts, commissionFor):
 * товар со своей ставкой — по ней, остальное — по проценту человека.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import { calculateSalary } from "../../services/kpi";
import { getPeriod } from "../../lib/period";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

const at = (iso: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
};

describe.skipIf(!hasRealDb)("«Рассчитать» и экран зарплаты считают комиссию одной формулой", () => {
  let db: ServiceDb;
  let s: Seeded;
  let ceoId: number;
  let orderId: number;

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
    // Процент человека 5 %, заведён в сентябре и действует дальше.
    await db.insert(schema.commissions).values({
      tenantId: s.tenantId, userId: s.agentId, periodType: "monthly",
      periodStart: sql`${"2026-09-01"}`, periodEnd: sql`${"2026-09-30"}`, status: "paid", commissionRate: "5.00",
    } as never);
    // У первого товара своя ставка — 10 %.
    await db.insert(schema.commissionProductRates).values({
      tenantId: s.tenantId, productId: s.productId, rate: "10.00",
    } as never);
    // Одна доставка 3 октября: первого товара на 100 000, второго на 200 000.
    const moment = new Date("2026-10-03T12:00:00+05:00");
    const [order] = await db.insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, orderNumber: "№F-1",
      status: "delivered", paymentMethod: "cash", subtotal: "300000.00", total: "300000.00",
      createdAt: moment, deliveredAt: moment,
    } as never);
    orderId = Number(order.insertId);
    await db.insert(schema.orderItems).values([
      { orderId, productId: s.productId, quantity: "1000.00", unitPrice: "100.00", subtotal: "100000.00" },
      { orderId, productId: s.secondProductId, quantity: "800.00", unitPrice: "250.00", subtotal: "200000.00" },
    ] as never);
  });

  const october = async () => {
    const rows = await db.select().from(schema.commissions).where(and(
      eq(schema.commissions.userId, s.agentId), sql`${schema.commissions.periodStart} = ${"2026-10-01"}`,
    ));
    expect(rows, "строка октября не заведена или их две").toHaveLength(1);
    return rows[0];
  };

  // Ровно то, что шлёт кнопка на экране KPI агентов: с первого числа по сегодня.
  const recalc = async () => {
    const { commissionRouter } = await import("../../commission-router");
    return commissionRouter.createCaller(ctxFor(current, s.tenantId, ceoId, "ceo"))
      .calculate({ periodType: "monthly", periodStart: "2026-10-01", periodEnd: "2026-10-20" });
  };

  const salaryScreen = async () => {
    const { periodStart, periodEnd } = getPeriod("month", 0);
    return calculateSalary(db as never, s.agentId, s.tenantId, periodStart, periodEnd);
  };

  /*
    100 000 × 10 % + 200 000 × 5 % = 20 000. Одной ставкой вышло бы
    300 000 × 5 % = 15 000 — это число «Рассчитать» и писал.
  */
  it("«Рассчитать» после экрана зарплаты оставляет в строке то, что показал экран", async () => {
    at("2026-10-20T12:00:00+05:00");
    const salary = await salaryScreen();
    expect(salary.commissionAmount).toBe(20_000);
    expect(await october()).toMatchObject({ salesAmount: "300000.00", commissionAmount: "20000.00" });

    expect(await recalc()).toMatchObject({ updated: 1 });
    expect(await october()).toMatchObject({ salesAmount: "300000.00", commissionAmount: "20000.00" });
  });

  it("«Рассчитать» по строке, заведённой «Ставкой», учитывает ставки по товарам", async () => {
    at("2026-10-20T12:00:00+05:00");
    const { commissionRouter } = await import("../../commission-router");
    await commissionRouter.createCaller(ctxFor(current, s.tenantId, ceoId, "ceo"))
      .setRate({ userId: s.agentId, commissionRate: 5 });

    await recalc();
    expect(await october()).toMatchObject({ salesAmount: "300000.00", commissionAmount: "20000.00" });

    // И экран зарплаты, открытый после, ничего в строке не меняет.
    const salary = await salaryScreen();
    expect(salary.commissionAmount).toBe(20_000);
    expect(await october()).toMatchObject({ commissionAmount: "20000.00" });
  });

  /*
    Возврат первого товара на 50 000 вычитается из него самого, а не
    размазывается по обоим: 50 000 × 10 % + 200 000 × 5 % = 15 000. Одной
    ставкой — 250 000 × 5 % = 12 500.
  */
  it("возврат товара со своей ставкой вычитается из него в обоих расчётах", async () => {
    const moment = new Date("2026-10-10T12:00:00+05:00");
    const [ret] = await db.insert(schema.returns).values({
      tenantId: s.tenantId, orderId, shopId: s.shopId, agentId: s.agentId, returnNumber: "ВЗ-1",
      status: "completed", totalAmount: "50000.00", createdAt: moment,
    } as never);
    await db.insert(schema.returnItems).values({
      returnId: Number(ret.insertId), productId: s.productId, quantity: "500.00", unitPrice: "100.00", subtotal: "50000.00",
    } as never);

    at("2026-10-20T12:00:00+05:00");
    const salary = await salaryScreen();
    expect(salary.commissionAmount).toBe(15_000);

    await recalc();
    expect(await october()).toMatchObject({ salesAmount: "250000.00", commissionAmount: "15000.00" });
  });

  it("без ставок по товарам оба считают как раньше: продажи × процент человека", async () => {
    await db.delete(schema.commissionProductRates);

    at("2026-10-20T12:00:00+05:00");
    const salary = await salaryScreen();
    expect(salary.commissionAmount).toBe(15_000);

    await recalc();
    expect(await october()).toMatchObject({ salesAmount: "300000.00", commissionAmount: "15000.00" });
  });
});
