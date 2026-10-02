/**
 * «Карта продаж» — на настоящей MySQL, через reports.salesMap.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Карты не было: где покупают и где перестали, директор узнавал от агентов.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Период — последние 30 дней, прошлый — 30 дней до него.
 *
 *   «Альфа»   территория «Юнусабад», агент А, координаты: доставлено 1 000
 *             10 дней назад, возврат 300 по нему 5 дней назад; 2 000 — в
 *             прошлом периоде → выручка 700, прошлый 2 000, заказывает;
 *   «Бета»    та же территория, координаты: 500 в прошлом периоде, в этом —
 *             ничего; визит без заказа «у конкурента» → перестал, светофор
 *             и причина приложены;
 *   «Гамма»   район «Чиланзар», агент уволен, без координат: отменённый
 *             заказ в периоде не считается, доставленный 100 дней назад —
 *             окно «до» → перестал, денег в прошлом периоде нет;
 *   «Дельта»  « чиланзар», агент Б: заказ ещё не доставлен → заказывает,
 *             выручки нет;
 *   «Эпсилон» без района, с координатами, заказов нет → не заказывает,
 *             квартал сетки, агента нет;
 *   «Архив»   в архиве, 250 в периоде → не на карте, строкой «в архиве».
 *
 *  1. Выручка по правилу отчётов: сумма по магазинам + архив = выручка P&L.
 *  2. Состояния, районы, вердикты, агенты (уволенный — не агент; зона —
 *     первой в «кого отправить»).
 *  3. Отбор по агенту — свои и зоны; по территории.
 *  4. Права: директор, офис, супервайзер — да; агент и мерчендайзер — отказ.
 *  5. Чужая организация не влияет.
 *
 * ── Нарочные поломки ────────────────────────────────────────────────────────
 *
 *  • в services/sales-map.ts убрать вычитание возвратов — падает 1;
 *  • в запросе активности убрать `status <> 'cancelled'` — «Гамма» становится
 *    «заказывает», падает 2;
 *  • активность только по доставленным — «Дельта» (заказ везут) становится
 *    «не заказывает», падает 2;
 *  • соединение с агентом без `status = 'active'` — уволенный становится
 *    агентом района, падает 2;
 *  • reports.salesMap на reportsQuery — падает 4 (мерчендайзер).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import { invalidateReports } from "../../lib/report-cache";
import { periodGross } from "../../services/period-gross";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

/** Даты от сегодняшнего дня по UTC — так же, как их видит MySQL в CURDATE() стенда. */
const dayAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const FROM = dayAgo(29);
const TO = dayAgo(0);

