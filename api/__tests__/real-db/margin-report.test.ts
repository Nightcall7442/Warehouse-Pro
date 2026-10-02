/**
 * «Прибыль» по товарам, магазинам и агентам — на настоящей MySQL, через
 * настоящие ручки (reports.margin и analytics.pnl).
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Валовая прибыль жила одним числом в P&L. Кто её съедает — товар, проданный
 * ниже себестоимости, магазин со скидкой, агент с возвратами — видно не было.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Подобранные заказы, где каждое число считается руками:
 *
 *   Заказ 1 (агент А, «Альфа»), скидка 10%:
 *     Товар     10 × 100, себест. 60   = 1000
 *     Второй     4 × 250, себест. 300  = 1000   ← ниже себестоимости на 200
 *     сумма 2000, скидка 200, итого 1800 → каждой строке по 900
 *   Заказ 2 (агент Б, «Бета»):
 *     Товар      5 × 100, себест. 60   = 500
 *     Без себ.   2 × 500, себест. 0    = 1000
 *   Заказ 3 (агент Б, «Бета»):
 *     Тонкий    10 × 100, себест. 96   = 1000   ← маржа 4%; по прайс-листу,
 *                                                  карточка 120 → ступень −200
 *   Возврат по заказу 1: Товар 2 шт., документ на 180 (себест. 2 × 60 = 120)
 *   Мимо: удалённый и отменённый заказы, заказ чужой организации.
 *
 *   Товар:    1400 − 180 = 1220; себест. 600 + 300 − 120 = 780; прибыль 440
 *   Второй:   900; 1200; −300 — в минус
 *   Без себ.: 1000; 0; 1000 — «маржа завышена»
 *   Тонкий:   1000; 960; 40 — 4% при доле 24% — низкая маржа
 *   Итого:    4120; 2940; 1180 — ровно P&L за тот же период.
 *
 *  1. Строки по товарам, магазинам и агентам — до сума; тревога и причины.
 *  2. Итог валовой прибыли совпадает с analytics.pnl (а не с копией запроса).
 *  3. Заказ без строк товаров — сверка честно говорит «не сходится» и на
 *     сколько.
 *  4. Себестоимость и маржа — только тем, кому открыт P&L: офис, супервайзер,
 *     мерчендайзер и агент получают отказ.
 *  5. Чужая организация не влияет ни на строки, ни на итог.
 *
 * ── Нарочные поломки ────────────────────────────────────────────────────────
 *
 *  • выручка строки без доли orders.total (`net` = сумма строки) — падают
 *    «по товарам» и «сходится с P&L»;
 *  • убрать вычет возвратов по товару — падает «по товарам» (Товар 1400);
 *  • margin: financeQuery → reportsQuery — падает «права».
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import { invalidateReports } from "../../lib/report-cache";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

/*
  Окно вокруг сегодняшнего дня, а не «2000–2999»: отчёт принимает период до
  года (длиннее — отказ). Заказы и возвраты ниже создаются «сейчас» — окно
  в ±30 дней накрывает их при любом поясе базы.
*/
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const FROM = ymd(new Date(Date.now() - 30 * 86_400_000));
const TO = ymd(new Date(Date.now() + 30 * 86_400_000));

