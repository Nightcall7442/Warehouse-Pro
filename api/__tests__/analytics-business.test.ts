/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TrpcContext } from "../context";
import { asTestContext } from "./helpers/test-context";

vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  return drizzleMock();
});

vi.mock("../telegram-router", () => ({
  notifyAdmin: vi.fn(async () => {}),
  tgMessages: { newOrder: vi.fn(() => "mock") },
}));

vi.mock("../lib/feature-gating", () => ({
  checkSubscriptionAccess: vi.fn(async () => true),
}));

vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());

vi.mock("../lib/sse", () => ({
  sseBus: { emit: vi.fn() },
}));

let mockDb: any;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

import { orders, orderItems, products, shops, users, dailyPlans, arrivals } from "@db/schema";
import { makeConditionEvaluator } from "./helpers/fake-conditions";

interface FakeOrder { id: number; tenantId: number; agentId: number; shopId: number; status: string; total: string; discount: string; paymentMethod: string; createdAt: string; }
interface FakeOrderItem { id: number; orderId: number; productId: number; quantity: string; subtotal: string; }
interface FakeProduct { id: number; tenantId: number; name: string; code: string; costPrice: string; category: string; }
interface FakeShop { id: number; tenantId: number; name: string; city: string; debt: string; agentId: number; territoryId: number; }
interface FakeUser { id: number; tenantId: number; name: string; role: string; }
interface FakeArrival { id: number; tenantId: number; status: string; totalExpense: string; arrivalDate: string; }

let ordersTable: FakeOrder[] = [];
let orderItemsTable: FakeOrderItem[] = [];
let productsTable: FakeProduct[] = [];
let shopsTable: FakeShop[] = [];
let usersTable: FakeUser[] = [];
let arrivalsTable: FakeArrival[] = [];
let dailyPlansTable: any[] = [];

function resetTables() {
  ordersTable = [
    { id: 1, tenantId: 1, agentId: 10, shopId: 1, status: "delivered", total: "500.00", discount: "10.00", paymentMethod: "cash", createdAt: "2025-06-15T10:00:00Z" },
    { id: 2, tenantId: 1, agentId: 10, shopId: 2, status: "delivered", total: "300.00", discount: "0.00", paymentMethod: "debt", createdAt: "2025-06-16T11:00:00Z" },
    { id: 3, tenantId: 1, agentId: 11, shopId: 1, status: "processing", total: "200.00", discount: "5.00", paymentMethod: "card", createdAt: "2025-06-17T12:00:00Z" },
  ];
  orderItemsTable = [
    { id: 1, orderId: 1, productId: 1, quantity: "5.00", subtotal: "500.00" },
    { id: 2, orderId: 2, productId: 2, quantity: "10.00", subtotal: "300.00" },
    { id: 3, orderId: 3, productId: 1, quantity: "2.00", subtotal: "200.00" },
  ];
  productsTable = [
    { id: 1, tenantId: 1, name: "Product A", code: "PA001", costPrice: "80.00", category: "Напитки" },
    { id: 2, tenantId: 1, name: "Product B", code: "PB002", costPrice: "25.00", category: "Снеки" },
  ];
  shopsTable = [
    { id: 1, tenantId: 1, name: "Shop Alpha", city: "Tashkent", debt: "150.00", agentId: 10, territoryId: 100 },
    { id: 2, tenantId: 1, name: "Shop Beta", city: "Samarkand", debt: "400.00", agentId: 11, territoryId: 200 },
    { id: 3, tenantId: 2, name: "Shop Gamma", city: "Bukhara", debt: "200.00", agentId: 10, territoryId: 100 },
  ];
  usersTable = [
    { id: 10, tenantId: 1, name: "Agent One", role: "agent" },
    { id: 11, tenantId: 1, name: "Agent Two", role: "agent" },
  ];
  arrivalsTable = [
    { id: 1, tenantId: 1, status: "completed", totalExpense: "1000.00", arrivalDate: "2025-06-01" },
  ];
  dailyPlansTable = [];
}

