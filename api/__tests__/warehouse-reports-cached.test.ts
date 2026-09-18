/**
 * «Отчёты по складу» считаются один раз на организацию, а не на каждого, кто
 * открыл страницу.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Страница шлёт пять запросов на открытие, и после любой своей мутации клиент
 * перезапрашивает их все (useOrderCacheSync). Ни одна из девяти ручек
 * warehouseReports не кэшировалась: тридцать человек в одной организации —
 * тридцать агрегатов по всему остатку, а reorderAlerts к тому же считал
 * продажи коррелированным подзапросом на каждую строку склада, дважды.
 *
 * ── Что стережём ────────────────────────────────────────────────────────────
 *
 * Стенд считает обращения к базе. Убери reportCached из ручки — второй вызов
 * снова пойдёт в базу, и проверка упадёт. Числа сквозь кэш доходят нетронутыми.
 * Отдельно: под каким именем, с каким входом и TTL каждая ручка просит кэш,
 * что день попал в ключ там, где от него зависят границы «просрочено/горит»,
 * и что productBatches нарочно остаётся живым.
 *
 * report-cache подменён честной подделкой с настоящей картой — ключ тот же,
 * что в договоре (арендатор, имя, вход). Склейка одновременных промахов,
 * версии и Redis — забота report-cache.test, не этого файла.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { asTestContext } from "./helpers/test-context";
import { dayKey } from "../lib/period";

vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  // Стандартный мок не даёт sql``.as() и .mapWith(): продакшен-код называет
  // так колонку производной таблицы и приводит DATEDIFF к числу.
  const base = drizzleMock();
  const wrapped = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const node: any = { __kind: "sql", strings, values };
      node.as = (alias: string) => ({ ...node, __alias: alias });
      node.mapWith = () => node;
      return node;
    },
    base.sql as object,
  );
  return { ...base, sql: wrapped };
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

import { warehouseStock, stockMovements, arrivals, stockBatches, orderItems } from "@db/schema";

/** Сколько раз код сходил в базу (select … from). */
let selects = 0;
/** Из каких таблиц читали — по порядку. */
let tables: unknown[] = [];

/**
 * Подделка базы: отдаёт заготовленные строки по таблице и по форме выборки.
 * Условия WHERE не разбирает — тут судят о числе обращений и о том, что
 * числа сквозь кэш доходят нетронутыми; сами фильтры стерегут
 * audit-reports-speed (turnover) и real-db/warehouse-reports.
 */
function rowsFor(table: unknown, fields: Record<string, unknown> | undefined): unknown[] {
  const has = (f: string) => Object.keys(fields ?? {}).includes(f);
  if (table === warehouseStock) {
    if (has("totalValue")) return [{ category: "Бакалея", totalProducts: 2, totalUnits: "150.000", totalValue: "123456.78", totalRetail: "200000.00", lowStockCount: 1 }];
    if (has("soldQty"))    return [{ productId: 1, productName: "Сахар", productCode: "S-1", unit: "кг", category: "Бакалея", currentStock: "100.000", available: "90.000", reorderPoint: "5.00", soldQty: "50" }];
    if (has("onHand"))     return [{ onHand: 10 }];
    return [{ productId: 1, productName: "Сахар", productCode: "S-1", currentStock: "100.000", costValue: "100000.00", retailValue: "150000.00", margin: "50000.00" }];
  }
  if (table === stockMovements) return [{ date: "2026-09-13", inQty: "10.000", outQty: "3.000", adjustmentQty: "0.000", movements: 4 }];
  if (table === arrivals) {
    if (has("date")) return [{ date: "2026-09-13", arrivals: 1, fuelCost: "500.00", tollCost: "0.00", totalExpense: "500.00" }];
    return [{ totalArrivals: 2, totalFuelCost: "1500.50", totalTollCost: "200.00", totalOtherCost: "0.00", totalExpense: "1700.50", totalUnits: "40.000" }];
  }
  if (table === stockBatches) {
    if (has("expiredCount")) return [{ expiredCount: 1, expiredValue: 960, urgentCount: 2, soonCount: 3, liveValue: 5000.5 }];
    if (has("batchId") && has("productName")) return [{ batchId: 7, productId: 1, productName: "Сахар", productCode: "S-1", unit: "кг", warehouseId: 1, warehouseName: "Основной", batchNumber: "L-1", expiresAt: "2026-09-17", quantity: "12.000", costPrice: "80.00", daysLeft: 3 }];
    return [{ batchId: 7, warehouseId: 1, batchNumber: "L-1", expiresAt: "2026-09-17", quantity: "4.000", receivedAt: "2026-09-01", daysLeft: 3 }];
  }
  return [];
}

