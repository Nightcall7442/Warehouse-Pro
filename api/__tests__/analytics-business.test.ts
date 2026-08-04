/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

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

vi.mock("../lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("../lib/sse", () => ({
  sseBus: { emit: vi.fn() },
}));

let mockDb: any;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

import { orders, orderItems, products, shops, users, dailyPlans, arrivals } from "@db/schema";

interface FakeOrder { id: number; tenantId: number; agentId: number; shopId: number; status: string; total: string; discount: string; paymentMethod: string; createdAt: string; }
interface FakeOrderItem { id: number; orderId: number; productId: number; quantity: string; subtotal: string; }
interface FakeProduct { id: number; tenantId: number; name: string; code: string; costPrice: string; }
interface FakeShop { id: number; tenantId: number; name: string; city: string; debt: string; }
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
    { id: 1, tenantId: 1, name: "Product A", code: "PA001", costPrice: "80.00" },
    { id: 2, tenantId: 1, name: "Product B", code: "PB002", costPrice: "25.00" },
  ];
  shopsTable = [
    { id: 1, tenantId: 1, name: "Shop Alpha", city: "Tashkent", debt: "150.00" },
    { id: 2, tenantId: 1, name: "Shop Beta", city: "Samarkand", debt: "0.00" },
    { id: 3, tenantId: 2, name: "Shop Gamma", city: "Bukhara", debt: "200.00" },
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
function reg(table: Record<string, unknown>, name: string) {
  columnToField.set(table[name], name);
}
reg(orders, "id"); reg(orders, "tenantId"); reg(orders, "agentId"); reg(orders, "shopId");
reg(orders, "status"); reg(orders, "total"); reg(orders, "discount"); reg(orders, "paymentMethod"); reg(orders, "createdAt");
reg(orderItems, "id"); reg(orderItems, "orderId"); reg(orderItems, "productId");
reg(orderItems, "quantity"); reg(orderItems, "subtotal");
reg(products, "id"); reg(products, "tenantId"); reg(products, "name"); reg(products, "code"); reg(products, "costPrice");
reg(shops, "id"); reg(shops, "tenantId"); reg(shops, "name"); reg(shops, "city"); reg(shops, "debt"); reg(shops, "agentId");
reg(users, "id"); reg(users, "tenantId"); reg(users, "name"); reg(users, "role");
reg(arrivals, "id"); reg(arrivals, "tenantId"); reg(arrivals, "status"); reg(arrivals, "totalExpense"); reg(arrivals, "arrivalDate");

function mapCol(col: unknown): string {
  return columnToField.get(col) ?? (col as any)?.name ?? String(col);
}

function tableOf(ref: unknown): string {
  if (ref === orders) return "orders";
  if (ref === orderItems) return "orderItems";
  if (ref === products) return "products";
  if (ref === shops) return "shops";
  if (ref === users) return "users";
  if (ref === arrivals) return "arrivals";
  if (ref === dailyPlans) return "dailyPlans";
  return "unknown";
}

function evalCond(row: Record<string, unknown>, cond: Record<string, unknown>): boolean {
  // Set membership. Without this branch an inArray filter falls through to the
  // permissive default below and the query appears to match every row — which
  // is how "only counts delivered orders" passed while counting all of them.
  if (cond && (cond as Record<string, unknown>).__kind === "inArray") {
    const field = mapCol((cond as Record<string, unknown>).col);
    if (!(field in row)) return true;
    const values = ((cond as Record<string, unknown>).values ?? []) as unknown[];
    return values.map(String).includes(String(row[field]));
  }

  if (!cond || typeof cond !== "object") return true;
  if (cond.__kind === "and") return (cond.conds as unknown[]).every((c: unknown) => evalCond(row, c as Record<string, unknown>));
  if (cond.__kind === "eq") {
    const field = mapCol(cond.col);
    if (!(field in row)) return true;
    return row[field] === cond.val || String(row[field]) === String(cond.val);
  }
  if (cond.__kind === "sql") {
    const values = (cond.values ?? []) as unknown[];
    const strings = (cond.strings ?? []) as string[];
    if (values.length >= 1) {
      const field = mapCol(values[0]);
      if (field in row) {
        for (const s of strings) {
          const m = s.match(/^\s*(>=|>|<=|<)\s*(-?\d+(?:\.\d+)?)/);
          if (m) {
            const op = m[1]; const threshold = Number(m[2]);
            const val = Number(row[field]);
            if (op === ">") return val > threshold;
            if (op === ">=") return val >= threshold;
            if (op === "<") return val < threshold;
            if (op === "<=") return val <= threshold;
          }
        }
      }
    }
    return true;
  }
  return true;
}

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
        const filtered = primaryRows.filter((r: any) => evalCond(r, cond as Record<string, unknown>));

        let expanded: Record<string, unknown>[] = filtered;
        for (const join of joins) {
          const newExpanded: Record<string, unknown>[] = [];
          for (const row of expanded) {
            const matches = join.table.filter((jr: any) => String(jr[join.joinCol]) === String(row[join.primaryCol]));
            if (matches.length === 0) {
              newExpanded.push({ ...row });
            } else {
              for (const match of matches) {
                newExpanded.push({ ...row, ...match });
              }
            }
          }
          expanded = newExpanded;
        }

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

function buildCtx(overrides: Record<string, unknown> = {}) {
  return {
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    db: mockDb,
    tenant: { id: 1, slug: "test", name: "Test Co", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    user: { id: 1, tenantId: 1, role: "operator" as const, status: "active" as const, name: "Test", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    ...overrides,
  };
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
    const caller = analyticsRouter.createCaller(buildCtx());
    const result = await caller.cogsSummary({});
    expect(result).toBeDefined();
    expect(Number(result.totalRevenue)).toBeGreaterThanOrEqual(0);
    expect(Number(result.totalCost)).toBeGreaterThanOrEqual(0);
    expect(Number(result.totalDiscount)).toBeGreaterThanOrEqual(0);
  });

  it("returns zeros when no completed orders", async () => {
    ordersTable = [];
    const { analyticsRouter } = await import("../analytics-router");
    const caller = analyticsRouter.createCaller(buildCtx());
    const result = await caller.cogsSummary({});
    expect(Number(result.totalRevenue)).toBe(0);
    expect(Number(result.totalCost)).toBe(0);
  });
});

describe("analytics.debtReport", () => {
  it("returns only shops with positive debt", async () => {
    const { analyticsRouter } = await import("../analytics-router");
    const caller = analyticsRouter.createCaller(buildCtx());
    const result = await caller.debtReport();
    expect(result.every((r: any) => Number(r.debt) > 0)).toBe(true);
  });

  it("only shows shops from current tenant", async () => {
    const { analyticsRouter } = await import("../analytics-router");
    const caller = analyticsRouter.createCaller(buildCtx());
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
    const caller = analyticsRouter.createCaller(buildCtx());
    const result = await caller.agentPerformance({});
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].agentName).toBeDefined();
    expect(result[0].orderCount).toBeDefined();
  });
});