const columnToField = new Map<unknown, string>();
// Takes a drizzle table, whose type is far from Record<string, unknown> — the
// narrower signature made every call site an error.
function reg(table: object, name: string) {
  columnToField.set((table as Record<string, unknown>)[name], name);
}
reg(orders, "id"); reg(orders, "tenantId"); reg(orders, "agentId"); reg(orders, "shopId");
reg(orders, "status"); reg(orders, "total"); reg(orders, "discount"); reg(orders, "paymentMethod"); reg(orders, "createdAt");
reg(orderItems, "id"); reg(orderItems, "orderId"); reg(orderItems, "productId");
reg(orderItems, "quantity"); reg(orderItems, "subtotal");
reg(products, "id"); reg(products, "tenantId"); reg(products, "name"); reg(products, "code"); reg(products, "costPrice"); reg(products, "category");
reg(shops, "id"); reg(shops, "tenantId"); reg(shops, "name"); reg(shops, "city"); reg(shops, "debt"); reg(shops, "agentId"); reg(shops, "territoryId");
reg(users, "id"); reg(users, "tenantId"); reg(users, "name"); reg(users, "role");
reg(arrivals, "id"); reg(arrivals, "tenantId"); reg(arrivals, "status"); reg(arrivals, "totalExpense"); reg(arrivals, "arrivalDate");

function mapCol(col: unknown): string {
  return columnToField.get(col) ?? (col as any)?.name ?? String(col);
}

/**
 * Разбор условий отдан общему строгому разборщику.
 *
 * Местная копия считала выполненным всё, чего не понимала: из операторов она
 * знала не более двух-трёх, а остальные — включая `isNull` и `inArray` —
 * молча проходили. Убери кто-нибудь такой фильтр из продакшена, тест остался
 * бы зелёным.
 *
 * treatMissingColumnAsMatch оставлен намеренно: строки этого стенда описаны
 * частично, и без послабления упали бы проверки, к самому продукту отношения
 * не имеющие. Флаг виден здесь при чтении и снимается отдельно, вместе с
 * доописыванием строк.
 */
const evalCond = makeConditionEvaluator({
  fieldOf: mapCol,
  treatMissingColumnAsMatch: true,
  // Сырой sql`` этот стенд не воспроизводит; условие считается выполненным.
  // Решение записано здесь, а не спрятано в умолчании разборщика.
  rawSql: () => true,
});