function makeMockDb() {
  return {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: unknown) => {
        selects++;
        tables.push(table);
        const chain: any = Promise.resolve(rowsFor(table, fields));
        for (const m of ["where", "leftJoin", "innerJoin", "groupBy", "orderBy", "limit"]) chain[m] = () => chain;
        chain.as = () => chain;
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
  const { warehouseReportsRouter } = await import("../warehouse-reports-router");
  return warehouseReportsRouter.createCaller(ctx(tenantId));
}

beforeEach(() => {
  selects = 0;
  tables = [];
  cacheCalls.length = 0;
  store.clear();
  mockDb = makeMockDb();
});

/** Второй такой же вызов в базу не ходит и отдаёт те же данные. */
async function twice<T>(run: () => Promise<T>): Promise<{ first: T; second: T; dbCalls: number }> {
  const first = await run();
  const dbCalls = selects;
  expect(dbCalls, "первый вызов обязан сходить в базу").toBeGreaterThan(0);
  const second = await run();
  expect(selects, "второй вызов снова пошёл в базу — кэш снят").toBe(dbCalls);
  expect(second).toEqual(first);
  return { first, second, dbCalls };
}

describe("warehouseReports: восемь ручек кэшируются, числа те же", () => {
  it("stockByCategory — плитки «стоимость склада / низкие остатки»", async () => {
    const c = await caller();
    const { first } = await twice(() => c.stockByCategory());
    expect(first[0]).toMatchObject({ category: "Бакалея", totalValue: "123456.78", lowStockCount: 1 });
  });

  it("movementTrends", async () => {
    const c = await caller();
    const { first } = await twice(() => c.movementTrends({ days: 30 }));
    expect(first[0]).toMatchObject({ date: "2026-09-13", inQty: "10.000", movements: 4 });
  });

  it("topByValue", async () => {
    const c = await caller();
    const { first } = await twice(() => c.topByValue({ limit: 10 }));
    expect(first[0]).toMatchObject({ productCode: "S-1", costValue: "100000.00" });
  });

  it("arrivalCosts — свод и разбивка по дням одним значением", async () => {
    const c = await caller();
    const { first, dbCalls } = await twice(() => c.arrivalCosts({ days: 30 }));
    expect(dbCalls, "свод и дни — два запроса").toBe(2);
    expect(first.summary).toMatchObject({ totalArrivals: 2, totalExpense: "1700.50" });
    expect(first.daily[0]).toMatchObject({ date: "2026-09-13", fuelCost: "500.00" });
  });

  it("turnover — производные поля считаются один раз и приезжают из кэша", async () => {
    const c = await caller();
    const { first } = await twice(() => c.turnover({ days: 30 }));
    // 50 продано, 100 на полке: средний запас 125, оборачиваемость 0.40, распродаётся за 60 дней.
    expect(first[0]).toMatchObject({ productCode: "S-1", soldQty: "50", turnoverRate: "0.40", daysToSell: 60 });
  });

  it("reorderAlerts — скорость продаж и уровень тревоги те же", async () => {
    const c = await caller();
    const { first } = await twice(() => c.reorderAlerts({ days: 30 }));
    // 50 за 30 дней = 1.67 в день; 100 на полке хватит на 60 дней; порог 5 при доступных 90 — ok.
    expect(first[0]).toMatchObject({ productCode: "S-1", dailyVelocity: "1.67", daysUntilStockout: 60, dynamicReorderPoint: 12, alertLevel: "ok" });
  });

  it("expiring — партии с состоянием", async () => {
    const c = await caller();
    const { first } = await twice(() => c.expiring({ withinDays: 30 }));
    expect(first[0]).toMatchObject({ batchId: 7, quantity: 12, daysLeft: 3, value: 960, state: "urgent" });
  });

  it("expiringSummary — плитка", async () => {
    const c = await caller();
    const { first } = await twice(() => c.expiringSummary({ withinDays: 30 }));
    expect(first).toEqual({ expiredCount: 1, expiredValue: 960, urgentCount: 2, soonCount: 3, liveValue: 5000.5 });
  });
});

describe("warehouseReports: что нарочно живое", () => {
  it("productBatches — карточка товара, каждый вызов в базу", async () => {
    const c = await caller();
    await c.productBatches({ productId: 1 });
    const once = selects;
    expect(once).toBeGreaterThan(0);
    await c.productBatches({ productId: 1 });
    expect(selects, "точечное чтение из карточки стало кэшироваться — ключей будет столько, сколько товаров").toBe(once * 2);
    expect(cacheCalls.map(x => x.name)).not.toContain("warehouse.productBatches");
  });
});

describe("warehouseReports: ключ и срок", () => {
  it("имя → TTL: плитки остатка — минута, остальное — пять минут", async () => {
    const c = await caller();
    await c.stockByCategory();
    await c.movementTrends({ days: 30 });
    await c.topByValue({ limit: 10 });
    await c.arrivalCosts({ days: 30 });
    await c.turnover({ days: 30 });
    await c.reorderAlerts({ days: 30 });
    await c.expiring({ withinDays: 30 });
    await c.expiringSummary({ withinDays: 30 });

    const ttlOf = Object.fromEntries(cacheCalls.map(x => [x.name, x.ttlMs]));
    expect(ttlOf).toEqual({
      "warehouse.stockByCategory": 60_000,
      "warehouse.topByValue":      60_000,
      "warehouse.movementTrends":  300_000,
      "warehouse.arrivalCosts":    300_000,
      "warehouse.turnover":        300_000,
      "warehouse.reorderAlerts":   300_000,
      "warehouse.expiring":        300_000,
      "warehouse.expiringSummary": 300_000,
    });
    for (const call of cacheCalls) expect(call.tenantId, "ключ ушёл в чужую организацию").toBe(1);
  });

  it("вход — в ключе: 7 и 30 дней — разные ответы, 30 и 30 — один", async () => {
    const c = await caller();
    await c.movementTrends({ days: 7 });
    await c.movementTrends({ days: 30 });
    expect(selects).toBe(2);
    await c.movementTrends({ days: 30 });
    expect(selects).toBe(2);
    expect(cacheCalls.map(x => x.input)).toEqual([{ days: 7, warehouseId: null }, { days: 30, warehouseId: null }, { days: 30, warehouseId: null }]);
  });

  it("день — в ключе у «что сгорает»: в полночь границы «просрочено/горит» сдвигаются", async () => {
    const c = await caller();
    await c.expiring({ withinDays: 30 });
    await c.expiring({ withinDays: 30, warehouseId: 2 });
    await c.expiringSummary({ withinDays: 30 });

    const today = dayKey(new Date());
    expect(cacheCalls.map(x => x.input)).toEqual([
      { withinDays: 30, warehouseId: null, day: today },
      { withinDays: 30, warehouseId: 2, day: today },
      { withinDays: 30, day: today },
    ]);
    // Склад — отдельный ключ: список по одному складу не подменяет общий.
    expect(selects).toBe(3);
  });

  it("скользящее окно «now − days» в ключ не попадает — иначе промах всегда", async () => {
    const c = await caller();
    await c.turnover({ days: 30 });
    await c.arrivalCosts({ days: 30 });
    for (const call of cacheCalls) {
      expect(JSON.stringify(call.input), `в ключе ${call.name} завелась метка времени`).not.toMatch(/\d{4}-\d{2}-\d{2}|"cutoff"|\d{13}/);
    }
  });

  it("другая организация не получает чужой склад из кэша", async () => {
    await (await caller(1)).stockByCategory();
    await (await caller(2)).stockByCategory();
    expect(selects).toBe(2);
    expect(cacheCalls.map(x => x.tenantId)).toEqual([1, 2]);
  });
});

describe("reorderAlerts: продажи — один агрегат, а не подзапрос на строку", () => {
  it("order_items читается одной производной таблицей, как в turnover", async () => {
    const c = await caller();
    await c.reorderAlerts({ days: 30 });
    // Раньше SUM по order_items стоял коррелированным подзапросом в SELECT и
    // ORDER BY и через построитель запросов не проходил вовсе.
    expect(tables.filter(t => t === orderItems)).toHaveLength(1);

    const source = readFileSync("api/warehouse-reports-router.ts", "utf-8");
    expect(source, "коррелированный SUM по позициям вернулся").not.toMatch(/\(SELECT SUM\(\$\{orderItems\.quantity\}\)/);
    expect(source.split("soldByProductSince(db, tenantId, cutoff)").length - 1, "turnover и reorderAlerts обязаны делить один агрегат").toBe(2);
  });
});
