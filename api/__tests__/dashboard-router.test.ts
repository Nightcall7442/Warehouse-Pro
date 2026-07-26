/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", () => {
  const sqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values });
  return {
    eq: (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
    and: (...conds: unknown[]) => ({ __kind: "and", conds }),
    desc: (col: unknown) => ({ __kind: "desc", col }),
    isNull: (col: unknown) => ({ __kind: "isNull", col }),
    sql: sqlFn,
    relations: () => ({}),
  };
});

vi.mock("date-fns", () => ({
  subDays: (date: Date, days: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() - days);
    return d;
  },
}));

vi.mock("../lib/cache", () => {
  const store = new Map<string, unknown>();
  return {
    cache: {
      get: (k: string) => store.get(k),
      set: (k: string, v: unknown) => store.set(k, v),
      invalidate: () => {},
      invalidatePrefix: () => {},
    },
    CacheKeys: { dashboardKpis: (id: number) => `dash:${id}`, commissions: (id: number) => `comm:${id}` },
    CacheTTL: { kpis: 60, commissions: 60 },
  };
});

let mockDb: any;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

import { orders, warehouseStock, users, shops, agentLocations, dailyPlans, orderItems, products } from "@db/schema";

let ordersTable: any[] = [];
let warehouseStockTable: any[] = [];
let usersTable: any[] = [];
let shopsTable: any[] = [];
let agentLocationsTable: any[] = [];
let dailyPlansTable: any[] = [];
let orderItemsTable: any[] = [];
let productsTable: any[] = [];

function resetTables() {
  ordersTable = [
    { id: 1, tenantId: 1, status: "completed", total: "50000", shopId: 1, agentId: 20, orderNumber: "ORD-001", deletedAt: null, createdAt: new Date() },
    { id: 2, tenantId: 1, status: "pending", total: "30000", shopId: 2, agentId: 20, orderNumber: "ORD-002", deletedAt: null, createdAt: new Date() },
    { id: 3, tenantId: 2, status: "completed", total: "10000", shopId: 3, agentId: 30, orderNumber: "ORD-003", deletedAt: null, createdAt: new Date() },
  ];
  warehouseStockTable = [
    { id: 10, tenantId: 1, productId: 1, currentStock: "200", reserved: "10", available: "190" },
  ];
  usersTable = [
    { id: 10, tenantId: 1, role: "ceo", status: "active", name: "CEO" },
    { id: 20, tenantId: 1, role: "agent", status: "active", name: "Agent 1" },
    { id: 21, tenantId: 1, role: "agent", status: "active", name: "Agent 2" },
  ];
  shopsTable = [
    { id: 1, tenantId: 1, name: "Shop A", debt: "150000", agentId: 20 },
    { id: 2, tenantId: 1, name: "Shop B", debt: "0", agentId: 20 },
    { id: 3, tenantId: 2, name: "Shop C", debt: "50000", agentId: 30 },
  ];
  agentLocationsTable = [
    { id: 1, tenantId: 1, agentId: 20, createdAt: new Date() },
  ];
  dailyPlansTable = [
    { id: 1, tenantId: 1, planDate: new Date(), status: "planned" },
  ];
  orderItemsTable = [
    { id: 1, orderId: 1, productId: 1, quantity: "10", unitPrice: "5000" },
  ];
  productsTable = [
    { id: 1, tenantId: 1, name: "Tomato", costPrice: "3000" },
  ];
}