function evalAgg(def: any, rows: Record<string, unknown>[]): unknown {
  const sqlStr = (def.strings as string[]).join("");
  const vals = (def.values ?? []) as unknown[];

  if (/COUNT\s*\(/i.test(sqlStr) && /\*/.test(sqlStr)) return rows.length;

  if (/SUM/i.test(sqlStr)) {
    if (vals.length >= 2) {
      const f1 = mapCol(vals[0]); const f2 = mapCol(vals[1]);
      if (rows.length > 0 && f1 in rows[0] && f2 in rows[0]) {
        return String(rows.reduce((s, r) => s + Number(r[f1] ?? 0) * Number(r[f2] ?? 0), 0));
      }
    }
    if (vals.length >= 1) {
      const field = mapCol(vals[0]);
      if (rows.length > 0 && field in rows[0]) {
        return String(rows.reduce((s, r) => s + Number(r[field] ?? 0), 0));
      }
    }
    return "0";
  }

  if (/AVG/i.test(sqlStr)) {
    if (vals.length >= 1) {
      const field = mapCol(vals[0]);
      if (rows.length > 0 && field in rows[0]) {
        const total = rows.reduce((s, r) => s + Number(r[field] ?? 0), 0);
        return String(total / rows.length);
      }
    }
    return "0";
  }

  return "0";
}

function buildChain(rows: Record<string, unknown>[]) {
  const chain: any = Promise.resolve(rows);
  chain.limit = (n: number) => buildChain(rows.slice(0, n));
  chain.offset = (n: number) => buildChain(rows.slice(n));
  chain.orderBy = () => chain;
  chain.groupBy = () => chain;
  chain.leftJoin = () => chain;
  chain.innerJoin = () => chain;
  chain.for = () => chain;
  return chain;
}

function useTable(col: unknown): Record<string, unknown>[] {
  if (col === orders) return ordersTable as any;
  if (col === orderItems) return orderItemsTable as any;
  if (col === products) return productsTable as any;
  if (col === shops) return shopsTable as any;
  if (col === users) return usersTable as any;
  if (col === arrivals) return arrivalsTable as any;
  if (col === dailyPlans) return dailyPlansTable as any;
  return [];
}

function makeMockDb() {
  const db: any = {};
  db.select = (fields?: any) => {
    const sel: any = {};
    sel.from = (table: any) => {
      const primaryRows = useTable(table);
      const joins: Array<{ table: Record<string, unknown>[]; primaryCol: string; joinCol: string }> = [];

      const from: any = {};
      from.leftJoin = (joinTable: any, joinCond: unknown) => {
        if (joinCond && typeof joinCond === "object" && (joinCond as any).__kind === "eq") {
          joins.push({
            table: useTable(joinTable),
            primaryCol: mapCol((joinCond as any).col),
            joinCol: mapCol((joinCond as any).val),
          });
        }
        return from;
      };
      from.innerJoin = from.leftJoin;
      from.where = (cond: unknown) => {
        // Joins first, then the condition — the order SQL itself uses. Filtering
        // the primary rows before expanding meant any condition naming a joined
        // table's column hit a row that didn't carry it, fell through the
        // `!(field in row)` escape hatch, and was silently ignored. Every filter
        // on products.category or orders.agentId in a query that starts FROM
        // order_items would have tested nothing.
        let expanded: Record<string, unknown>[] = primaryRows;
        for (const join of joins) {
          const newExpanded: Record<string, unknown>[] = [];
          for (const row of expanded) {
            const matches = join.table.filter((jr: any) => String(jr[join.joinCol]) === String(row[join.primaryCol]));
            if (matches.length === 0) {
              newExpanded.push({ ...row });
            } else {
              for (const match of matches) {
                // The FROM table wins a name collision. Rows here are flat, so
                // joining users onto shops put the agent's name into `name` and
                // the agent's tenant into `tenantId` — which meant the tenant
                // scoping in every such query was checking the wrong table.
                // Real SQL qualifies each column; flattening has to pick, and
                // picking the primary keeps WHERE honest.
                newExpanded.push({ ...match, ...row });
              }
            }
          }
          expanded = newExpanded;
        }

        expanded = expanded.filter((r) => evalCond(r, cond as Record<string, unknown>));

        if (fields && typeof fields === "object" && !Array.isArray(fields)) {
          const hasAgg = Object.values(fields).some(
            (def: any) => typeof def === "object" && def !== null && def.__kind === "sql"
          );

          if (hasAgg) {
            const groupCols: Array<{ alias: string; field: string }> = [];
            const aggs: Array<{ alias: string; def: any }> = [];
            for (const [alias, def] of Object.entries(fields)) {
              if (typeof def === "object" && def !== null && (def as any).__kind === "sql") {
                aggs.push({ alias, def: def as any });
              } else {
                groupCols.push({ alias, field: mapCol(def) });
              }
            }

            if (groupCols.length > 0) {
              const groups = new Map<string, Record<string, unknown>[]>();
              for (const row of expanded) {
                const key = groupCols.map(gc => String(row[gc.field] ?? "")).join("|");
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(row);
              }
              return buildChain(Array.from(groups.values()).map(groupRows => {
                const out: Record<string, unknown> = {};
                for (const gc of groupCols) out[gc.alias] = groupRows[0][gc.field];
                for (const { alias, def } of aggs) out[alias] = evalAgg(def, groupRows);
                return out;
              }));
            } else {
              const out: Record<string, unknown> = {};
              for (const { alias, def } of aggs) out[alias] = evalAgg(def, expanded);
              return buildChain([out]);
            }
          }

          return buildChain(expanded.map(row => {
            const out: Record<string, unknown> = {};
            for (const [alias, def] of Object.entries(fields)) {
              out[alias] = typeof def === "object" && def !== null && (def as any).__kind === "sql"
                ? evalAgg(def as any, [row])
                : row[mapCol(def)] ?? null;
            }
            return out;
          }));
        }

        return buildChain(expanded);
      };
      from.limit = (n: number) => buildChain(primaryRows.slice(0, n));
      from.orderBy = () => from;
      from.groupBy = () => from;
      return from;
    };
    return sel;
  };
  db.transaction = (fn: (tx: any) => Promise<any>) => fn(db);
  return db;
}

/**
 * Cost and margin are CEO-only, so these tests need a CEO. The default operator
 * context is right for the sales-side procedures in this file and deliberately
 * left alone — it is what proves the narrower gate is actually enforced.
 */
/**
 * One place where the fake context meets the real router's context type. They
 * do not line up — the mock db is `any` and the user is a literal — and casting
 * at every call site turned each new test case into another type error.
 */
async function analytics(ctx: unknown = undefined) {
  const { analyticsRouter } = await import("../analytics-router");
  const context = (ctx ?? buildCtx()) as Parameters<typeof analyticsRouter.createCaller>[0];
  return analyticsRouter.createCaller(context);
}

function buildCeoCtx() {
  return buildCtx({ user: { ...buildCtx().user, role: "ceo" as const } });
}

function buildCtx(overrides: Record<string, unknown> = {}): TrpcContext {
  return asTestContext({
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    db: mockDb,
    tenant: { id: 1, slug: "test", name: "Test Co", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    user: { id: 1, tenantId: 1, role: "operator" as const, status: "active" as const, name: "Test", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTables();
  mockDb = makeMockDb();
});

describe("analytics.salesByShop", () => {
  it("returns shops ordered by revenue descending", async () => {
    const { analyticsRouter } = await import("../analytics-router");
    const caller = analyticsRouter.createCaller(buildCtx());
    const result = await caller.salesByShop({});
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].shopName).toBeDefined();
  });

  it("only returns data for current tenant", async () => {
    const { analyticsRouter } = await import("../analytics-router");
    const caller = analyticsRouter.createCaller(buildCtx());
    const result = await caller.salesByShop({});
    expect(result.every((r: any) => {
      const shop = shopsTable.find(s => s.name === r.shopName);
      return !shop || shop.tenantId === 1;
    })).toBe(true);
  });

  it("counts only orders that reached delivered", async () => {
    const { analyticsRouter } = await import("../analytics-router");
    const caller = analyticsRouter.createCaller(buildCtx());
    const result = await caller.salesByShop({});
    const totalRevenue = result.reduce((s: number, r: any) => s + Number(r.revenue), 0);
    expect(totalRevenue).toBe(800);
  });
});

describe("analytics.topProducts", () => {
  it("returns top products by quantity", async () => {
    const { analyticsRouter } = await import("../analytics-router");
    const caller = analyticsRouter.createCaller(buildCtx());
    const result = await caller.topProducts({});
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].productName).toBeDefined();
    expect(result[0].totalQty).toBeDefined();
  });

  it("limits results", async () => {
    const { analyticsRouter } = await import("../analytics-router");
    const caller = analyticsRouter.createCaller(buildCtx());
    const result = await caller.topProducts({});
    expect(result.length).toBeLessThanOrEqual(10);
  });
});

