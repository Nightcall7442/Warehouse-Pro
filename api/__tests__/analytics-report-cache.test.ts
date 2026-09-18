/**
 * Аналитика и P&L считаются один раз на организацию, а не на каждого зрителя.
 *
 * ── Что стережём ────────────────────────────────────────────────────────────
 *
 * Тридцать директоров открывают P&L в 9:00 первого числа. Было: тридцать
 * проходов по order_items за год — по четыре ручки на экран. Теперь ручки
 * analytics-router идут через reportCached: повтор с тем же входом в базу не
 * ходит, а ответ — побайтно тот же, что ушёл бы на промахе.
 *
 * Стенд считает обращения к базе (вызовы select) и подменяет строки МЕЖДУ
 * вызовами: если второй ответ совпал с первым, хотя база уже отдала бы другое
 * число, — значит, базу не спрашивали. Убери reportCached из ручки — второй
 * вызов пойдёт в базу, увидит новое число, и проверка упадёт.
 *
 * report-cache здесь НАСТОЯЩИЙ (память процесса, без Redis), а не подделка:
 * так проверяется и то, что «без входа» и «{}» дают один ключ через его
 * stableStringify — на подделке с JSON.stringify это совпало бы случайно.
 * Что роутер попросил у кэша — имя, вход, TTL — читается через spy на
 * reportCache.get и сверяется с таблицей решений в шапке analytics-router.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../context";
import { asTestContext } from "./helpers/test-context";

vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  return drizzleMock();
});
vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());
vi.mock("../lib/feature-gating", () => ({
  hasSubscriptionAccess: vi.fn(async () => true),
  checkSubscriptionAccess: vi.fn(async () => true),
  invalidateSubscriptionAccess: vi.fn(),
}));

/** Сколько раз проверяемый код обратился к базе. */
let selects = 0;
/**
 * Число, которое база «отдаёт сейчас». Каждый select возвращает одну
 * универсальную строку — в ней есть все поля, какие читают ручки этого
 * роутера, а выручка берётся отсюда. Поменяй его между вызовами: кэш обязан
 * отдать прежнее, база — новое.
 */
let revenueNow = "1000";

function row() {
  return {
    id: 1, month: "2026-09", paymentMethod: "cash", agentId: 10, agentName: "Агент", productId: 1,
    productName: "Товар", productCode: "T-1", unit: "шт", shopName: "Магазин",
    revenue: revenueNow, totalRevenue: revenueNow, totalDiscount: "10", orderCount: 2, orders: 2,
    totalQty: "5", totalCOGS: "400", totalCost: "400", cogs: "400", totalExpenses: "100", arrivalCount: 1,
    totalPayroll: "50", payoutCount: 1, expenses: "100", amount: "0", visits: 3, avgOrderValue: "500",
    returnId: 1, quantity: "1", orderCost: "3", productCost: "3",
  };
}

function builder() {
  const b: any = {};
  for (const m of ["from", "leftJoin", "innerJoin", "where", "groupBy", "orderBy", "limit", "offset"]) b[m] = () => b;
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve([row()]).then(resolve, reject);
  return b;
}
const mockDb = { select: () => { selects++; return builder(); } };
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

import { analyticsRouter } from "../analytics-router";
import { reportCache, invalidateReports, ReportTTL } from "../lib/report-cache";

const getSpy = vi.spyOn(reportCache, "get");