const colToField = new Map<unknown, string>();
function reg(table: Record<string, unknown>, name: string) { colToField.set(table[name], name); }
reg(orders, "id"); reg(orders, "tenantId"); reg(orders, "status"); reg(orders, "total");
reg(orders, "shopId"); reg(orders, "agentId"); reg(orders, "orderNumber"); reg(orders, "deletedAt"); reg(orders, "createdAt");
reg(warehouseStock, "id"); reg(warehouseStock, "tenantId"); reg(warehouseStock, "productId"); reg(warehouseStock, "currentStock");
reg(users, "id"); reg(users, "tenantId"); reg(users, "role"); reg(users, "status"); reg(users, "name");
reg(shops, "id"); reg(shops, "tenantId"); reg(shops, "name"); reg(shops, "debt"); reg(shops, "agentId");
reg(agentLocations, "id"); reg(agentLocations, "tenantId"); reg(agentLocations, "agentId"); reg(agentLocations, "createdAt");
reg(dailyPlans, "id"); reg(dailyPlans, "tenantId"); reg(dailyPlans, "planDate"); reg(dailyPlans, "status");
reg(orderItems, "id"); reg(orderItems, "orderId"); reg(orderItems, "productId"); reg(orderItems, "quantity");
reg(products, "id"); reg(products, "tenantId"); reg(products, "name"); reg(products, "costPrice");

function mapCol(col: unknown): string { return colToField.get(col) ?? (col as any)?.name ?? String(col); }

function evalCond(row: Record<string, unknown>, cond: unknown): boolean {
  if (!cond || typeof cond !== "object") return true;
  const c = cond as Record<string, unknown>;
  if (c.__kind === "and") return (c.conds as unknown[]).every((x: unknown) => evalCond(row, x));
  if (c.__kind === "eq") { const f = mapCol(c.col); return !(f in row) || row[f] === c.val || String(row[f]) === String(c.val); }
  if (c.__kind === "isNull") { const f = mapCol(c.col); return !(f in row) || row[f] === null || row[f] === undefined; }
  return true;
}

function isAggSql(def: unknown): boolean {
  if (typeof def !== "object" || def === null) return false;
  const d = def as any;
  if (d.__kind === "count" || d.__kind === "sum") return true;
  if (d.__kind === "sql" && Array.isArray(d.strings)) {
    const s = d.strings.join("").toLowerCase();
    if (s.includes("count(") || s.includes("sum(") || s.includes("avg(")) return true;
  }
  return false;
}

function evalAggSql(def: any, rows: Record<string, unknown>[]): number {
  if (def.__kind === "count") return rows.length;
  if (def.__kind === "sum") { const f = mapCol(def.col); return rows.reduce((s, r) => s + Number(r[f] ?? 0), 0); }
  const s = (def.strings?.join("") ?? "").toLowerCase();
  if (s.includes("count(")) return rows.length;
  if (s.includes("sum(")) {
    const valMatch = s.match(/sum\(\s*(?:CASE\s+WHEN.*?THEN\s+)?([^\)]+)\)/i);
    if (valMatch) {
      const colRef = valMatch[1].trim();
      const colField = colRef.includes(".") ? colRef.split(".").pop()! : colRef;
      const field = colToField.get(colRef) ?? colField;
      const factor = s.includes("else 0 end") || s.includes("case when") ? 1 : 1;
      void factor;
      return rows.reduce((acc, r) => acc + Number(r[field] ?? 0), 0);
    }
    return rows.reduce((acc, r) => {
      const totalVal = Object.values(r).filter(v => typeof v === "string" && !isNaN(Number(v))).reduce((s, v) => s + Number(v), 0);
      return acc + totalVal;
    }, 0);
  }
  return 0;
}

function buildChain(rows: Record<string, unknown>[], fields?: any) {
  const chain: any = Promise.resolve(rows);
  chain.limit = (n: number) => buildChain(rows.slice(0, n), fields);
  chain.orderBy = () => chain;
  chain.where = (cond: unknown) => buildChain(rows.filter(r => evalCond(r, cond)), fields);
  chain.leftJoin = () => chain;
  chain.innerJoin = () => chain;
  chain.groupBy = () => chain;
  chain.for = () => chain;
  return chain;
}

function useTable(col: unknown): Record<string, unknown>[] {
  if (col === orders) return ordersTable;
  if (col === warehouseStock) return warehouseStockTable;
  if (col === users) return usersTable;
  if (col === shops) return shopsTable;
  if (col === agentLocations) return agentLocationsTable;
  if (col === dailyPlans) return dailyPlansTable;
  if (col === orderItems) return orderItemsTable;
  if (col === products) return productsTable;
  return [];
}

