/**
 * Отчёт «Визиты без заказа» — на подобранном засеве, через настоящую ручку.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Директор видел «двадцать визитов, восемь заказов» и не знал, что за
 * остальными: причин не записывали, отчёта по ним не было.
 *
 * ── Что проверяется (настоящая база, reports.noOrderVisits) ─────────────────
 *
 *  Засев: два агента, четыре магазина (два на территории), визиты за неделю с
 *  причинами, заказами, пропусками; визит вне периода; визит чужой
 *  организации; заказ, оформленный после отметки «без заказа».
 *
 *  1. Итоги: визитов, с заказом, без заказа, доля, «не указана».
 *  2. Разбивка по причинам — числа и доли от визитов без заказа.
 *  3. По агентам — визиты, без заказа, доля, частая причина.
 *  4. По магазинам — «подряд» с последнего визита (заказ обрывает серию),
 *     последняя причина; магазин без визитов без заказа в список не идёт.
 *  5. Подсказки: «3 раза подряд — есть остаток», «берёт у конкурента».
 *  6. Фильтры: агент, территория, период.
 *  7. Права: агенту и мерчендайзеру — FORBIDDEN; офису и супервайзеру — да.
 *     Период длиннее года — BAD_REQUEST.
 *
 * Нарочные поломки (каждая роняет свою проверку):
 *   • в services/no-order-visits.ts убрать `p.status = 'visited'` — 1;
 *   • там же в серии убрать `r.hasOrder ||` из условия обрыва — 4 и 5;
 *   • там же убрать `s.territory_id = …` из фильтра — 6;
 *   • там же убрать `p.tenant_id = ${tenantId}` — 1 (чужой визит в итогах).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import * as schema from "@db/schema";
import type { NoOrderReason } from "@contracts/no-order-reason";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

describe.skipIf(!hasRealDb)("отчёт «Визиты без заказа»", () => {
  let db: ServiceDb;
  let s: Seeded;
  let agentB: number;
  let shops: { alfa: number; beta: number; gamma: number; delta: number };
  let t1: number;
  let n = 0;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });

  async function day(k: number): Promise<string> {
    const r = await db.execute(sql`SELECT DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL ${k} DAY), '%Y-%m-%d') AS d`);
    return String((r as unknown as [Array<{ d: string }>])[0][0].d);
  }
  async function visit(agentId: number, shopId: number, k: number, status: "visited" | "skipped" | "planned", reason: NoOrderReason | null, tenantId = s.tenantId) {
    await db.insert(schema.dailyPlans).values({
      tenantId, agentId, shopId, planDate: sql`${await day(k)}` as never, status, noOrderReason: reason,
    });
  }
  async function order(agentId: number, shopId: number, k: number) {
    await db.insert(schema.orders).values({
      tenantId: s.tenantId, shopId, agentId, orderNumber: `№R-${++n}`, status: "new", paymentMethod: "cash",
      subtotal: "100.00", total: "100.00", createdAt: sql`DATE_SUB(NOW(), INTERVAL ${k} DAY)`,
    } as never);
  }

  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    await db.execute(sql`DELETE FROM territories WHERE tenant_id IN (${s.tenantId}, ${s.otherTenantId})`);
    const [u] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Бобур", email: "b@test.local", passwordHash: "x", role: "agent" });
    agentB = Number(u.insertId);
    const [t] = await db.insert(schema.territories).values({ tenantId: s.tenantId, name: "Юнусабад" });
    t1 = Number(t.insertId);
    await db.update(schema.shops).set({ territoryId: t1 }).where(sql`id = ${s.shopId}`);
    const mk = async (name: string, territoryId: number | null) =>
      Number((await db.insert(schema.shops).values({ tenantId: s.tenantId, name, territoryId }))[0].insertId);
    shops = { alfa: s.shopId, beta: await mk("Бета", t1), gamma: await mk("Гамма", null), delta: await mk("Дельта", null) };
    const A = s.agentId, B = agentB;

    // Агент A
    await visit(A, shops.alfa, 1, "visited", "has_stock");
    await visit(A, shops.alfa, 2, "visited", "has_stock");
    await visit(A, shops.alfa, 3, "visited", "has_stock");
    await visit(A, shops.alfa, 4, "visited", null); await order(A, shops.alfa, 4);
    await visit(A, shops.beta, 1, "visited", "competitor");
    await visit(A, shops.beta, 5, "visited", "competitor");
    // Отмечен «без заказа», а заказ оформлен потом — визит с заказом.
    await visit(A, shops.delta, 1, "visited", "closed"); await order(A, shops.delta, 1);
    // Агент B
    await visit(B, shops.gamma, 1, "visited", null); // старая мобилка
    await visit(B, shops.gamma, 2, "visited", null); await order(B, shops.gamma, 2);
    await visit(B, shops.gamma, 3, "visited", "no_money");
    await visit(B, shops.alfa, 6, "visited", "closed");
    // Не визиты: пропуск и план; вне периода; чужая организация.
    await visit(A, shops.beta, 2, "skipped", null);
    await visit(B, shops.beta, 0, "planned", null);
    await visit(A, shops.beta, 40, "visited", "competitor");
    const [oa] = await db.insert(schema.users).values({ tenantId: s.otherTenantId, name: "Чужой", email: "x@other.local", passwordHash: "x", role: "agent" });
    const [os] = await db.insert(schema.shops).values({ tenantId: s.otherTenantId, name: "Чужой магазин" });
    await visit(Number(oa.insertId), Number(os.insertId), 1, "visited", "no_money", s.otherTenantId);
  });

  const reports = async () => (await import("../../reports-router")).reportsRouter;
  const as = async (role: string) => (await reports()).createCaller(ctxFor(db, s.tenantId, s.agentId, role));
  const month = async () => ({ dateFrom: await day(30), dateTo: await day(0) });

  it("1–5. итоги, причины, агенты, магазины и подсказки сходятся с засевом", async () => {
    const r = await (await as("ceo")).noOrderVisits(await month());

    expect(r.totals).toEqual({ visits: 11, withOrder: 3, withoutOrder: 8, share: 8 / 11, unspecified: 1 });

    // По убыванию: сначала «есть остаток», затем «конкурент», дальше единицы.
    expect(r.byReason.slice(0, 2).map(x => [x.reason, x.count])).toEqual([["has_stock", 3], ["competitor", 2]]);
    const byReason = Object.fromEntries(r.byReason.map(x => [String(x.reason), x]));
    expect(byReason.has_stock).toMatchObject({ count: 3, share: 3 / 8 });
    expect(byReason.competitor).toMatchObject({ count: 2, share: 2 / 8 });
    expect(byReason.no_money).toMatchObject({ count: 1, share: 1 / 8 });
    expect(byReason.closed).toMatchObject({ count: 1, share: 1 / 8 });
    expect(byReason.null, "визит без причины (старая мобилка) пропал из разбивки").toMatchObject({ count: 1, share: 1 / 8 });
    expect(r.byReason.reduce((a, x) => a + x.count, 0)).toBe(8);

    const agentA = r.byAgent.find(a => a.agentId === s.agentId)!;
    const agentBRow = r.byAgent.find(a => a.agentId === agentB)!;
    expect(agentA).toMatchObject({ visits: 7, withoutOrder: 5, share: 5 / 7, topReason: "has_stock" });
    expect(agentBRow).toMatchObject({ agentName: "Бобур", visits: 4, withoutOrder: 3, share: 3 / 4 });
    expect(agentBRow.topReason, "частая причина — «не указана», хотя есть названные").not.toBeNull();

    const shop = (id: number) => r.byShop.find(x => x.shopId === id);
    expect(shop(shops.alfa)).toMatchObject({ visits: 5, withoutOrder: 4, streak: { reason: "has_stock", count: 3 }, last: { reason: "has_stock", day: await day(1) } });
    expect(shop(shops.beta)).toMatchObject({ visits: 2, withoutOrder: 2, streak: { reason: "competitor", count: 2 } });
    expect(shop(shops.gamma)).toMatchObject({ visits: 3, withoutOrder: 2, streak: { reason: null, count: 1 } });
    expect(shop(shops.delta), "магазин, где все визиты с заказом, попал в список «без заказа»").toBeUndefined();
    expect(r.byShop[0].shopId, "сверху — кто дольше подряд без заказа").toBe(shops.alfa);

    expect(r.stockStreaks).toEqual([{ shopId: shops.alfa, shopName: "Магазин Альфа", count: 3 }]);
    expect(r.competitorShops).toEqual([{ shopId: shops.beta, shopName: "Бета", city: null, count: 2, lastDay: await day(1), agentName: "Агент" }]);
    expect(r.truncated).toBe(false);
  });

  it("6. фильтры: агент, территория, период", async () => {
    const caller = await as("supervisor");
    const byB = await caller.noOrderVisits({ ...(await month()), agentId: agentB });
    expect(byB.totals).toMatchObject({ visits: 4, withoutOrder: 3 });
    expect(byB.stockStreaks).toEqual([]);
    expect(byB.byAgent.map(a => a.agentId)).toEqual([agentB]);

    const inT1 = await caller.noOrderVisits({ ...(await month()), territoryId: t1 });
    expect(inT1.totals).toMatchObject({ visits: 7, withoutOrder: 6 });
    expect(new Set(inT1.byShop.map(x => x.shopId))).toEqual(new Set([shops.alfa, shops.beta]));

    const lastDays = await caller.noOrderVisits({ dateFrom: await day(3), dateTo: await day(0) });
    expect(lastDays.totals).toMatchObject({ visits: 8, withOrder: 2, withoutOrder: 6 });

    const withOld = await caller.noOrderVisits({ dateFrom: await day(60), dateTo: await day(0) });
    expect(withOld.totals.visits, "визит 40 дней назад не вошёл в двухмесячный период").toBe(12);
  });

  it("7. права: агенту и мерчендайзеру — нет; офису — да; период больше года — отказ", async () => {
    await expect((await as("agent")).noOrderVisits(await month())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect((await as("merchandiser")).noOrderVisits(await month())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await (await as("operator")).noOrderVisits(await month())).totals.visits).toBe(11);
    await expect((await as("ceo")).noOrderVisits({ dateFrom: await day(400), dateTo: await day(0) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