describe.skipIf(!hasRealDb)("Карта продаж", () => {
  let db: ServiceDb;
  let s: Seeded;
  let n = 0;
  const sh: Record<string, number> = {};
  let agentB = 0;
  let territory = 0;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });

  async function order(shopId: number, total: number, daysAgo: number, status = "delivered", tenantId?: number, agentId?: number) {
    const [row] = await db.insert(schema.orders).values({
      tenantId: tenantId ?? s.tenantId, shopId, agentId: agentId ?? s.agentId, orderNumber: `№M-${++n}`, status, paymentMethod: "cash",
      subtotal: total.toFixed(2), total: total.toFixed(2),
      // Целыми секундами: MySQL округляет дробные вверх.
      createdAt: sql`DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-%d 12:00:00'), INTERVAL ${daysAgo} DAY)`,
    } as never);
    return Number(row.insertId);
  }
  async function shop(name: string, extra: Record<string, unknown> = {}) {
    const [r] = await db.insert(schema.shops).values({ tenantId: s.tenantId, name, ...extra } as never);
    return Number(r.insertId);
  }

  beforeEach(async () => {
    // Территории и зоны агентов чистит harness (truncateAll).
    await truncateAll();
    s = await seed();
    await invalidateReports(s.tenantId, "test");

    const [b] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Бобур", email: "b@test.local", passwordHash: "x", role: "agent" });
    agentB = Number(b.insertId);
    const [gone] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Уволен", email: "gone@test.local", passwordHash: "x", role: "agent", status: "inactive" } as never);
    const [ter] = await db.insert(schema.territories).values({ tenantId: s.tenantId, name: "Юнусабад" });
    territory = Number(ter.insertId);
    await db.insert(schema.agentTerritories).values({ tenantId: s.tenantId, agentId: agentB, territoryId: territory });

    sh.alfa = s.shopId;
    await db.update(schema.shops).set({ territoryId: territory, agentId: s.agentId, gpsLat: "41.30000000", gpsLng: "69.28000000" } as never)
      .where(sql`id = ${s.shopId}`);
    sh.beta = await shop("Бета", { territoryId: territory, agentId: s.agentId, gpsLat: "41.31000000", gpsLng: "69.29000000" });
    sh.gamma = await shop("Гамма", { district: "Чиланзар", city: "Ташкент", agentId: Number(gone.insertId) });
    sh.delta = await shop("Дельта", { district: " чиланзар", city: "Ташкент", agentId: agentB, gpsLat: "41.27000000", gpsLng: "69.20000000" });
    sh.eps = await shop("Эпсилон", { gpsLat: "41.36000000", gpsLng: "69.35000000" });
    sh.arch = await shop("Архив", { status: "inactive" });

    const sold = await order(sh.alfa, 1_000, 10);
    await order(sh.alfa, 2_000, 40);
    const [ret] = await db.insert(schema.returns).values({
      tenantId: s.tenantId, shopId: sh.alfa, orderId: sold, agentId: s.agentId,
      returnNumber: "В-1", status: "completed", totalAmount: "300.00",
      createdAt: sql`DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-%d 12:00:00'), INTERVAL 5 DAY)`,
    } as never);
    await db.insert(schema.returnItems).values({ returnId: Number(ret.insertId), productId: s.productId, quantity: "3.00", unitPrice: "100.00", subtotal: "300.00" } as never);

    await order(sh.beta, 500, 45);
    await db.insert(schema.dailyPlans).values({
      tenantId: s.tenantId, agentId: s.agentId, shopId: sh.beta, planDate: sql`DATE_SUB(CURDATE(), INTERVAL 3 DAY)`,
      status: "visited", noOrderReason: "competitor",
    } as never);

    await order(sh.gamma, 800, 5, "cancelled");
    await order(sh.gamma, 600, 100);
    await order(sh.delta, 400, 2, "new", undefined, agentB);
    await order(sh.arch, 250, 3);

    // Чужая организация: огромная продажа.
    const [os] = await db.insert(schema.shops).values({ tenantId: s.otherTenantId, name: "Чужой", gpsLat: "41.30000000", gpsLng: "69.28000000" } as never);
    await order(Number(os.insertId), 9_000_000, 1, "delivered", s.otherTenantId);
  });

  const caller = async (role = "ceo") =>
    (await import("../../reports-router")).reportsRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, role));

  it("выручка по правилу отчётов: магазины + архив = выручка P&L", async () => {
    const m = await (await caller()).salesMap({ from: FROM, to: TO });
    const pnl = await periodGross(db as never, s.tenantId, FROM, TO);
    expect(m.totals.revenue).toBe(700);
    expect(m.outside).toEqual({ revenue: 250, prevRevenue: 0 });
    expect(m.totals.revenue + m.outside!.revenue).toBe(Math.round(pnl.revenue));
    expect(m.totals.prevRevenue).toBe(2_500);
    expect(m.from).toBe(FROM);
    expect(m.prevTo).toBe(dayAgo(30));
  });

  it("состояния, районы и вердикты; уволенный агент — не агент; зона — первой", async () => {
    const m = await (await caller()).salesMap({ from: FROM, to: TO });
    const state = (id: number) => m.points.find(p => p.id === id)?.state;
    expect(state(sh.alfa)).toBe("buying");
    expect(state(sh.beta)).toBe("silent");
    expect(state(sh.delta)).toBe("buying");
    expect(state(sh.eps)).toBe("idle");
    expect(m.points.map(p => p.id)).not.toContain(sh.gamma);
    expect(m.points.find(p => p.id === sh.delta)?.revenue).toBe(0);

    expect(m.totals).toMatchObject({ shops: 5, buying: 2, silent: 2, idle: 1, noGps: 1, silentLost: 500 });
    expect(m.silent.map(x => x.name)).toEqual(["Бета", "Гамма"]);
    const beta = m.silent[0];
    expect(beta.light?.color).toMatch(/red|yellow|green/);
    expect(beta.lastNoOrder?.reason).toBe("competitor");
    expect(m.silent[1]).toMatchObject({ prevRevenue: 0, hasGps: false, agentName: null });

    const yun = m.areas.find(a => a.kind === "territory")!;
    expect(yun).toMatchObject({ name: "Юнусабад", shops: 2, buying: 1, silent: 1, revenue: 700, prevRevenue: 2_500, status: "send", suggestedAgentId: agentB });
    expect(yun.silentShopIds).toEqual([sh.beta]);
    expect(yun.agents.map(a => a.name)).toEqual(["Агент", "Бобур"]);
    const chil = m.areas.find(a => a.kind === "district")!;
    expect(chil).toMatchObject({ name: "Чиланзар", city: "Ташкент", shops: 2, noGps: 1, agents: [{ id: agentB, name: "Бобур", shops: 1 }] });
    const grid = m.areas.find(a => a.kind === "grid")!;
    expect(grid).toMatchObject({ anchor: "Эпсилон", idle: 1, status: "watch" });
    expect(grid.reasons.map(r => r.code)).toEqual(["no_agent"]);
    expect(m.areas[0].key).toBe(yun.key);
  });

  it("отбор: агент — свои и зоны; территория", async () => {
    const c = await caller("supervisor");
    const b = await c.salesMap({ from: FROM, to: TO, agentId: agentB });
    expect(b.points.map(p => p.id).sort((x, y) => x - y)).toEqual([sh.alfa, sh.beta, sh.delta].sort((x, y) => x - y));
    expect(b.outside).toBeNull();
    const t = await c.salesMap({ from: FROM, to: TO, territoryId: territory });
    expect(t.totals).toMatchObject({ shops: 2, revenue: 700 });
  });

  it("права: директор, офис, супервайзер — да; агент и мерчендайзер — отказ; период не длиннее года", async () => {
    for (const role of ["ceo", "operator", "supervisor"]) {
      await expect((await caller(role)).salesMap({ from: FROM, to: TO })).resolves.toBeTruthy();
    }
    for (const role of ["agent", "merchandiser"]) {
      await expect((await caller(role)).salesMap({ from: FROM, to: TO })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect((await caller()).salesMap({ from: "2097-01-01", to: "2099-01-01" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