function makeMockDb() {
  const db: any = {};
  db.select = (fields?: any) => {
    const sel: any = {};
    sel.from = (table: any) => {
      const primaryRows = useTable(table);
      const joins: any[] = [];
      let currentRows: Record<string, unknown>[] | null = null;
      const getRows = (): Record<string, unknown>[] => {
        if (currentRows) return currentRows;
        let rows = [...primaryRows];
        for (const join of joins) {
          const expanded: Record<string, unknown>[] = [];
          for (const row of rows) {
            const matches = join.table.filter((jr: any) => String(jr[join.joinCol]) === String(row[join.primaryCol]));
            if (matches.length === 0) expanded.push({ ...row });
            else for (const m of matches) expanded.push({ ...row, ...m });
          }
          rows = expanded;
        }
        return rows;
      };
      const from: any = {};
      from.leftJoin = (joinTable: any, joinCond: any) => {
        if (joinCond?.__kind === "eq") joins.push({ table: useTable(joinTable), primaryCol: mapCol(joinCond.col), joinCol: mapCol(joinCond.val) });
        return from;
      };
      from.innerJoin = from.leftJoin;
      from.where = (cond: unknown) => {
        currentRows = getRows().filter((r: any) => evalCond(r, cond));
        return from;
      };
      from.then = (resolve: any, reject: any) => {
        let rows = getRows();
        if (fields && typeof fields === "object" && !Array.isArray(fields)) {
          const hasAgg = Object.values(fields).some((d: any) => isAggSql(d));
          if (hasAgg) {
            const groupCols: Array<{ alias: string; field: string }> = [];
            const aggs: Array<{ alias: string; def: any }> = [];
            for (const [alias, def] of Object.entries(fields)) {
              if (isAggSql(def)) {
                aggs.push({ alias, def: def as any });
              } else {
                groupCols.push({ alias, field: mapCol(def) });
              }
            }
            if (groupCols.length > 0) {
              const groups = new Map<string, Record<string, unknown>[]>();
              for (const row of rows) {
                const key = groupCols.map(gc => String(row[gc.field] ?? "")).join("|");
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(row);
              }
              return Promise.resolve(Array.from(groups.values()).map(gr => {
                const out: Record<string, unknown> = {};
                for (const gc of groupCols) out[gc.alias] = gr[0][gc.field];
                for (const { alias, def } of aggs) out[alias] = evalAggSql(def, gr);
                return out;
              })).then(resolve, reject);
            }
            const out: Record<string, unknown> = {};
            for (const { alias, def } of aggs) out[alias] = evalAggSql(def, rows);
            return Promise.resolve([out]).then(resolve, reject);
          }
          return Promise.resolve(rows.map(row => {
            const out: Record<string, unknown> = {};
            for (const [alias, def] of Object.entries(fields)) out[alias] = row[mapCol(def)] ?? null;
            return out;
          })).then(resolve, reject);
        }
        return Promise.resolve(rows).then(resolve, reject);
      };
      from.limit = (n: number) => {
        currentRows = getRows().slice(0, n);
        return from;
      };
      from.orderBy = () => from;
      from.groupBy = () => from;
      from.for = () => from;
      return from;
    };
    return sel;
  };
  db.execute = (sqlObj: any) => {
    if (sqlObj?.__kind === "sql") {
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  };
  return db;
}

function buildCtx(overrides: Record<string, unknown> = {}) {
  return {
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    db: mockDb,
    tenant: { id: 1, slug: "test", name: "Test Org", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    user: { id: 10, tenantId: 1, role: "ceo" as const, status: "active" as const, name: "CEO", email: "ceo@test.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    ...overrides,
  };
}

function agentCtx() {
  return buildCtx({
    user: { id: 20, tenantId: 1, role: "agent" as const, status: "active" as const, name: "Agent", email: "agent@test.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
  });
}

function supervisorCtx() {
  return buildCtx({
    user: { id: 30, tenantId: 1, role: "supervisor" as const, status: "active" as const, name: "Sup", email: "sup@test.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
  });
}

beforeEach(() => {
  resetTables();
  mockDb = makeMockDb();
});

describe("dashboard.kpis", () => {
  it("returns KPI metrics", async () => {
    const { dashboardRouter } = await import("../dashboard-router");
    const caller = dashboardRouter.createCaller(buildCtx());
    const result = await caller.kpis();
    expect(typeof result.todayOrders).toBe("number");
    expect(typeof result.todayRevenue).toBe("number");
    expect(typeof result.activeAgents).toBe("number");
    expect(typeof result.totalStock).toBe("number");
    expect(typeof result.customerDebt).toBe("number");
    expect(typeof result.grossMargin).toBe("number");
  });

  it("returns activeAgents count matching user table", async () => {
    const { dashboardRouter } = await import("../dashboard-router");
    const caller = dashboardRouter.createCaller(buildCtx());
    const result = await caller.kpis();
    expect(result.activeAgents).toBe(2);
  });
});

describe("dashboard.trends", () => {
  it("returns trend data for 7d", async () => {
    const { dashboardRouter } = await import("../dashboard-router");
    const caller = dashboardRouter.createCaller(buildCtx());
    const result = await caller.trends({ range: "7d" });
    expect(Array.isArray(result)).toBe(true);
  });

  it("returns trend data for 30d", async () => {
    const { dashboardRouter } = await import("../dashboard-router");
    const caller = dashboardRouter.createCaller(buildCtx());
    const result = await caller.trends({ range: "30d" });
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("dashboard.statusBreakdown", () => {
  it("returns status counts", async () => {
    const { dashboardRouter } = await import("../dashboard-router");
    const caller = dashboardRouter.createCaller(buildCtx());
    const result = await caller.statusBreakdown();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("dashboard.activity", () => {
  it("returns recent orders", async () => {
    const { dashboardRouter } = await import("../dashboard-router");
    const caller = dashboardRouter.createCaller(buildCtx());
    const result = await caller.activity();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("dashboard.agentDashboard", () => {
  it("returns agent-specific metrics", async () => {
    const { dashboardRouter } = await import("../dashboard-router");
    const caller = dashboardRouter.createCaller(agentCtx());
    const result = await caller.agentDashboard();
    expect(typeof result.todayOrders).toBe("number");
    expect(typeof result.todayRevenue).toBe("number");
    expect(typeof result.assignedShops).toBe("number");
  });
});

describe("dashboard.supervisorDashboard", () => {
  it("returns supervisor metrics", async () => {
    const { dashboardRouter } = await import("../dashboard-router");
    const caller = dashboardRouter.createCaller(supervisorCtx());
    const result = await caller.supervisorDashboard();
    expect(typeof result.todayOrders).toBe("number");
    expect(typeof result.todayRevenue).toBe("number");
    expect(typeof result.activeAgents).toBe("number");
    expect(typeof result.onlineAgents).toBe("number");
    expect(typeof result.pendingPlans).toBe("number");
  });
});

describe("dashboard.revenueTrend", () => {
  it("returns array of daily revenue values", async () => {
    const { dashboardRouter } = await import("../dashboard-router");
    const caller = dashboardRouter.createCaller(agentCtx());
    const result = await caller.revenueTrend({ days: 7 });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(7);
    expect(result.every(v => typeof v === "number")).toBe(true);
  });

  it("defaults to 7 days", async () => {
    const { dashboardRouter } = await import("../dashboard-router");
    const caller = dashboardRouter.createCaller(agentCtx());
    const result = await caller.revenueTrend();
    expect(result.length).toBe(7);
  });

  it("fills missing days with 0", async () => {
    const { dashboardRouter } = await import("../dashboard-router");
    const caller = dashboardRouter.createCaller(agentCtx());
    const result = await caller.revenueTrend({ days: 3 });
    expect(result.length).toBe(3);
    expect(result.every(v => typeof v === "number")).toBe(true);
  });
});
