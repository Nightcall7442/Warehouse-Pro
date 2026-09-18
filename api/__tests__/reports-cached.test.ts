/**
 * Отчёты директора считаются один раз на организацию, а не на каждого зрителя.
 *
 * ── Что стережём ────────────────────────────────────────────────────────────
 *
 * Тридцать директоров открывают «Отчёты» в 9:00. Было: тридцать пересчётов,
 * каждый — шесть запросов в пул на двадцать соединений. Теперь ручки сводки,
 * графика и хода плана идут через reportCached: повторное открытие в пределах
 * TTL в базу не ходит, а числа — те же самые, до копейки.
 *
 * Стенд считает обращения к базе (вызовы select) — это ровно то свойство,
 * которое чинили. Убери reportCached из ручки — второй вызов снова пойдёт в
 * базу, и проверка упадёт.
 *
 * report-cache подменён честной подделкой с настоящей картой: ключ — тот же
 * (арендатор, имя, вход), что и в договоре, так что проверяется именно
 * разводка роутера — какие ручки кэшируются, под каким именем, с каким TTL и
 * какие нарочно живые. Склейка одновременных промахов и Redis — забота
 * report-cache.test, не этого файла.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { asTestContext } from "./helpers/test-context";

vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  return drizzleMock();
});
vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());

/** Что роутер попросил у кэша: имя, вход, TTL — сверяем с таблицей решений. */
const cacheCalls: Array<{ tenantId: number; name: string; input: unknown; ttlMs: number }> = [];
const store = new Map<string, unknown>();

vi.mock("../lib/report-cache", () => ({
  ReportTTL: { live: 20_000, minute: 60_000, fiveMin: 5 * 60_000 },
  reportCached: async (tenantId: number, name: string, input: unknown, ttlMs: number, fn: () => Promise<unknown>) => {
    cacheCalls.push({ tenantId, name, input, ttlMs });
    const key = `report:${tenantId}:${name}:${JSON.stringify(input)}`;
    if (store.has(key)) return store.get(key);
    const value = await fn();
    store.set(key, value);
    return value;
  },
  invalidateReports: async () => {},
}));

let mockDb: any;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

import { orders, users, dailyPlans, agentLocations, subscriptions, stockMovements } from "@db/schema";

/**
 * Подделка базы: считает обращения и отдаёт заготовленные строки по таблице
 * и по форме выборки. Условия WHERE не разбирает — тут судят не о фильтрах
 * (их стерегут reports-logs и cost-price-exposure), а о числе обращений и о
 * том, что числа сквозь кэш доходят нетронутыми.
 */
let selects = 0;

function rowsFor(table: unknown, fields: Record<string, unknown> | undefined): unknown[] {
  const aliases = Object.keys(fields ?? {});
  if (table === users)          return [{ count: 3 }];
  if (table === subscriptions)  return [{ id: 1, tenantId: 1, plan: "pro" }];
  if (table === agentLocations) return [{ agentId: 10 }, { agentId: 11 }];
  if (table === dailyPlans) {
    if (aliases.includes("agentName")) return [{ agentId: 10, agentName: "Агент Один", total: 4, visited: 3, planned: 1, skipped: 0 }];
    if (aliases.includes("date"))      return [{ date: "2026-09-13", count: 7 }];
    return [{ count: 5 }];
  }
  if (table === orders) {
    if (aliases.includes("date")) return [{ date: "2026-09-13", count: 2, revenue: "150000.50" }];
    return [{ count: 40, total: "1234567.89" }];
  }
  if (table === stockMovements) return [{ createdAt: "2026-09-13 10:00:00", type: "in", quantity: "1.00" }];
  return [];
}

function makeMockDb() {
  return {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: unknown) => {
        selects++;
        const rows = rowsFor(table, fields);
        const chain: any = Promise.resolve(rows);
        for (const m of ["where", "leftJoin", "groupBy", "orderBy", "limit"]) chain[m] = () => chain;
        return chain;
      },
    }),
  };
}