function ctxFor(tenantId: number): TrpcContext {
  return asTestContext({
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    db: mockDb,
    tenant: { id: tenantId, slug: `t${tenantId}`, name: "Org", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    user: { id: 100 + tenantId, tenantId, role: "ceo" as const, status: "active" as const, name: "Директор", email: `ceo${tenantId}@t.com`, passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
  });
}
const caller = (tenantId = 1) => analyticsRouter.createCaller(ctxFor(tenantId));

beforeEach(async () => {
  selects = 0;
  revenueNow = "1000";
  getSpy.mockClear();
  // Настоящий кэш живёт в памяти процесса: между тестами поднимаем версию
  // обеих организаций — так же, как это делает запись заказа.
  await invalidateReports(1, "test");
  await invalidateReports(2, "test");
});

const FROM = "2026-09-01", TO = "2026-09-14";

/**
 * Таблица решений: ручка → TTL → вход A и другой вход B (B обязан дать другой
 * ключ). Это та же таблица, что в шапке analytics-router.ts; расходятся —
 * падает «имя и TTL».
 */
type Call = (c: ReturnType<typeof caller>) => Promise<unknown>;
const CACHED: Array<{ name: string; ttl: number; a: Call; b: Call }> = [
  { name: "salesByShop",        ttl: ReportTTL.minute,  a: c => c.salesByShop({ dateFrom: FROM, dateTo: TO }),        b: c => c.salesByShop({ dateFrom: FROM, dateTo: TO, limit: 5 }) },
  { name: "topProducts",        ttl: ReportTTL.fiveMin, a: c => c.topProducts({ dateFrom: FROM, dateTo: TO }),        b: c => c.topProducts({ dateFrom: FROM, dateTo: TO, category: "Напитки" }) },
  { name: "agentPerformance",   ttl: ReportTTL.minute,  a: c => c.agentPerformance({ dateFrom: FROM, dateTo: TO }),   b: c => c.agentPerformance({ dateFrom: "2026-08-01", dateTo: "2026-08-31" }) },
  { name: "cogsByProduct",      ttl: ReportTTL.fiveMin, a: c => c.cogsByProduct({ dateFrom: FROM, dateTo: TO }),      b: c => c.cogsByProduct({ dateFrom: FROM, dateTo: TO, category: "Снеки" }) },
  { name: "agentEfficiency",    ttl: ReportTTL.minute,  a: c => c.agentEfficiency({ days: 30 }),                      b: c => c.agentEfficiency({ days: 7 }) },
  { name: "pnl",                ttl: ReportTTL.fiveMin, a: c => c.pnl({ from: FROM, to: TO, compareWithPrev: false }), b: c => c.pnl({ from: FROM, to: TO, compareWithPrev: true }) },
  { name: "pnlByPaymentMethod", ttl: ReportTTL.fiveMin, a: c => c.pnlByPaymentMethod({ from: FROM, to: TO }),         b: c => c.pnlByPaymentMethod({ from: FROM, to: TO, agentId: 10 }) },
  { name: "agentProductSales",  ttl: ReportTTL.fiveMin, a: c => c.agentProductSales({ dateFrom: FROM, dateTo: TO }),  b: c => c.agentProductSales({ dateFrom: FROM, dateTo: TO, agentId: 10 }) },
  { name: "paymentMethodTrend", ttl: ReportTTL.fiveMin, a: c => c.paymentMethodTrend({ from: FROM, to: TO }),         b: c => c.paymentMethodTrend({ from: "2026-01-01", to: TO }) },
];

describe.each(CACHED)("analytics.$name — один пересчёт на организацию", ({ name, ttl, a, b }) => {
  it("повтор с тем же входом в базу не ходит и отдаёт побайтно тот же ответ", async () => {
    const first = await a(caller());
    const cost = selects;
    expect(cost, "первый вызов обязан считать").toBeGreaterThan(0);
    // Ответ не пустой: иначе «тот же ответ» доказывал бы только равенство [] и [].
    expect(JSON.stringify(first)).toContain("1000");

    revenueNow = "2000";
    const second = await a(caller());
    expect(selects, "второй вызов пошёл в базу").toBe(cost);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("другой вход — другой ключ: считается заново", async () => {
    await a(caller());
    const cost = selects;
    await b(caller());
    expect(selects, "вход не попал в ключ").toBeGreaterThan(cost);
  });

  it("другая организация не получает чужие числа", async () => {
    await a(caller(1));
    const cost = selects;
    revenueNow = "2000";
    const other = await a(caller(2));
    expect(selects, "организация не попала в ключ").toBeGreaterThan(cost);
    expect(JSON.stringify(other)).toContain("2000");
  });

  it("после сброса организации — пересчёт с новыми числами", async () => {
    await a(caller());
    revenueNow = "2000";
    await invalidateReports(1, "заказ доставлен");
    const fresh = await a(caller());
    expect(JSON.stringify(fresh)).toContain("2000");
    expect(JSON.stringify(fresh)).not.toContain("1000");
  });

  it("имя и TTL — как в таблице решений", async () => {
    await a(caller());
    const call = getSpy.mock.calls.at(-1)!;
    expect(call[0]).toBe(1);
    expect(call[1]).toBe(`analytics.${name}`);
    expect(call[3]).toBe(ttl);
  });
});

describe("вход без аргументов", () => {
  it("«без входа» и «{}» — один ключ (иначе вкладка по умолчанию и экспорт считались бы врозь)", async () => {
    await caller().salesByShop();
    const cost = selects;
    revenueNow = "2000";
    const again = await caller().salesByShop({});
    expect(selects, "undefined и {} разошлись по ключам").toBe(cost);
    expect(JSON.stringify(again)).toContain("1000");
  });
});

describe("что живёт мимо кэша — намеренно", () => {
  it("debtReport: остаток «на сейчас» — каждый вызов идёт в базу", async () => {
    await caller().debtReport();
    const cost = selects;
    revenueNow = "2000";
    await caller().debtReport();
    expect(selects).toBe(cost * 2);
    expect(getSpy.mock.calls.some(c => c[1] === "analytics.debtReport")).toBe(false);
  });

  it("shopRevenueTrend: карточка одного магазина — каждый вызов идёт в базу", async () => {
    await caller().shopRevenueTrend({ shopId: 1, days: 30 });
    const cost = selects;
    await caller().shopRevenueTrend({ shopId: 1, days: 30 });
    expect(selects).toBe(cost * 2);
    expect(getSpy.mock.calls.some(c => c[1] === "analytics.shopRevenueTrend")).toBe(false);
  });
});

describe("потолок свежести", () => {
  it("ни один отчёт не живёт дольше пяти минут без сброса", async () => {
    for (const { a } of CACHED) await a(caller());
    for (const call of getSpy.mock.calls) expect(call[3]).toBeLessThanOrEqual(ReportTTL.fiveMin);
  });
});
