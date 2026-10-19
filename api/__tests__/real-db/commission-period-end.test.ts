/**
 * Строка комиссии за месяц кончается последним днём месяца — на настоящей MySQL.
 *
 * Аудит 19.10.2026: строка нового месяца, которую заводил экран зарплаты,
 * получала period_end = день первого просмотра — getPeriod("month") текущего
 * месяца кончается «сегодня». «Рассчитать» считает каждую строку по её
 * собственным датам, и продажи после того дня в комиссию не попадали никогда.
 *
 * А строку, заведённую «Ставкой» (там period_end — конец месяца), тот же
 * «Рассчитать» не находил вовсе: экран присылает диапазон «с первого по
 * сегодня», а отбор требовал period_end <= сегодня.
 *
 * Чинят три вещи: калькулятор пишет конец месяца, «Рассчитать» отбирает
 * строки по началу периода, а миграция 0072 правит строки, уже записанные
 * с днём просмотра.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import { calculateSalary } from "../../services/kpi";
import { getPeriod, dateColumnDay } from "../../lib/period";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

const at = (iso: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
};

describe.skipIf(!hasRealDb)("строка комиссии за месяц кончается последним днём месяца", () => {
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
    // Ставка 5 % заведена в сентябре и действует дальше.
    await db.insert(schema.commissions).values({
      tenantId: s.tenantId, userId: s.agentId, periodType: "monthly",
      periodStart: sql`${"2026-09-01"}`, periodEnd: sql`${"2026-09-30"}`, status: "paid", commissionRate: "5.00",
    } as never);
    // Две доставки в октябре: до первого просмотра зарплаты и после.
    for (const [n, day, total] of [[1, "2026-10-03", "100000.00"], [2, "2026-10-15", "200000.00"]] as const) {
      const moment = new Date(`${day}T12:00:00+05:00`);
      await db.insert(schema.orders).values({
        tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, orderNumber: `№K-${n}`,
        status: "delivered", paymentMethod: "cash", subtotal: total, total, createdAt: moment, deliveredAt: moment,
      } as never);
    }
  });

  const october = async () => {
    const rows = await db.select().from(schema.commissions).where(and(
      eq(schema.commissions.userId, s.agentId), sql`${schema.commissions.periodStart} = ${"2026-10-01"}`,
    ));
    expect(rows, "строка октября не заведена или их две").toHaveLength(1);
    return rows[0];
  };

  const recalc = async (today: string) => {
    const { commissionRouter } = await import("../../commission-router");
    // Ровно то, что шлёт кнопка на экране KPI агентов: с первого числа по сегодня.
    return commissionRouter.createCaller(ctxFor(current, s.tenantId, ceoId, "ceo"))
      .calculate({ periodType: "monthly", periodStart: "2026-10-01", periodEnd: today });
  };

  it("экран зарплаты 5-го заводит строку октября по 31-е, а не по 5-е", async () => {
    at("2026-10-05T12:00:00+05:00");
    const { periodStart, periodEnd } = getPeriod("month", 0);
    await calculateSalary(db as never, s.agentId, s.tenantId, periodStart, periodEnd);
    expect(dateColumnDay((await october()).periodEnd as never)).toBe("2026-10-31");
  });

  it("«Рассчитать» 20-го считает и продажи после дня первого просмотра", async () => {
    at("2026-10-05T12:00:00+05:00");
    const { periodStart, periodEnd } = getPeriod("month", 0);
    await calculateSalary(db as never, s.agentId, s.tenantId, periodStart, periodEnd);

    at("2026-10-20T12:00:00+05:00");
    await recalc("2026-10-20");
    expect(await october()).toMatchObject({ salesAmount: "300000.00", commissionAmount: "15000.00" });
  });

  it("«Рассчитать» находит строку, заведённую «Ставкой»", async () => {
    at("2026-10-20T12:00:00+05:00");
    const { commissionRouter } = await import("../../commission-router");
    await commissionRouter.createCaller(ctxFor(current, s.tenantId, ceoId, "ceo"))
      .setRate({ userId: s.agentId, commissionRate: 5 });

    expect(await recalc("2026-10-20")).toMatchObject({ updated: 1 });
    expect(await october()).toMatchObject({ salesAmount: "300000.00", commissionAmount: "15000.00" });
  });

  it("миграция 0072 продлевает до конца месяца строки, уже записанные с днём просмотра", async () => {
    await db.insert(schema.commissions).values([
      // Испорченная экраном зарплаты — и черновик, и уже выплаченная.
      { tenantId: s.tenantId, userId: s.agentId, periodType: "monthly", periodStart: sql`${"2026-10-01"}`, periodEnd: sql`${"2026-10-05"}`, status: "pending" },
      { tenantId: s.tenantId, userId: s.courierId, periodType: "monthly", periodStart: sql`${"2026-08-01"}`, periodEnd: sql`${"2026-08-12"}`, status: "paid" },
      // Не месячная и не с первого числа — не трогать.
      { tenantId: s.tenantId, userId: ceoId, periodType: "quarterly", periodStart: sql`${"2026-07-01"}`, periodEnd: sql`${"2026-07-20"}`, status: "pending" },
      { tenantId: s.tenantId, userId: ceoId, periodType: "monthly", periodStart: sql`${"2026-06-10"}`, periodEnd: sql`${"2026-06-20"}`, status: "pending" },
    ] as never);

    const migration = readFileSync("db/migrations/0072_commission_month_end.sql", "utf-8");
    await db.execute(sql.raw(migration));
    await db.execute(sql.raw(migration)); // повтор после обрыва ничего не портит

    const ends = (await db.select().from(schema.commissions))
      .map(r => `${r.periodType} ${dateColumnDay(r.periodStart as never)}..${dateColumnDay(r.periodEnd as never)}`)
      .sort();
    expect(ends).toEqual([
      "monthly 2026-06-10..2026-06-20",
      "monthly 2026-08-01..2026-08-31",
      "monthly 2026-09-01..2026-09-30",
      "monthly 2026-10-01..2026-10-31",
      "quarterly 2026-07-01..2026-07-20",
    ]);
  });
});