describe("analytics.cogsSummary", () => {
  it("calculates total revenue, cost, and discount", async () => {
    const { analyticsRouter } = await import("../analytics-router");
    const caller = analyticsRouter.createCaller(buildCeoCtx());
    const result = await caller.cogsSummary({});
    expect(result).toBeDefined();
    expect(Number(result.totalRevenue)).toBeGreaterThanOrEqual(0);
    expect(Number(result.totalCost)).toBeGreaterThanOrEqual(0);
    expect(Number(result.totalDiscount)).toBeGreaterThanOrEqual(0);
  });

  it("returns zeros when no completed orders", async () => {
    ordersTable = [];
    const { analyticsRouter } = await import("../analytics-router");
    const caller = analyticsRouter.createCaller(buildCeoCtx());
    const result = await caller.cogsSummary({});
    expect(Number(result.totalRevenue)).toBe(0);
    expect(Number(result.totalCost)).toBe(0);
  });
});

describe("analytics.debtReport", () => {
  it("returns only shops with positive debt", async () => {
    const { analyticsRouter } = await import("../analytics-router");
    const caller = analyticsRouter.createCaller(buildCeoCtx());
    const result = await caller.debtReport();
    expect(result.every((r: any) => Number(r.debt) > 0)).toBe(true);
  });

  it("only shows shops from current tenant", async () => {
    const { analyticsRouter } = await import("../analytics-router");
    const caller = analyticsRouter.createCaller(buildCeoCtx());
    const result = await caller.debtReport();
    expect(result.every((r: any) => {
      const shop = shopsTable.find(s => s.name === r.shopName);
      return !shop || shop.tenantId === 1;
    })).toBe(true);
  });
});

