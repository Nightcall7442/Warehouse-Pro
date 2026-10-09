/**
 * «Обзор», «Топ товаров» и «Топ магазинов» — в деньгах P&L.
 * На настоящей MySQL, через настоящие ручки.
 *
 * ── Что было (аудит 09.10.2026) ─────────────────────────────────────────────
 *
 *  · Плитка «Выручка» складывала заказы до возвратов, «Топ товаров» — строки
 *    заказов по их цене (до скидки заказа и без возвратов), «Топ магазинов» —
 *    заказы без возвратов. P&L за тот же месяц — после скидки и за вычетом
 *    возвратов. Четыре числа про одни деньги на двух соседних экранах.
 *  · «Топ товаров» выбирал десятку по ЗАКАЗАННОМУ количеству — штуки вперемешку
 *    с килограммами: товар с большой выручкой и малым весом в десятку не
 *    попадал, хотя экран потом сортировал по деньгам.
 *
 * ── Данные (период — сентябрь 2026; каждое число считается руками) ──────────
 *
 *   Cola — штуки, «Напитки», 100; Сахар — килограммы, «Бакалея», 1 000.
 *   Магазины: М1 и М3 — в территории «Центр», М2 — без территории.
 *
 *   Заказ 1, агент А, М1, 02.09, скидка 10%: Cola 10 × 100 = 1 000, Сахар
 *     2,5 × 1 000 = 2 500; сумма 3 500, итого 3 150 → Cola 900, Сахар 2 250.
 *   Заказ 2, агент Б, М2, 05.09: Cola 5 × 100; итого 500.
 *   Заказ 3, агент А, М3, 20.08 (вне периода): Cola 10 × 100; итого 1 000.
 *   Мимо: заказ 05.10 и отменённый заказ 10.09.
 *   Возвраты в периоде: по заказу 1 — Cola 2 шт. на 180 (15.09); по заказу 3 —
 *     Cola 3 шт. на 300 (20.09, у М3 в сентябре только возврат); по заказу 2 —
 *     Cola 1 шт. на 100 (10.09) и документ без строк товара на 50 (12.09).
 *     Вне периода: по заказу 1 — Сахар 0,5 кг на 450 (03.10).
 *
 *   P&L: 3 150 + 500 − (180 + 300 + 100 + 50) = 3 020.
 *   Товары: Сахар 2 250; Cola 900 + 500 − 580 = 820 (продано 15, вернули 6);
 *     возврат без строк −50. Сумма 3 020.
 *   Магазины: М1 3 150 − 180 = 2 970; М2 500 − 150 = 350; М3 −300. Сумма 3 020.
 *   Агенты: А 3 150 − 480 = 2 670; Б 500 − 150 = 350. Сумма 3 020.
 *
 * ── Нарочные поломки ────────────────────────────────────────────────────────
 *
 *  • товары по цене строк (totalRevenue = grossRevenue) — падают «товары» и
 *    «одна выручка»;
 *  • порядок товаров по количеству — падает «порядок»;
 *  • магазины без вычета возвратов — падают «магазины» и «одна выручка»;
 *  • потерять магазин «только возврат» — падают «магазины» и «одна выручка»;
 *  • возвраты магазинов без отбора по территории — падает «территория»;
 *  • возвраты магазинов без отбора по агенту — падает «агент»;
 *  • вернуть .limit(10) по умолчанию на что-то другое или потерять limit —
 *    падает «десятка»;
 *  • убрать unit из cogsByProduct — падает «единица».
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import { invalidateReports } from "../../lib/report-cache";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

const FROM = "2026-09-01";
const TO = "2026-09-30";
const at = (iso: string) => new Date(`${iso}T09:00:00Z`);
const P_AND_L = 3020;

describe.skipIf(!hasRealDb)("«Обзор», «Топ товаров» и «Топ магазинов» — в деньгах P&L", () => {
  let db: ServiceDb;
  let s: Seeded;
  let agentB: number;
  let cola: number, sugar: number;
  let shop2: number, shop3: number, centre: number;
  let n = 0;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });

  async function order(o: {
    agentId: number; shopId: number; createdAt: Date; status?: string;
    subtotal: string; discount?: string; total: string;
    lines: Array<{ productId: number; qty: string; price: string }>;
  }) {
    const [row] = await db.insert(schema.orders).values({
      tenantId: s.tenantId, shopId: o.shopId, agentId: o.agentId,
      orderNumber: `№T-${++n}`, status: (o.status ?? "delivered") as never, paymentMethod: "cash",
      subtotal: o.subtotal, discount: o.discount ?? "0.00", total: o.total, createdAt: o.createdAt,
    } as never);
    const orderId = Number(row.insertId);
    for (const l of o.lines) {
      await db.insert(schema.orderItems).values({
        orderId, productId: l.productId, quantity: l.qty, unitPrice: l.price, costPrice: "0.00",
        subtotal: (Number(l.qty) * Number(l.price)).toFixed(2),
      } as never);
    }
    return orderId;
  }

  async function ret(o: { orderId: number; shopId: number; agentId: number; amount: string; createdAt: Date; lines: Array<{ productId: number; qty: string; price: string }> }) {
    const [r] = await db.insert(schema.returns).values({
      tenantId: s.tenantId, shopId: o.shopId, orderId: o.orderId, agentId: o.agentId,
      returnNumber: `В-${++n}`, status: "completed", totalAmount: o.amount, createdAt: o.createdAt,
    } as never);
    for (const l of o.lines) {
      await db.insert(schema.returnItems).values({
        returnId: Number(r.insertId), productId: l.productId, quantity: l.qty, unitPrice: l.price,
        subtotal: (Number(l.qty) * Number(l.price)).toFixed(2),
      } as never);
    }
  }

  const product = async (code: string, name: string, category: string, unit: string, price: string) =>
    Number((await db.insert(schema.products).values({ tenantId: s.tenantId, code, name, category, unit, unitPrice: price } as never))[0].insertId);

  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    await invalidateReports(s.tenantId, "test");
    agentB = Number((await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Бобур", email: "b@test.local", passwordHash: "x", role: "agent" }))[0].insertId);
    cola = await product("C-1", "Cola", "Напитки", "pcs", "100.00");
    sugar = await product("S-1", "Сахар", "Бакалея", "kg", "1000.00");
    centre = Number((await db.insert(schema.territories).values({ tenantId: s.tenantId, name: "Центр" }))[0].insertId);
    await db.update(schema.shops).set({ name: "Магазин 1", territoryId: centre } as never).where(eq(schema.shops.id, s.shopId));
    shop2 = Number((await db.insert(schema.shops).values({ tenantId: s.tenantId, name: "Магазин 2" } as never))[0].insertId);
    shop3 = Number((await db.insert(schema.shops).values({ tenantId: s.tenantId, name: "Магазин 3", territoryId: centre } as never))[0].insertId);

    const first = await order({
      agentId: s.agentId, shopId: s.shopId, createdAt: at("2026-09-02"), subtotal: "3500.00", discount: "350.00", total: "3150.00",
      lines: [{ productId: cola, qty: "10", price: "100" }, { productId: sugar, qty: "2.5", price: "1000" }],
    });
    const second = await order({
      agentId: agentB, shopId: shop2, createdAt: at("2026-09-05"), subtotal: "500.00", total: "500.00",
      lines: [{ productId: cola, qty: "5", price: "100" }],
    });
    const august = await order({
      agentId: s.agentId, shopId: shop3, createdAt: at("2026-08-20"), subtotal: "1000.00", total: "1000.00",
      lines: [{ productId: cola, qty: "10", price: "100" }],
    });
    await order({ agentId: s.agentId, shopId: s.shopId, createdAt: at("2026-10-05"), subtotal: "1000.00", total: "1000.00",
      lines: [{ productId: sugar, qty: "1", price: "1000" }] });
    await order({ agentId: s.agentId, shopId: s.shopId, createdAt: at("2026-09-10"), status: "cancelled", subtotal: "10000.00", total: "10000.00",
      lines: [{ productId: cola, qty: "100", price: "100" }] });

    await ret({ orderId: first, shopId: s.shopId, agentId: s.agentId, amount: "180.00", createdAt: at("2026-09-15"),
      lines: [{ productId: cola, qty: "2", price: "90" }] });
    await ret({ orderId: august, shopId: shop3, agentId: s.agentId, amount: "300.00", createdAt: at("2026-09-20"),
      lines: [{ productId: cola, qty: "3", price: "100" }] });
    await ret({ orderId: second, shopId: shop2, agentId: agentB, amount: "100.00", createdAt: at("2026-09-10"),
      lines: [{ productId: cola, qty: "1", price: "100" }] });
    await ret({ orderId: second, shopId: shop2, agentId: agentB, amount: "50.00", createdAt: at("2026-09-12"), lines: [] });
    await ret({ orderId: first, shopId: s.shopId, agentId: s.agentId, amount: "450.00", createdAt: at("2026-10-03"),
      lines: [{ productId: sugar, qty: "0.5", price: "900" }] });
  });

  const analytics = async () =>
    (await import("../../analytics-router")).analyticsRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "ceo"));
  const period = { dateFrom: FROM, dateTo: TO };
  const sum = (rows: Array<{ totalRevenue?: number; revenue?: number }>) =>
    Math.round(rows.reduce((a, r) => a + Number(r.totalRevenue ?? r.revenue ?? 0), 0) * 100) / 100;

  it("одна выручка: P&L = плитка «Обзора» = сумма товаров = сумма магазинов", async () => {
    const a = await analytics();
    const pnl = await a.pnl({ from: FROM, to: TO, compareWithPrev: false });
    expect(pnl.current.revenue).toBe(P_AND_L);
    // Плитка «Выручка» — сумма totalRevenue строк agentPerformance (totalsOf
    // в pages/Reports.tsx; сам расчёт плитки проверяет экранный тест).
    expect(sum(await a.agentPerformance(period)), "плитка «Обзора»").toBe(P_AND_L);
    expect(sum(await a.topProducts({ ...period, limit: 10_000 })), "товары").toBe(P_AND_L);
    expect(sum(await a.salesByShop({ ...period, limit: 10_000 })), "магазины").toBe(P_AND_L);
  });

  it("товары: после скидки заказа, за вычетом возвратов, количество — доставленное", async () => {
    const rows = await (await analytics()).topProducts(period);
    expect(rows.find(r => r.productId === sugar), "скидка заказа не поделена на строки").toMatchObject({
      productName: "Сахар", unit: "kg", totalQty: 2.5, returnedQty: 0,
      grossRevenue: 2500, salesRevenue: 2250, returnedAmount: 0, totalRevenue: 2250, orderCount: 1,
    });
    expect(rows.find(r => r.productId === cola), "возвраты не вычтены").toMatchObject({
      unit: "pcs", totalQty: 15, returnedQty: 6, salesRevenue: 1400, returnedAmount: 580, totalRevenue: 820, orderCount: 2,
    });
    expect(rows.find(r => r.productId === null)).toMatchObject({ productName: null, returnedAmount: 50, totalRevenue: -50 });
  });

  it("порядок — по деньгам, а не по штукам вперемешку с килограммами", async () => {
    const rows = await (await analytics()).topProducts(period);
    expect(rows.map(r => r.productName)).toEqual(["Сахар", "Cola", null]);
    expect((await (await analytics()).topProducts({ ...period, limit: 1 })).map(r => r.productName)).toEqual(["Сахар"]);
  });

  it("товары: фильтры агента, категории и обоих сразу", async () => {
    const a = await analytics();
    const ofA = await a.topProducts({ ...period, agentId: s.agentId });
    expect(ofA.map(r => [r.productName, r.totalRevenue])).toEqual([["Сахар", 2250], ["Cola", 420]]);
    const ofB = await a.topProducts({ ...period, agentId: agentB });
    expect(ofB.map(r => [r.productName, r.totalRevenue])).toEqual([["Cola", 400], [null, -50]]);
    // Категория снаружи окна: Cola заказа 1 — свои 900, а не весь заказ.
    const drinks = await a.topProducts({ ...period, category: "Напитки" });
    expect(drinks.map(r => [r.productName, r.totalRevenue])).toEqual([["Cola", 820]]);
    expect((await a.topProducts({ ...period, agentId: s.agentId, category: "Бакалея" })).map(r => r.productName)).toEqual(["Сахар"]);
    expect(await a.topProducts({ ...period, agentId: agentB, category: "Бакалея" })).toHaveLength(0);
  });

  it("магазины: за вычетом возвратов; магазин «только возврат» — строкой с минусом", async () => {
    const rows = await (await analytics()).salesByShop(period);
    expect(rows.map(r => [r.shopName, r.orderCount, r.salesRevenue, r.returnedAmount, r.revenue])).toEqual([
      ["Магазин 1", 1, 3150, 180, 2970],
      ["Магазин 2", 1, 500, 150, 350],
      ["Магазин 3", 0, 0, 300, -300],
    ]);
  });

  it("территория: и заказы, и возвраты — только её магазинов", async () => {
    const rows = await (await analytics()).salesByShop({ ...period, territoryId: centre });
    expect(rows.map(r => [r.shopName, r.revenue])).toEqual([["Магазин 1", 2970], ["Магазин 3", -300]]);
  });

  it("агент: и заказы, и возвраты — только его", async () => {
    const a = await analytics();
    expect((await a.salesByShop({ ...period, agentId: agentB })).map(r => [r.shopName, r.revenue])).toEqual([["Магазин 2", 350]]);
    expect((await a.salesByShop({ ...period, agentId: s.agentId })).map(r => [r.shopName, r.revenue]))
      .toEqual([["Магазин 1", 2970], ["Магазин 3", -300]]);
  });

  it("десятка по умолчанию; каталогу выгрузок — все товары", async () => {
    for (let i = 1; i <= 10; i++) {
      const pid = await product(`M-${i}`, `Товар ${i}`, "Прочее", "pcs", "10.00");
      await order({ agentId: s.agentId, shopId: s.shopId, createdAt: at("2026-09-20"), subtotal: String(10 * i), total: String(10 * i),
        lines: [{ productId: pid, qty: String(i), price: "10" }] });
    }
    await invalidateReports(s.tenantId, "10 товаров");
    const a = await analytics();
    expect(await a.topProducts(period)).toHaveLength(10);
    const all = await a.topProducts({ ...period, limit: 10_000 });
    expect(all).toHaveLength(13); // 10 + Сахар + Cola + возврат без строк
    const pnl = await a.pnl({ from: FROM, to: TO, compareWithPrev: false });
    expect(sum(all)).toBe(pnl.current.revenue);
  });

  it("единица у «Себестоимости по товарам» — чтобы 2,5 кг не печатались как «3»", async () => {
    const rows = await (await analytics()).cogsByProduct(period);
    expect(rows.find(r => r.productName === "Сахар")).toMatchObject({ unit: "kg" });
    expect(Number(rows.find(r => r.productName === "Сахар")!.totalQty)).toBe(2.5);
  });
});