function ctx(tenantId = 1) {
  return asTestContext({
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    db: mockDb,
    tenant: { id: tenantId, slug: "t", name: "T", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    user: { id: 1, tenantId, role: "ceo", status: "active" as const, name: "T", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
  });
}

async function caller(tenantId = 1) {
  const { reportsRouter } = await import("../reports-router");
  return reportsRouter.createCaller(ctx(tenantId));
}

beforeEach(() => {
  selects = 0;
  cacheCalls.length = 0;
  store.clear();
  mockDb = makeMockDb();
});

describe("reports.getDashboardSummary — один пересчёт на организацию", () => {
  it("считает за пять обращений и отдаёт точные числа", async () => {
    const summary = await (await caller()).getDashboardSummary();

    // Было шесть: count и SUM по одному условию шли порознь. Стало пять.
    expect(selects).toBe(5);
    expect(summary).toEqual({
      totalAgents: 3,
      activeNow: 2,
      visitsToday: 5,
      ordersMonth: 40,
      revenueMonth: 1234567.89,
      avgOrdersPerAgent: 13.3,
      subscription: { id: 1, tenantId: 1, plan: "pro" },
    });
  });

  it("второй зритель в базу не ходит и видит те же числа", async () => {
    const first = await (await caller()).getDashboardSummary();
    const afterFirst = selects;

    const second = await (await caller()).getDashboardSummary();

    expect(selects).toBe(afterFirst);
    expect(second).toEqual(first);
  });

  it("другая организация не получает чужую сводку из кэша", async () => {
    await (await caller(1)).getDashboardSummary();
    const afterFirst = selects;

    await (await caller(2)).getDashboardSummary();

    expect(selects).toBeGreaterThan(afterFirst);
    expect(cacheCalls.map(c => c.tenantId)).toEqual([1, 2]);
  });
});

describe("reports.getVisitChart", () => {
  it("кэшируется по числу дней: 7 и 30 — разные ключи, 30 и 30 — один", async () => {
    const c = await caller();
    const d30 = await c.getVisitChart({ days: 30 });
    const after30 = selects;

    await c.getVisitChart({ days: 7 });
    expect(selects).toBeGreaterThan(after30);
    const after7 = selects;

    const again = await c.getVisitChart({ days: 30 });
    expect(selects).toBe(after7);
    expect(again).toEqual(d30);
    expect(again).toEqual([{ date: "2026-09-13", visits: 7, orders: 2, revenue: 150000.5 }]);
  });
});

describe("reports.getPlanCompletion", () => {
  it("второе открытие в базу не ходит, проценты те же", async () => {
    const c = await caller();
    const first = await c.getPlanCompletion();
    const afterFirst = selects;

    const second = await c.getPlanCompletion();

    expect(selects).toBe(afterFirst);
    expect(second).toEqual(first);
    expect(second[0].pct).toBe(75);
  });
});

/**
 * Таблица решений. Имя обязано быть своим у каждой ручки: у сводки и хода
 * плана вход одинаково пустой, и одно имя на двоих отдало бы директору
 * сводку там, где он ждёт план. TTL — из разведки: сводка минуту (окно
 * «активных» два часа, а пинги кэш не сбрасывают), график пять минут (линия
 * за месяц от одного заказа не двигается), ход плана 20 с (супервайзер
 * смотрит день, визиты сбрасывать нельзя — сотни в день).
 */
describe("что кэшируется, под каким именем и на сколько", () => {
  it("сводка — минута, график — пять минут, ход плана — 20 с", async () => {
    const c = await caller();
    await c.getDashboardSummary();
    await c.getVisitChart({ days: 30 });
    await c.getPlanCompletion();

    expect(cacheCalls.map(({ name, input, ttlMs }) => ({ name, input, ttlMs }))).toEqual([
      { name: "reports.getDashboardSummary", input: {}, ttlMs: 60_000 },
      { name: "reports.getVisitChart", input: { days: 30 }, ttlMs: 5 * 60_000 },
      { name: "reports.getPlanCompletion", input: {}, ttlMs: 20_000 },
    ]);
  });

  it("выгрузки — журнал визитов и движения склада — живые, мимо кэша", async () => {
    const c = await caller();
    const period = { dateFrom: "2026-09-01", dateTo: "2026-09-30" };

    await c.getVisitsLog(period);
    await c.getVisitsLog(period);
    await c.getStockMovements(period);
    await c.getStockMovements(period);

    // До 10 000 строк по произвольным датам: попаданий не будет, а мегабайты
    // в памяти и Redis вытеснят то, ради чего кэш заведён.
    expect(cacheCalls).toEqual([]);
    expect(selects).toBe(4);
  });
});