describe.skipIf(!hasRealDb)("«Прибыль»: маржа по товару, магазину и агенту", () => {
  let db: ServiceDb;
  let s: Seeded;
  let agentB: number;
  let shopB: number;
  let noCostId: number;
  let thinId: number;
  let n = 0;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });

  async function order(o: {
    tenantId?: number; agentId: number; shopId: number; status?: string; deleted?: boolean;
    subtotal: string; discount?: string; total: string;
    lines: Array<{ productId: number; qty: string; price: string; cost: string; priceListId?: number }>;
  }) {
    const [row] = await db.insert(schema.orders).values({
      tenantId: o.tenantId ?? s.tenantId, shopId: o.shopId, agentId: o.agentId,
      orderNumber: `№M-${++n}`, status: (o.status ?? "delivered") as never, paymentMethod: "cash",
      subtotal: o.subtotal, discount: o.discount ?? "0.00", total: o.total,
      deletedAt: o.deleted ? new Date() : null,
    } as never);
    const orderId = Number(row.insertId);
    for (const l of o.lines) {
      await db.insert(schema.orderItems).values({
        orderId, productId: l.productId, quantity: l.qty, unitPrice: l.price, costPrice: l.cost,
        subtotal: (Number(l.qty) * Number(l.price)).toFixed(2), priceListId: l.priceListId ?? null,
      } as never);
    }
    return orderId;
  }

  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    await invalidateReports(s.tenantId, "test");
    await invalidateReports(s.otherTenantId, "test");
    const [u] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Бобур", email: "b@test.local", passwordHash: "x", role: "agent" });
    agentB = Number(u.insertId);
    shopB = Number((await db.insert(schema.shops).values({ tenantId: s.tenantId, name: "Бета", city: "Самарканд" }))[0].insertId);
    noCostId = Number((await db.insert(schema.products).values({ tenantId: s.tenantId, code: "P-3", name: "Без себестоимости", unitPrice: "500.00" }))[0].insertId);
    thinId = Number((await db.insert(schema.products).values({ tenantId: s.tenantId, code: "P-4", name: "Тонкий", unitPrice: "120.00" }))[0].insertId);

    const first = await order({
      agentId: s.agentId, shopId: s.shopId, subtotal: "2000.00", discount: "200.00", total: "1800.00",
      lines: [
        { productId: s.productId, qty: "10.00", price: "100.00", cost: "60.00" },
        { productId: s.secondProductId, qty: "4.00", price: "250.00", cost: "300.00" },
      ],
    });
    await order({
      agentId: agentB, shopId: shopB, subtotal: "1500.00", total: "1500.00",
      lines: [
        { productId: s.productId, qty: "5.00", price: "100.00", cost: "60.00" },
        { productId: noCostId, qty: "2.00", price: "500.00", cost: "0.00" },
      ],
    });
    await order({
      agentId: agentB, shopId: shopB, subtotal: "1000.00", total: "1000.00",
      lines: [{ productId: thinId, qty: "10.00", price: "100.00", cost: "96.00", priceListId: 77 }],
    });
    // Мимо выручки: удалённый и отменённый.
    await order({ agentId: s.agentId, shopId: s.shopId, deleted: true, subtotal: "9000.00", total: "9000.00",
      lines: [{ productId: s.productId, qty: "90.00", price: "100.00", cost: "10.00" }] });
    await order({ agentId: s.agentId, shopId: s.shopId, status: "cancelled", subtotal: "7000.00", total: "7000.00",
      lines: [{ productId: s.productId, qty: "70.00", price: "100.00", cost: "10.00" }] });

    // Возврат двух штук «Товара» по первому заказу — документ на 180.
    const [ret] = await db.insert(schema.returns).values({
      tenantId: s.tenantId, shopId: s.shopId, orderId: first, agentId: s.agentId,
      returnNumber: "В-1", status: "completed", totalAmount: "180.00",
    } as never);
    await db.insert(schema.returnItems).values({
      returnId: Number(ret.insertId), productId: s.productId, quantity: "2.00", unitPrice: "100.00", subtotal: "200.00",
    } as never);

    // Чужая организация: свой агент, магазин, товар и крупный заказ.
    const [oa] = await db.insert(schema.users).values({ tenantId: s.otherTenantId, name: "Чужой", email: "x@other.local", passwordHash: "x", role: "agent" });
    const [os] = await db.insert(schema.shops).values({ tenantId: s.otherTenantId, name: "Чужой магазин" });
    const [op] = await db.insert(schema.products).values({ tenantId: s.otherTenantId, code: "X-1", name: "Чужой товар", unitPrice: "10.00" });
    await order({ tenantId: s.otherTenantId, agentId: Number(oa.insertId), shopId: Number(os.insertId), subtotal: "50000.00", total: "50000.00",
      lines: [{ productId: Number(op.insertId), qty: "5000.00", price: "10.00", cost: "20.00" }] });
  });

  const reports = async (role = "ceo", tenantId?: number) =>
    (await import("../../reports-router")).reportsRouter.createCaller(ctxFor(db, tenantId ?? s.tenantId, s.agentId, role));
  const analytics = async () =>
    (await import("../../analytics-router")).analyticsRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "ceo"));

  it("по товарам: выручка после скидки и возвратов, себестоимость, прибыль, тревога и причины", async () => {
    const r = await (await reports()).margin({ from: FROM, to: TO, by: "product" });
    const by = Object.fromEntries(r.rows.map(x => [x.name, x]));
    expect(r.rows.map(x => x.name)).toEqual(["Товар", "Без себестоимости", "Тонкий", "Второй товар"]);

    expect(by["Товар"]).toMatchObject({ revenue: 1220, cost: 780, profit: 440, marginPct: 36.1, flag: null, qty: 15, orders: 2 });
    expect(by["Товар"].reasons).toEqual([{ code: "returns", amount: 180, pct: 13 }]);

    expect(by["Второй товар"]).toMatchObject({ revenue: 900, cost: 1200, profit: -300, flag: "loss" });
    expect(by["Второй товар"].reasons).toEqual([
      { code: "below_cost", amount: 200 },
      { code: "discount", amount: 100, pct: 10 },
    ]);

    expect(by["Без себестоимости"]).toMatchObject({ revenue: 1000, cost: 0, profit: 1000, flag: null });
    expect(by["Без себестоимости"].reasons).toEqual([{ code: "no_cost", amount: 1000 }]);

    expect(by["Тонкий"]).toMatchObject({ revenue: 1000, cost: 960, profit: 40, marginPct: 4, flag: "low" });
    expect(by["Тонкий"].reasons).toEqual([{ code: "price_list", amount: 200, pct: 17 }]);

    expect(r.totals).toEqual({ revenue: 4120, cost: 2940, profit: 1180, marginPct: 28.6, flagged: 2 });
    // Доля в прибыли: 440 из 1180.
    expect(by["Товар"].profitShare).toBe(37.3);
    expect(by["Второй товар"].profitShare).toBe(-25.4);
  });

  it("по магазинам и по агентам — те же деньги, другой разрез", async () => {
    const shops = await (await reports()).margin({ from: FROM, to: TO, by: "shop" });
    const s1 = shops.rows.find(x => x.key === s.shopId)!;
    const s2 = shops.rows.find(x => x.key === shopB)!;
    // «Альфа»: 1800 − 180 = 1620; 1800 − 120 = 1680 — в минус на 60.
    expect(s1).toMatchObject({ name: "Магазин Альфа", revenue: 1620, cost: 1680, profit: -60, flag: "loss" });
    expect(s2).toMatchObject({ name: "Бета", sub: "Самарканд", revenue: 2500, cost: 1260, profit: 1240, flag: null });

    const agents = await (await reports()).margin({ from: FROM, to: TO, by: "agent" });
    expect(agents.rows.map(x => [x.key, x.revenue, x.cost, x.profit])).toEqual([
      [agentB, 2500, 1260, 1240],
      [s.agentId, 1620, 1680, -60],
    ]);
    expect(shops.totals).toEqual(agents.totals);
  });

  it("итог валовой прибыли сходится с P&L за тот же период", async () => {
    const pnl = await (await analytics()).pnl({ from: FROM, to: TO, compareWithPrev: false });
    for (const by of ["product", "shop", "agent"] as const) {
      const r = await (await reports()).margin({ from: FROM, to: TO, by });
      expect(r.pnl.matches, by).toBe(true);
      expect(r.totals.revenue, by).toBe(pnl.current.revenue);
      expect(r.totals.cost, by).toBe(pnl.current.cogs);
      expect(r.totals.profit, by).toBe(pnl.current.grossProfit);
      // Строки складываются в итог.
      expect(r.rows.reduce((a, x) => a + x.profit, 0), by).toBe(r.totals.profit);
    }
  });

  it("заказ без строк товаров — сверка говорит «не сходится» и на сколько", async () => {
    await order({ agentId: s.agentId, shopId: s.shopId, subtotal: "500.00", total: "500.00", lines: [] });
    await invalidateReports(s.tenantId, "заказ без строк");
    const r = await (await reports()).margin({ from: FROM, to: TO, by: "product" });
    expect(r.pnl.matches).toBe(false);
    expect(r.pnl.diff).toEqual({ revenue: 500, cost: 0 });
    expect(r.pnl.revenue).toBe(4620);
    expect(r.totals.revenue).toBe(4120);
  });

  it("права: себестоимость и маржу получает только тот, кому открыт P&L", async () => {
    for (const role of ["operator", "supervisor", "merchandiser", "agent", "courier"]) {
      await expect((await reports(role)).margin({ from: FROM, to: TO, by: "product" }), role)
        .rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("чужая организация не влияет — и сама видит только своё", async () => {
    const ours = await (await reports()).margin({ from: FROM, to: TO, by: "product" });
    expect(ours.rows.some(x => x.name === "Чужой товар")).toBe(false);
    const theirs = await (await reports("ceo", s.otherTenantId)).margin({ from: FROM, to: TO, by: "product" });
    expect(theirs.rows.map(x => [x.name, x.revenue, x.cost, x.profit, x.flag])).toEqual([["Чужой товар", 50000, 100000, -50000, "loss"]]);
    expect(theirs.totals.revenue).toBe(50000);
  });

  it("период: заказы вне окна не попадают; возврат считается в месяце проведения", async () => {
    await db.execute(sql`UPDATE orders SET created_at = '2030-01-15 10:00:00' WHERE tenant_id = ${s.tenantId}`);
    await db.execute(sql`UPDATE returns SET created_at = '2030-02-03 10:00:00' WHERE tenant_id = ${s.tenantId}`);
    await invalidateReports(s.tenantId, "даты");
    const jan = await (await reports()).margin({ from: "2030-01-01", to: "2030-01-31", by: "shop" });
    expect(jan.totals).toMatchObject({ revenue: 4300, cost: 3060 });
    const feb = await (await reports()).margin({ from: "2030-02-01", to: "2030-02-28", by: "shop" });
    // В феврале продаж нет — только возврат: магазин в минус на сумму документа.
    expect(feb.rows).toHaveLength(1);
    expect(feb.rows[0]).toMatchObject({ key: s.shopId, revenue: -180, cost: -120, profit: -60, flag: "loss", marginPct: null });
    expect(feb.pnl.matches).toBe(true);
  });
});
