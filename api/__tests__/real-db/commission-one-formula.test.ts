/**
 * «Рассчитать» и экран зарплаты считают комиссию одной формулой — на настоящей MySQL.
 *
 * Аудит 19.10.2026: экран зарплаты учитывал ставки по товарам
 * (services/commission-base.ts), а «Рассчитать» умножал все продажи на один
 * процент человека — и оба писали в одну и ту же строку комиссии. Финансист
 * утверждал то, что посчиталось последним: открыли зарплату — одна сумма,
 * нажали «Рассчитать» — другая.
 *
 * Здесь у одного товара своя ставка 10 %, у второго действует процент
 * человека 5 %. Продано по 100 000 каждого: комиссия 10 000 + 5 000 = 15 000,
 * а не 200 000 × 5 % = 10 000.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import { calculateSalary } from "../../services/kpi";
import { getPeriod } from "../../lib/period";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

describe.skipIf(!hasRealDb)("комиссия: одна формула у «Рассчитать» и у экрана зарплаты", () => {
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
      periodStart: sql`${"2026-09-01"}`, periodEnd: sql`${"2026-09-30"}`, status: "paid", commissionRate: "5.00",
    } as never);
    await db.insert(schema.commissionProductRates).values({ tenantId: s.tenantId, productId: s.productId, rate: "10.00" } as never);

    const moment = new Date("2026-10-10T12:00:00+05:00");
    const [o] = await db.insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, orderNumber: "№F-1",
      status: "delivered", paymentMethod: "cash", subtotal: "200000.00", total: "200000.00", createdAt: moment, deliveredAt: moment,
    } as never);
    const orderId = Number(o.insertId);
    await db.insert(schema.orderItems).values([
      { orderId, productId: s.productId, quantity: "1.00", unitPrice: "100000.00", subtotal: "100000.00" },
      { orderId, productId: s.secondProductId, quantity: "1.00", unitPrice: "100000.00", subtotal: "100000.00" },
    ] as never);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T12:00:00+05:00"));
  });

  const october = async () => {
    const rows = await db.select().from(schema.commissions).where(and(
      eq(schema.commissions.userId, s.agentId), sql`${schema.commissions.periodStart} = ${"2026-10-01"}`,
    ));
    expect(rows, "строка октября не заведена или их две").toHaveLength(1);
    return rows[0];
  };

  const recalc = async () => {
    const { commissionRouter } = await import("../../commission-router");
    return commissionRouter.createCaller(ctxFor(current, s.tenantId, ceoId, "ceo"))
      .calculate({ periodType: "monthly", periodStart: "2026-10-01", periodEnd: "2026-10-20" });
  };

  it("экран зарплаты считает по ставкам товаров: 15 000", async () => {
    const { periodStart, periodEnd } = getPeriod("month", 0);
    const salary = await calculateSalary(db as never, s.agentId, s.tenantId, periodStart, periodEnd);
    expect(salary.commissionAmount).toBe(15_000);
    expect(await october()).toMatchObject({ salesAmount: "200000.00", commissionAmount: "15000.00" });
  });

  it("«Рассчитать» после экрана зарплаты оставляет те же 15 000, а не 10 000", async () => {
    const { periodStart, periodEnd } = getPeriod("month", 0);
    await calculateSalary(db as never, s.agentId, s.tenantId, periodStart, periodEnd);
    await recalc();
    expect(await october()).toMatchObject({ salesAmount: "200000.00", commissionAmount: "15000.00" });
  });

  it("«Рассчитать» по строке, заведённой «Ставкой», тоже считает по товарам", async () => {
    const { commissionRouter } = await import("../../commission-router");
    await commissionRouter.createCaller(ctxFor(current, s.tenantId, ceoId, "ceo"))
      .setRate({ userId: s.agentId, commissionRate: 5 });
    expect(await recalc()).toMatchObject({ updated: 1 });
    expect(await october()).toMatchObject({ salesAmount: "200000.00", commissionAmount: "15000.00" });
  });

  it("без ставок по товарам «Рассчитать» считает по проценту человека, как прежде", async () => {
    await db.delete(schema.commissionProductRates).where(eq(schema.commissionProductRates.tenantId, s.tenantId));
    const { commissionRouter } = await import("../../commission-router");
    await commissionRouter.createCaller(ctxFor(current, s.tenantId, ceoId, "ceo"))
      .setRate({ userId: s.agentId, commissionRate: 5 });
    await recalc();
    expect(await october()).toMatchObject({ salesAmount: "200000.00", commissionAmount: "10000.00" });
  });
});
