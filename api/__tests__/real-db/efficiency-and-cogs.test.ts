/**
 * «Эффективность агентов» и «Себестоимость по товарам» — соседи «Агент × Товар»
 * в каталоге выгрузок. На настоящей MySQL, через настоящие ручки.
 *
 * ── Что было (аудит 09.10.2026) ─────────────────────────────────────────────
 *
 *  П3. Каталог переводил выбранный период в «N дней», а сервер отсчитывал их
 *      назад от СЕЙЧАС без верхней границы: файл за сентябрь, скачанный в
 *      октябре, нёс октябрьские заказы и визиты, а сентябрь начинался не с 1-го.
 *  П7. «Объём» — заказанное количество рядом с выручкой за доставленное:
 *      частичная доставка 10 → 7 давала цену 70% настоящей. И файл каталога
 *      молча обрезался на двадцатом товаре.
 *
 * ── Данные (период — сентябрь 2026) ─────────────────────────────────────────
 *
 *   Агент: заказы 02.09 на 1 000 и 30.09 в 20:00 на 300 (в периоде — последний
 *   день целиком), 20.08 на 7 000 и 05.10 на 5 000 (вне); возвраты по
 *   сентябрьскому заказу 15.09 на 200 (в периоде) и 03.10 на 50, по
 *   августовскому 25.08 на 70 (вне); визиты по плану 10.09 и 30.09 (в периоде),
 *   31.08 и 05.10 (вне).
 *   Вместе с «Водой» (03.09, 700): 3 заказа, 2 визита, продажи 2 000,
 *   возвраты 200, выручка 1 800 — та же, что в таблице «Агенты» за сентябрь.
 *   «Вода»: 03.09 заказано 10, доставлено 7, по 100, себестоимость 60
 *   → объём 7, выручка 700, себестоимость 420.
 *   25 товаров по одной строке в сентябре → каталог получает все, экран — 20.
 *
 * ── Нарочные поломки ────────────────────────────────────────────────────────
 *
 *  • убрать верхнюю границу заказов — падает «сентябрь»;
 *  • верх без «23:59:59» (полночь 30.09) — падает «сентябрь» (заказ 30.09);
 *  • визиты без границ периода — падает «сентябрь»;
 *  • не вычитать возвраты — падает «сентябрь» и «как в «Агентах»»;
 *  • возвраты «за всё время» вместо периода — падает «сентябрь»;
 *  • старый путь: возвраты с полуночи, заказы с момента отсечки — падает
 *    «старый вход»;
 *  • объём по orderItems.quantity — падает «объём»;
 *  • вернуть .limit(20) — падает «все товары».
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import { invalidateReports } from "../../lib/report-cache";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

const FROM = "2026-09-01";
const TO = "2026-09-30";
const at = (iso: string) => new Date(`${iso}T09:00:00Z`);

describe.skipIf(!hasRealDb)("«Эффективность агентов» и «Себестоимость по товарам»", () => {
  let db: ServiceDb;
  let s: Seeded;
  let water: number;
  let n = 0;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });

  async function order(createdAt: Date, total: string, lines: Array<{ productId: number; qty: string; price: string; cost?: string; delivered?: string }>) {
    const [row] = await db.insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId,
      orderNumber: `№E-${++n}`, status: "delivered" as never, paymentMethod: "cash",
      subtotal: total, discount: "0.00", total, createdAt,
    } as never);
    const orderId = Number(row.insertId);
    for (const l of lines) {
      await db.insert(schema.orderItems).values({
        orderId, productId: l.productId, quantity: l.qty, unitPrice: l.price, costPrice: l.cost ?? "0.00",
        subtotal: (Number(l.qty) * Number(l.price)).toFixed(2), deliveredQuantity: l.delivered ?? null,
      } as never);
    }
    return orderId;
  }

  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    await invalidateReports(s.tenantId, "test");

    const sept = await order(at("2026-09-02"), "1000.00", [{ productId: s.productId, qty: "10", price: "100", cost: "60" }]);
    await order(new Date("2026-09-30T20:00:00Z"), "300.00", [{ productId: s.productId, qty: "3", price: "100" }]);
    const aug = await order(at("2026-08-20"), "7000.00", [{ productId: s.productId, qty: "70", price: "100" }]);
    await order(at("2026-10-05"), "5000.00", [{ productId: s.productId, qty: "50", price: "100" }]);
    const ret = (orderId: number, amount: string, createdAt: Date) => db.insert(schema.returns).values({
      tenantId: s.tenantId, shopId: s.shopId, orderId, agentId: s.agentId,
      returnNumber: `В-${++n}`, status: "completed", totalAmount: amount, createdAt,
    } as never);
    await ret(sept, "200.00", at("2026-09-15"));
    // Вне периода: возврат сентябрьской продажи в октябре и августовской — в августе.
    await ret(sept, "50.00", at("2026-10-03"));
    await ret(aug, "70.00", at("2026-08-25"));
    await db.insert(schema.dailyPlans).values([
      { tenantId: s.tenantId, agentId: s.agentId, shopId: s.shopId, planDate: "2026-08-31", status: "visited" },
      { tenantId: s.tenantId, agentId: s.agentId, shopId: s.shopId, planDate: "2026-09-10", status: "visited" },
      { tenantId: s.tenantId, agentId: s.agentId, shopId: s.shopId, planDate: "2026-09-30", status: "visited" },
      { tenantId: s.tenantId, agentId: s.agentId, shopId: s.shopId, planDate: "2026-10-05", status: "visited" },
    ] as never);

    water = Number((await db.insert(schema.products).values({ tenantId: s.tenantId, code: "W-1", name: "Вода", unitPrice: "100.00" } as never))[0].insertId);
    await order(at("2026-09-03"), "700.00", [{ productId: water, qty: "10", price: "100", cost: "60", delivered: "7" }]);
  });

  const analytics = async () =>
    (await import("../../analytics-router")).analyticsRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "ceo"));

  it("сентябрь: заказы и визиты только сентябрьские, выручка за вычетом возвратов", async () => {
    const rows = await (await analytics()).agentEfficiency({ dateFrom: FROM, dateTo: TO });
    const me = rows.find(r => r.agentId === s.agentId)!;
    // 02.09, 03.09 («Вода») и 30.09 в 20:00; августовский и октябрьский — мимо.
    expect(me.orders, "последний день периода или чужой месяц").toBe(3);
    expect(Number(me.visits), "визиты 31.08 или 05.10 попали в сентябрь, или 30.09 выпал").toBe(2);
    expect(me.salesRevenue).toBe(2000);
    expect(me.returnedAmount, "возвраты не за период").toBe(200);
    expect(me.revenue).toBe(1800);
    expect(me.avgOrderValue).toBe(600);
  });

  it("выручка агента — как в таблице «Агенты» за тот же период", async () => {
    const eff = await (await analytics()).agentEfficiency({ dateFrom: FROM, dateTo: TO });
    const perf = await (await analytics()).agentPerformance({ dateFrom: FROM, dateTo: TO });
    expect(eff.find(r => r.agentId === s.agentId)!.revenue).toBe(perf.find(r => r.agentId === s.agentId)!.totalRevenue);
  });

  it("старый вход «N дней»: одна граница — начало дня отсечки — для заказов, визитов и возвратов", async () => {
    // «Сейчас» — 06.10 12:00 UTC, 36 дней назад — 31.08 12:00; граница — 31.08 00:00.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
    try {
      const rows = await (await analytics()).agentEfficiency({ days: 36 });
      const me = rows.find(r => r.agentId === s.agentId)!;
      // Заказы 02.09, 03.09, 30.09, 05.10; 20.08 — раньше.
      expect(me.orders).toBe(4);
      expect(me.salesRevenue).toBe(7000);
      // Визиты 31.08 (день отсечки целиком), 10.09, 30.09, 05.10.
      expect(Number(me.visits)).toBe(4);
      // Возвраты 15.09 и 03.10; 25.08 — раньше.
      expect(me.returnedAmount).toBe(250);
      expect(me.revenue).toBe(6750);
    } finally {
      vi.useRealTimers();
    }
  });

  it("объём — доставленное, а не заказанное", async () => {
    const rows = await (await analytics()).cogsByProduct({ dateFrom: FROM, dateTo: TO });
    const w = rows.find(r => r.productName === "Вода")!;
    expect(Number(w.totalQty), "объём по заказанному").toBe(7);
    expect(Number(w.totalRevenue)).toBe(700);
    expect(Number(w.totalCost)).toBe(420);
  });

  it("все товары по просьбе каталога; экран P&L — двадцать", async () => {
    for (let i = 1; i <= 25; i++) {
      const pid = Number((await db.insert(schema.products).values({ tenantId: s.tenantId, code: `M-${i}`, name: `Товар ${i}`, unitPrice: "10.00" } as never))[0].insertId);
      await order(at("2026-09-20"), String(10 * i), [{ productId: pid, qty: String(i), price: "10" }]);
    }
    await invalidateReports(s.tenantId, "25 товаров");
    const all = await (await analytics()).cogsByProduct({ dateFrom: FROM, dateTo: TO, limit: 10_000 });
    expect(all.length, "файл обрезан").toBe(27); // 25 + «Товар» + «Вода»
    const screen = await (await analytics()).cogsByProduct({ dateFrom: FROM, dateTo: TO });
    expect(screen).toHaveLength(20);
  });
});
