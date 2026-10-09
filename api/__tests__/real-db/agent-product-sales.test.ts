/**
 * «Агент × Товар» — в тех же деньгах, что KPI агента, таблица «Агенты» и P&L.
 * На настоящей MySQL, через настоящие ручки.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Клиент спросил, может ли отчёт ошибаться (09.10.2026). Аудит: количества
 * верные, деньги — нет. Сумма строк бралась до скидки заказа и без вычета
 * возвратов: заказ на 1 300 000 со скидкой 10% давал здесь 1 300 000, а KPI,
 * зарплата и P&L — 1 170 000; товар, вернувшийся на склад, оставался
 * «проданным».
 *
 * ── Данные (каждое число считается руками) ──────────────────────────────────
 *
 *   Агент А:
 *     Заказ 1, скидка 10%: Cola 100 × 10 000 = 1 000 000, Chips 50 × 6 000 =
 *       300 000; сумма 1 300 000, итого 1 170 000 → Cola 900 000, Chips 270 000
 *     Заказ 2: Cola 100 × 10 000, Fanta 50 × 8 000; итого 1 400 000
 *     Возврат по заказу 2: Cola 30 шт., документ на 300 000
 *     Возврат по заказу 1 без строк товара: документ на 10 000
 *   Агент Б:
 *     Заказ 3: Fanta 10 × 8 000 = 80 000; Chips 5 шт. — отказ у двери
 *       (доставлено 0), итого 80 000
 *     Заказ 4 — 60 дней назад, вне периода: Сок 20 × 5 000 = 100 000;
 *       возврат в периоде: Сок 4 шт., документ на 20 000
 *   Агент В — только возврат: заказ 60 дней назад, Сок 40 × 5 000; возврат
 *     в периоде — Сок 30 шт., документ на 150 000
 *   Агент Г — возвраты больше продаж: в периоде Fanta 5 × 8 000 = 40 000;
 *     возврат в периоде по заказу 60-дневной давности: Cola 10 шт., 100 000
 *   Мимо: удалённый и отменённый заказы А, заказ чужой организации.
 *
 *   А: Cola 200 шт., вернули 30; продажи 1 900 000, возвраты 300 000,
 *      чистыми 1 600 000, заказов 2. Chips 50 / 270 000. Fanta 50 / 400 000.
 *      Возврат без строк: −10 000. Итого А 2 260 000 = KPI А
 *      (2 570 000 − 310 000).
 *   Б: Fanta 10 / 80 000. Chips нет (доставлено 0). Сок: продано 0,
 *      вернули 4, −20 000. Итого Б 60 000 = KPI Б (80 000 − 20 000).
 *   В: Сок −150 000, в таблице «Агенты» −150 000 (ноль заказов), KPI 0.
 *   Г: 40 000 − 100 000 = −60 000 и в отчёте, и в «Агентах»; KPI 0 — ниже нуля
 *      не опускаются только KPI и зарплата.
 *   Все агенты: 2 110 000 = выручка P&L (2 690 000 − 580 000) = сумма строк
 *   таблицы «Агенты».
 *
 * ── Нарочные поломки ────────────────────────────────────────────────────────
 *
 *  • сумма строки без доли orders.total (net = gross) — падают «А» и «P&L»;
 *  • не вычитать возвраты — падают «А», «Б», «KPI» и «P&L»;
 *  • категорию внутрь окна (знаменатель по отфильтрованным строкам) — падает
 *    «категория» (Cola заказа 1 получила бы 1 170 000);
 *  • убрать условие qty > 0 — падает «Б» (Chips с «заказом» и нулём);
 *  • вернуть в «Агентах» обрезку по нулю или потерять агента «только
 *    возврат» — падают «В и Г» и «P&L».
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import { invalidateReports } from "../../lib/report-cache";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const FROM = ymd(new Date(Date.now() - 30 * 86_400_000));
const TO = ymd(new Date(Date.now() + 30 * 86_400_000));
const LONG_AGO = new Date(Date.now() - 60 * 86_400_000);

describe.skipIf(!hasRealDb)("«Агент × Товар»: деньги как в KPI и P&L", () => {
  let db: ServiceDb;
  let s: Seeded;
  let agentB: number, agentC: number, agentD: number;
  let cola: number, chips: number, fanta: number, juice: number;
  let n = 0;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });

  async function order(o: {
    tenantId?: number; agentId: number; status?: string; deleted?: boolean; createdAt?: Date;
    subtotal: string; discount?: string; total: string;
    lines: Array<{ productId: number; qty: string; price: string; delivered?: string }>;
  }) {
    const [row] = await db.insert(schema.orders).values({
      tenantId: o.tenantId ?? s.tenantId, shopId: s.shopId, agentId: o.agentId,
      orderNumber: `№AP-${++n}`, status: (o.status ?? "delivered") as never, paymentMethod: "cash",
      subtotal: o.subtotal, discount: o.discount ?? "0.00", total: o.total,
      deletedAt: o.deleted ? new Date() : null,
      ...(o.createdAt ? { createdAt: o.createdAt } : {}),
    } as never);
    const orderId = Number(row.insertId);
    for (const l of o.lines) {
      await db.insert(schema.orderItems).values({
        orderId, productId: l.productId, quantity: l.qty, unitPrice: l.price, costPrice: "0.00",
        subtotal: (Number(l.qty) * Number(l.price)).toFixed(2), deliveredQuantity: l.delivered ?? null,
      } as never);
    }
    return orderId;
  }

  async function ret(orderId: number, agentId: number, amount: string, lines: Array<{ productId: number; qty: string; price: string }>) {
    const [r] = await db.insert(schema.returns).values({
      tenantId: s.tenantId, shopId: s.shopId, orderId, agentId,
      returnNumber: `В-${++n}`, status: "completed", totalAmount: amount,
    } as never);
    for (const l of lines) {
      await db.insert(schema.returnItems).values({
        returnId: Number(r.insertId), productId: l.productId, quantity: l.qty, unitPrice: l.price,
        subtotal: (Number(l.qty) * Number(l.price)).toFixed(2),
      } as never);
    }
  }

  const product = async (code: string, name: string, category: string, price: string) =>
    Number((await db.insert(schema.products).values({ tenantId: s.tenantId, code, name, category, unitPrice: price } as never))[0].insertId);

  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    await invalidateReports(s.tenantId, "test");
    const [u] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Бобур", email: "b@test.local", passwordHash: "x", role: "agent" });
    agentB = Number(u.insertId);
    agentC = Number((await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Камол", email: "c@test.local", passwordHash: "x", role: "agent" }))[0].insertId);
    agentD = Number((await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Дилноза", email: "d@test.local", passwordHash: "x", role: "agent" }))[0].insertId);
    cola = await product("C-1", "Cola", "Напитки", "10000.00");
    chips = await product("S-1", "Chips", "Снеки", "6000.00");
    fanta = await product("C-2", "Fanta", "Напитки", "8000.00");
    juice = await product("C-3", "Сок", "Напитки", "5000.00");

    const first = await order({
      agentId: s.agentId, subtotal: "1300000.00", discount: "130000.00", total: "1170000.00",
      lines: [{ productId: cola, qty: "100", price: "10000" }, { productId: chips, qty: "50", price: "6000" }],
    });
    const second = await order({
      agentId: s.agentId, subtotal: "1400000.00", total: "1400000.00",
      lines: [{ productId: cola, qty: "100", price: "10000" }, { productId: fanta, qty: "50", price: "8000" }],
    });
    await ret(second, s.agentId, "300000.00", [{ productId: cola, qty: "30", price: "10000" }]);
    await ret(first, s.agentId, "10000.00", []);

    await order({
      agentId: agentB, subtotal: "80000.00", total: "80000.00",
      lines: [{ productId: fanta, qty: "10", price: "8000" }, { productId: chips, qty: "5", price: "6000", delivered: "0" }],
    });
    const old = await order({
      agentId: agentB, createdAt: LONG_AGO, subtotal: "100000.00", total: "100000.00",
      lines: [{ productId: juice, qty: "20", price: "5000" }],
    });
    await ret(old, agentB, "20000.00", [{ productId: juice, qty: "4", price: "5000" }]);

    // В — только возврат прошлой продажи.
    const cOld = await order({ agentId: agentC, createdAt: LONG_AGO, subtotal: "200000.00", total: "200000.00",
      lines: [{ productId: juice, qty: "40", price: "5000" }] });
    await ret(cOld, agentC, "150000.00", [{ productId: juice, qty: "30", price: "5000" }]);
    // Г — возвраты больше продаж периода.
    await order({ agentId: agentD, subtotal: "40000.00", total: "40000.00",
      lines: [{ productId: fanta, qty: "5", price: "8000" }] });
    const dOld = await order({ agentId: agentD, createdAt: LONG_AGO, subtotal: "100000.00", total: "100000.00",
      lines: [{ productId: cola, qty: "10", price: "10000" }] });
    await ret(dOld, agentD, "100000.00", [{ productId: cola, qty: "10", price: "10000" }]);

    // Мимо выручки.
    await order({ agentId: s.agentId, deleted: true, subtotal: "9000000.00", total: "9000000.00",
      lines: [{ productId: cola, qty: "900", price: "10000" }] });
    await order({ agentId: s.agentId, status: "cancelled", subtotal: "7000000.00", total: "7000000.00",
      lines: [{ productId: cola, qty: "700", price: "10000" }] });
    // Чужая организация.
    const [oa] = await db.insert(schema.users).values({ tenantId: s.otherTenantId, name: "Чужой", email: "x@other.local", passwordHash: "x", role: "agent" });
    const [op] = await db.insert(schema.products).values({ tenantId: s.otherTenantId, code: "X-1", name: "Чужой товар", unitPrice: "10.00" });
    const [os] = await db.insert(schema.shops).values({ tenantId: s.otherTenantId, name: "Чужой магазин" });
    await db.insert(schema.orders).values({
      tenantId: s.otherTenantId, shopId: Number(os.insertId), agentId: Number(oa.insertId), orderNumber: "№X-1",
      status: "delivered" as never, paymentMethod: "cash", subtotal: "50000.00", discount: "0.00", total: "50000.00",
    } as never);
    void op;
  });

  const analytics = async () =>
    (await import("../../analytics-router")).analyticsRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "ceo"));
  const rowsOf = async (input: Record<string, unknown> = {}) =>
    (await analytics()).agentProductSales({ dateFrom: FROM, dateTo: TO, ...input });
  const pick = <T extends { agentId: number | null; productId: number | null }>(rows: T[], agentId: number, productId: number | null) =>
    rows.find(r => r.agentId === agentId && r.productId === productId);

  it("А: сумма после скидки заказа, возвраты по дате проведения, возврат без строк — отдельной строкой", async () => {
    const rows = await rowsOf();
    expect(pick(rows, s.agentId, cola)).toMatchObject({
      productName: "Cola", totalQty: 200, returnedQty: 30,
      grossRevenue: 2_000_000, salesRevenue: 1_900_000, returnedAmount: 300_000, totalRevenue: 1_600_000, orderCount: 2,
    });
    expect(pick(rows, s.agentId, chips), "скидка заказа не поделена на строки")
      .toMatchObject({ totalQty: 50, grossRevenue: 300_000, salesRevenue: 270_000, totalRevenue: 270_000, orderCount: 1 });
    expect(pick(rows, s.agentId, fanta)).toMatchObject({ totalQty: 50, salesRevenue: 400_000, totalRevenue: 400_000 });
    expect(pick(rows, s.agentId, null)).toMatchObject({ productName: null, returnedAmount: 10_000, totalRevenue: -10_000 });
    const totalA = rows.filter(r => r.agentId === s.agentId).reduce((a, r) => a + r.totalRevenue, 0);
    expect(totalA).toBe(2_260_000);
  });

  it("Б: отказ у двери не даёт строки, возврат прошлой продажи — строка «только возврат»", async () => {
    const rows = await rowsOf();
    expect(pick(rows, agentB, fanta)).toMatchObject({ totalQty: 10, salesRevenue: 80_000, totalRevenue: 80_000, orderCount: 1 });
    expect(pick(rows, agentB, chips), "строка с доставленным нулём осталась").toBeUndefined();
    expect(pick(rows, agentB, juice)).toMatchObject({
      productName: "Сок", totalQty: 0, returnedQty: 4, salesRevenue: 0, returnedAmount: 20_000, totalRevenue: -20_000, orderCount: 0,
    });
    // Удалённый, отменённый и чужой — мимо.
    expect(rows.every(r => [s.agentId, agentB, agentC, agentD].includes(r.agentId as number))).toBe(true);
  });

  it("В и Г: отчёт и «Агенты» уходят в минус одинаково, KPI — ноль", async () => {
    const rows = await rowsOf();
    const perf = await (await analytics()).agentPerformance({ dateFrom: FROM, dateTo: TO });
    const { calculateAgentKpi } = await import("../../services/kpi");
    const start = new Date(`${FROM}T00:00:00Z`);
    const end = new Date(`${TO}T23:59:59Z`);

    expect(pick(rows, agentC, juice)).toMatchObject({ totalQty: 0, returnedQty: 30, returnedAmount: 150_000, totalRevenue: -150_000 });
    expect(perf.find(x => x.agentId === agentC), "агент «только возврат» выпал из «Агентов»")
      .toMatchObject({ agentName: "Камол", orderCount: 0, salesRevenue: 0, returnedAmount: 150_000, totalRevenue: -150_000, avgOrderValue: 0 });

    const dSum = rows.filter(r => r.agentId === agentD).reduce((a, r) => a + r.totalRevenue, 0);
    expect(dSum).toBe(-60_000);
    expect(perf.find(x => x.agentId === agentD)!.totalRevenue, "«Агенты» обрезали по нулю").toBe(-60_000);

    for (const id of [agentC, agentD]) {
      const kpi = await calculateAgentKpi(db as never, id, s.tenantId, start, end);
      expect(Number(kpi.revenue), "KPI обязан оставаться не ниже нуля").toBe(0);
    }
  });

  it("итог агента равен выручке его KPI и строке таблицы «Агенты»", async () => {
    const rows = await rowsOf();
    const { calculateAgentKpi } = await import("../../services/kpi");
    const start = new Date(`${FROM}T00:00:00Z`);
    const end = new Date(`${TO}T23:59:59Z`);
    const perf = await (await analytics()).agentPerformance({ dateFrom: FROM, dateTo: TO });
    for (const agentId of [s.agentId, agentB]) {
      const sum = rows.filter(r => r.agentId === agentId).reduce((a, r) => a + r.totalRevenue, 0);
      const kpi = await calculateAgentKpi(db as never, agentId, s.tenantId, start, end);
      expect(sum, `агент ${agentId}: «Агент × Товар» ≠ KPI`).toBe(Number(kpi.revenue));
      const p = perf.find(x => x.agentId === agentId)!;
      expect(p.totalRevenue, `агент ${agentId}: таблица «Агенты» ≠ KPI`).toBe(Number(kpi.revenue));
    }
    expect(perf.find(x => x.agentId === s.agentId)).toMatchObject({ salesRevenue: 2_570_000, returnedAmount: 310_000, orderCount: 2, avgOrderValue: 1_130_000 });
  });

  it("сумма по всем агентам равна выручке P&L за тот же период", async () => {
    const rows = await rowsOf();
    const pnl = await (await analytics()).pnl({ from: FROM, to: TO, compareWithPrev: false });
    const sum = rows.reduce((a, r) => a + r.totalRevenue, 0);
    expect(sum).toBe(2_110_000);
    expect(sum).toBe(pnl.current.revenue);
    // Та же сумма — строками таблицы «Агенты»: обе таблицы вкладки сходятся с P&L.
    const perf = await (await analytics()).agentPerformance({ dateFrom: FROM, dateTo: TO });
    expect(perf.reduce((a, r) => a + r.totalRevenue, 0)).toBe(pnl.current.revenue);
  });

  it("категория: доля скидки — по ВСЕМ строкам заказа, а не по отфильтрованным", async () => {
    const rows = await rowsOf({ category: "Напитки" });
    // Заказ 1 — Cola и Chips. Если отрезать Chips до деления, вся сумма заказа
    // 1 170 000 легла бы на Cola вместо её 900 000.
    expect(pick(rows, s.agentId, cola)).toMatchObject({ salesRevenue: 1_900_000, totalRevenue: 1_600_000 });
    expect(rows.some(r => r.productId === chips)).toBe(false);
    expect(pick(rows, s.agentId, null), "возврат без строк в отчёте по категории").toBeUndefined();
    expect(pick(rows, agentB, juice)).toMatchObject({ totalRevenue: -20_000 });
  });

  it("фильтр агента — только его строки и его возвраты", async () => {
    const rows = await rowsOf({ agentId: agentB });
    expect(rows.map(r => r.productName).sort()).toEqual(["Fanta", "Сок"]);
  });
});