describe("analytics.agentPerformance", () => {
  it("returns agent stats", async () => {
    const { analyticsRouter } = await import("../analytics-router");
    const caller = analyticsRouter.createCaller(buildCeoCtx());
    const result = await caller.agentPerformance({});
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].agentName).toBeDefined();
    expect(result[0].orderCount).toBeDefined();
  });
});

// ── Report filters ──────────────────────────────────────────────────────────
//
// Every card in the reports hub narrows the same handful of queries. A filter
// that is accepted by the schema and then dropped before the WHERE clause is
// the worst outcome available: the file downloads, looks plausible, and covers
// the wrong set — and nothing on the sheet says so.
//
// Watch the fixtures rather than the assertions when reading these. The fake db
// ignores a condition on a column its rows don't carry (`if (!(field in row))
// return true`), so a filter tested against a row without that field passes
// while doing nothing. Every column filtered below is present in the fixtures
// and registered with reg().
describe("report filters", () => {
  describe("analytics.topProducts", () => {
    it("narrows to one agent", async () => {
      const caller = await analytics();

      const all = await caller.topProducts({});
      const agent10 = await caller.topProducts({ agentId: 10 });
      const agent11 = await caller.topProducts({ agentId: 11 });

      expect(all.length).toBeGreaterThan(agent11.length);
      // Order 3 is Agent Two's and it is "processing", so it never counts as
      // revenue — the agent's product list comes back empty, not merely smaller.
      expect(agent11).toHaveLength(0);
      expect(agent10.map(r => r.productName).sort()).toEqual(["Product A", "Product B"]);
    });

    it("narrows to one category", async () => {
      const caller = await analytics();

      const drinks = await caller.topProducts({ category: "Напитки" });

      expect(drinks.map(r => r.productName)).toEqual(["Product A"]);
    });

    it("combines both filters rather than letting the last one win", async () => {
      const caller = await analytics();

      expect(await caller.topProducts({ agentId: 10, category: "Снеки" }))
        .toHaveLength(1);
      // Agent Two sold nothing that counts, so adding a category they never
      // touched must still come back empty.
      expect(await caller.topProducts({ agentId: 11, category: "Напитки" }))
        .toHaveLength(0);
    });
  });

  describe("analytics.salesByShop", () => {
    it("narrows to one agent", async () => {
      const caller = await analytics();

      const rows = await caller.salesByShop({ agentId: 10 });

      expect(rows.every(r => Number(r.revenue) > 0)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
    });

    it("narrows to one territory", async () => {
      const caller = await analytics();

      const t100 = await caller.salesByShop({ territoryId: 100 });
      const t999 = await caller.salesByShop({ territoryId: 999 });

      expect(t100.map(r => r.shopName)).toEqual(["Shop Alpha"]);
      expect(t999).toHaveLength(0);
    });
  });

  describe("analytics.debtReport", () => {
    it("returns every debtor when unfiltered", async () => {
      const caller = await analytics();

      const rows = await caller.debtReport();

      // Shop Gamma belongs to another tenant and must never appear.
      expect(rows.map(r => r.shopName).sort()).toEqual(["Shop Alpha", "Shop Beta"]);
    });

    it("narrows to the agent who holds the shop", async () => {
      const caller = await analytics();

      expect((await caller.debtReport({ agentId: 10 })).map(r => r.shopName)).toEqual(["Shop Alpha"]);
      expect((await caller.debtReport({ agentId: 11 })).map(r => r.shopName)).toEqual(["Shop Beta"]);
    });

    it("narrows to one territory", async () => {
      const caller = await analytics();

      expect((await caller.debtReport({ territoryId: 200 })).map(r => r.shopName)).toEqual(["Shop Beta"]);
    });

    // Tenant isolation is the one thing a filter must never be able to widen.
    it("cannot be used to reach another tenant's shops", async () => {
      const caller = await analytics();

      const rows = await caller.debtReport({ agentId: 10, territoryId: 100 });

      expect(rows.map(r => r.shopName)).not.toContain("Shop Gamma");
    });
  });

  describe("analytics.agentProductSales", () => {
    it("narrows to one category", async () => {
      const caller = await analytics();

      const rows = await caller.agentProductSales({ category: "Снеки" });

      // Asserted on the code, not the name: this query joins both users and
      // products, and the harness flattens rows, so a `name` column exists on
      // both and one of them has to lose. `code` belongs to products alone.
      expect(rows.map(r => r.productCode)).toEqual(["PB002"]);
    });
  });

  describe("analytics.pnlByPaymentMethod", () => {
    it("narrows to one agent", async () => {
      const caller = await analytics(buildCeoCtx());

      const range = { from: "2025-06-01", to: "2025-06-30" };
      const all = await caller.pnlByPaymentMethod(range);
      const agent11 = await caller.pnlByPaymentMethod({ ...range, agentId: 11 });

      expect(all.length).toBeGreaterThan(0);
      // Agent Two's only order is "processing", so nothing of theirs counts.
      expect(agent11).toHaveLength(0);
    });
  });

  // agentEfficiency filters by territory through an EXISTS against
  // agent_territories, because an agent can work several. The fake db has no
  // subquery support — it would return every row and the test would pass while
  // proving nothing — so this one is asserted against the source instead, and
  // is the only filter here not covered behaviourally.
  describe("analytics.agentEfficiency", () => {
    it("filters by territory with EXISTS rather than a join", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const src = readFileSync(resolve(__dirname, "../analytics-router.ts"), "utf8");
      const start = src.indexOf("  agentEfficiency:");
      const body = src.slice(start, src.indexOf("  pnl:", start));

      expect(body).toMatch(/territoryId: z\.number\(\)/);
      // A join would multiply an agent's rows once per territory and inflate
      // every aggregate above it.
      expect(body).toMatch(/EXISTS \(/);
      expect(body).not.toMatch(/leftJoin\(agentTerritories/);
    });
  });

  describe("analytics.cogsByProduct", () => {
    it("narrows to one category", async () => {
      const caller = await analytics(buildCeoCtx());

      const rows = await caller.cogsByProduct({ category: "Напитки" });

      expect(rows.map(r => r.productName)).toEqual(["Product A"]);
    });
  });
});
