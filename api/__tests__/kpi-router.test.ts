/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq:  (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
  and: (...conds: unknown[]) => ({ __kind: "and", conds }),
  desc: (col: unknown) => ({ __kind: "desc", col }),
  gte: (col: unknown, val: unknown) => ({ __kind: "gte", col, val }),
  lte: (col: unknown, val: unknown) => ({ __kind: "lte", col, val }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values }),
  isNull: (col: unknown) => ({ __kind: "isNull", col }),
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

vi.mock("../services/anti-fraud", () => ({
  calculateFraudMetrics: vi.fn(async () => ({
    suspiciousVisits: 0,
    fraudRate: 0,
    avgVisitDuration: 0,
  })),
}));

import { orders, dailyPlans, returns, shops, salesTargets, commissions, agentLocations, visitReports, users } from "@db/schema";

// ── Fake tables ──────────────────────────────────────────────────────────────
interface FakeOrder { id: number; tenantId: number; agentId: number; courierId: number | null; shopId: number; status: string; deliveryStatus: string; total: string; createdAt: Date; }
interface FakePlan { id: number; tenantId: number; agentId: number; shopId: number; status: string; planDate: Date; }
interface FakeReturn { id: number; tenantId: number; agentId: number; createdAt: Date; }
interface FakeShop { id: number; tenantId: number; agentId: number | null; debt: string; status: string; }
interface FakeTarget { id: number; tenantId: number; userId: number; targetAmount: string; }
interface FakeCommission { id: number; tenantId: number; userId: number; commissionRate: string; }
interface FakeLocation { id: number; tenantId: number; agentId: number; lat: string; lng: string; createdAt: Date; }
interface FakeReport { id: number; tenantId: number; userId: number; createdAt: Date; }
interface FakeUser { id: number; tenantId: number; name: string; role: string; status: string; }

let ordersTable: FakeOrder[] = [];
let plansTable: FakePlan[] = [];
let returnsTable: FakeReturn[] = [];
let shopsTable: FakeShop[] = [];
let targetsTable: FakeTarget[] = [];
let commissionsTable: FakeCommission[] = [];
let locationsTable: FakeLocation[] = [];
let reportsTable: FakeReport[] = [];
let usersTable: FakeUser[] = [];

function resetTables() {
  ordersTable = [
    { id: 1, tenantId: 1, agentId: 10, courierId: null, shopId: 1, status: "completed", deliveryStatus: "none", total: "500.00", createdAt: new Date() },
    { id: 2, tenantId: 1, agentId: 10, courierId: null, shopId: 1, status: "completed", deliveryStatus: "none", total: "300.00", createdAt: new Date() },
  ];
  plansTable = [
    { id: 1, tenantId: 1, agentId: 10, shopId: 1, status: "visited", planDate: new Date() },
    { id: 2, tenantId: 1, agentId: 10, shopId: 2, status: "skipped", planDate: new Date() },
    { id: 3, tenantId: 1, agentId: 10, shopId: 1, status: "planned", planDate: new Date() },
  ];
  returnsTable = [];
  shopsTable = [
    { id: 1, tenantId: 1, agentId: 10, debt: "100.00", status: "active" },
    { id: 2, tenantId: 1, agentId: 10, debt: "0.00", status: "active" },
  ];
  targetsTable = [
    { id: 1, tenantId: 1, userId: 10, targetAmount: "10000.00" },
  ];
  commissionsTable = [
    { id: 1, tenantId: 1, userId: 10, commissionRate: "5" },
  ];
  locationsTable = [];
  reportsTable = [];
  usersTable = [
    { id: 10, tenantId: 1, name: "Agent One", role: "agent", status: "active" },
    { id: 11, tenantId: 1, name: "Agent Two", role: "agent", status: "active" },
  ];
}

function tableOf(ref: unknown): string {
  if (ref === orders) return "orders";
  if (ref === dailyPlans) return "dailyPlans";
  if (ref === returns) return "returns";
  if (ref === shops) return "shops";
  if (ref === salesTargets) return "salesTargets";
  if (ref === commissions) return "commissions";
  if (ref === agentLocations) return "agentLocations";
  if (ref === visitReports) return "visitReports";
  if (ref === users) return "users";
  return "other";
}

function rowsFor(table: string): Record<string, unknown>[] {
  if (table === "orders") return ordersTable as unknown as Record<string, unknown>[];
  if (table === "dailyPlans") return plansTable as unknown as Record<string, unknown>[];
  if (table === "returns") return returnsTable as unknown as Record<string, unknown>[];
  if (table === "shops") return shopsTable as unknown as Record<string, unknown>[];
  if (table === "salesTargets") return targetsTable as unknown as Record<string, unknown>[];
  if (table === "commissions") return commissionsTable as unknown as Record<string, unknown>[];
  if (table === "agentLocations") return locationsTable as unknown as Record<string, unknown>[];
  if (table === "visitReports") return reportsTable as unknown as Record<string, unknown>[];
  if (table === "users") return usersTable as unknown as Record<string, unknown>[];
  return [];
}

const columnToFieldName = new Map<unknown, string>();
for (const t of [orders, dailyPlans, returns, shops, salesTargets, commissions, agentLocations, visitReports, users]) {
  for (const [field, col] of Object.entries(t)) columnToFieldName.set(col, field);
}

function evalCond(row: Record<string, unknown>, cond: Record<string, unknown>): boolean {
  if (!cond || typeof cond !== "object") return true;
  if (cond.__kind === "and") return (cond.conds as unknown[]).every((inner: unknown) => evalCond(row, inner as Record<string, unknown>));
  if (cond.__kind === "eq" || cond.__kind === "gte" || cond.__kind === "lte") {
    const fieldName = columnToFieldName.get(cond.col) ?? (cond.col as Record<string, unknown>)?.name ?? cond.col;
    if (!(fieldName as string in row)) return true;
    const rowVal = row[fieldName as string];
    const condVal = cond.val;
    // For gte/lte with Date objects, convert both to timestamps
    if (cond.__kind === "gte") {
      const rv = rowVal instanceof Date ? rowVal.getTime() : Number(rowVal);
      const cv = condVal instanceof Date ? condVal.getTime() : Number(condVal);
      if (!isNaN(rv) && !isNaN(cv)) return rv >= cv;
      return rowVal === condVal || String(rowVal) === String(condVal);
    }
    if (cond.__kind === "lte") {
      const rv = rowVal instanceof Date ? rowVal.getTime() : Number(rowVal);
      const cv = condVal instanceof Date ? condVal.getTime() : Number(condVal);
      if (!isNaN(rv) && !isNaN(cv)) return rv <= cv;
      return rowVal === condVal || String(rowVal) === String(condVal);
    }
    return rowVal === condVal || String(rowVal) === String(condVal);
  }
  return true;
}

function chainable(rows: Record<string, unknown>[]) {
  const p = Promise.resolve(rows) as Promise<Record<string, unknown>[]> & {
    limit?: (n: number) => ReturnType<typeof chainable>;
    orderBy?: (..._a: unknown[]) => ReturnType<typeof chainable>;
    groupBy?: (..._a: unknown[]) => ReturnType<typeof chainable>;
  };
  p.limit = (n: number) => chainable(rows.slice(0, n));
  p.orderBy = () => chainable(rows);
  p.groupBy = () => chainable(rows);
  return p;
}

function makeMockDb() {
  const db: any = {
    select: (proj?: unknown) => {
      let currentTable = "other";
      let latestFiltered: Record<string, unknown>[] = [];

      const isAggregate = proj && typeof proj === "object" && Object.values(proj as Record<string, unknown>).some(
        (v) => v && typeof v === "object" && "__kind" in (v as Record<string, unknown>) && (v as Record<string, unknown>).__kind === "sql"
      );

      const api: Record<string, any> = {
        from(ref: unknown) { currentTable = tableOf(ref); return api; },
        innerJoin() { return api; },
        where(cond: unknown) {
          latestFiltered = rowsFor(currentTable).filter((r) => evalCond(r, cond as Record<string, unknown>));
          if (isAggregate) {
            // For aggregate queries, return a single row with computed values
            const row: Record<string, unknown> = {};
            for (const [key, val] of Object.entries(proj as Record<string, unknown>)) {
              const sqlObj = val as Record<string, unknown>;
              if (sqlObj && sqlObj.__kind === "sql" && Array.isArray(sqlObj.strings)) {
                const rawSql = sqlObj.strings.join("?");
                if (/count\(\*/.test(rawSql)) {
                  row[key] = latestFiltered.length;
                } else if (/COALESCE\(SUM/.test(rawSql)) {
                  // For SUM queries, try to sum a numeric field from the rows
                  const values = sqlObj.values ?? [];
                  // Try to find the column being summed
                  const sumMatch = rawSql.match(/SUM\(.*?(\w+)\)/i);
                  if (sumMatch) {
                    const colName = sumMatch[1].replace(/_/g, "");
                    const total = latestFiltered.reduce((sum, r) => {
                      // Try matching by camelCase field name
                      for (const rk of Object.keys(r)) {
                        if (rk.replace(/_/g, "").toLowerCase() === colName.toLowerCase() || rk.toLowerCase() === colName.toLowerCase()) {
                          return sum + Number(r[rk] ?? 0);
                        }
                      }
                      return sum;
                    }, 0);
                    row[key] = String(total);
                  } else {
                    row[key] = "0";
                  }
                } else {
                  row[key] = latestFiltered.length;
                }
              }
            }
            return chainable([row]);
          }
          return chainable(latestFiltered);
        },
        limit(n: number) { return chainable(rowsFor(currentTable).slice(0, n)); },
        orderBy() { return chainable(rowsFor(currentTable)); },
        groupBy() { return chainable(rowsFor(currentTable)); },
      };
      return api;
    },
    insert: (ref: unknown) => ({
      values: (vals: Record<string, unknown>) => Promise.resolve([{ insertId: 1 }]),
    }),
    update: (ref: unknown) => ({
      set(patch: Record<string, unknown>) {
        return {
          where(cond: unknown) {
            for (const row of rowsFor(tableOf(ref))) {
              if (!evalCond(row as Record<string, unknown>, cond as Record<string, unknown>)) continue;
              for (const [key, val] of Object.entries(patch)) {
                if (val !== undefined) row[key] = val;
              }
            }
            return Promise.resolve();
          },
        };
      },
    }),
    transaction: async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn(db),
    execute: (query: { values?: unknown[]; strings?: string[] }) => Promise.resolve(),
  };
  return db;
}

let mockDb: ReturnType<typeof makeMockDb>;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

function makeCtx(tenantId: number, userId: number, role = "operator"): any {
  return {
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    user: { id: userId, tenantId, role, status: "active" as const, name: "Test", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test", name: "Test Co", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    db: mockDb,
  };
}

beforeEach(() => {
  resetTables();
  mockDb = makeMockDb();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("kpi.agentKpi", () => {
  it("returns KPI data with visit completion rate", async () => {
    const { kpiRouter } = await import("../kpi-router");
    const caller = kpiRouter.createCaller(makeCtx(1, 10, "agent"));
    const result = await caller.agentKpi({ period: "month" }) as any;
    expect(result.agentId).toBe(10);
    expect(result.totalPlans).toBeGreaterThanOrEqual(0);
    expect(result.visitedPlans).toBeGreaterThanOrEqual(0);
    expect(result.visitCompletionRate).toBeGreaterThanOrEqual(0);
  });

  it("returns order metrics", async () => {
    const { kpiRouter } = await import("../kpi-router");
    const caller = kpiRouter.createCaller(makeCtx(1, 10, "agent"));
    const result = await caller.agentKpi({ period: "month" }) as any;
    expect(typeof result.orderCount).toBe("number");
    expect(typeof result.revenue).toBe("number");
  });

  it("calculates average order value", async () => {
    const { kpiRouter } = await import("../kpi-router");
    const caller = kpiRouter.createCaller(makeCtx(1, 10, "agent"));
    const result = await caller.agentKpi({ period: "month" }) as any;
    expect(typeof result.avgOrderValue).toBe("number");
  });

  it("defaults to month period when not specified", async () => {
    const { kpiRouter } = await import("../kpi-router");
    const caller = kpiRouter.createCaller(makeCtx(1, 10, "agent"));
    const result = await caller.agentKpi() as any;
    expect(result.period).toBeDefined();
  });

  it("returns fraud metrics", async () => {
    const { kpiRouter } = await import("../kpi-router");
    const caller = kpiRouter.createCaller(makeCtx(1, 10, "agent"));
    const result = await caller.agentKpi({ period: "month" }) as any;
    expect(result.suspiciousVisits).toBe(0);
    expect(result.fraudRate).toBe(0);
  });
});

describe("kpi.supervisorKpi", () => {
  it("returns KPI data for all agents", async () => {
    const { kpiRouter } = await import("../kpi-router");
    const caller = kpiRouter.createCaller(makeCtx(1, 1, "supervisor"));
    const result = await caller.supervisorKpi({ period: "month" }) as any;
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("only includes active agents", async () => {
    usersTable.push({ id: 99, tenantId: 1, name: "Inactive", role: "agent", status: "inactive" });
    const { kpiRouter } = await import("../kpi-router");
    const caller = kpiRouter.createCaller(makeCtx(1, 1, "supervisor"));
    const result = await caller.supervisorKpi({ period: "month" }) as any;
    expect(result.every((k: any) => k.agentId !== 99)).toBe(true);
  });
});

describe("kpi.salary", () => {
  it("calculates salary with commission", async () => {
    const { kpiRouter } = await import("../kpi-router");
    const caller = kpiRouter.createCaller(makeCtx(1, 10, "agent"));
    const result = await caller.salary({ period: "month" }) as any;
    expect(result.agentId).toBe(10);
    expect(typeof result.commissionRate).toBe("number");
    expect(typeof result.salesAmount).toBe("number");
    expect(typeof result.commissionAmount).toBe("number");
  });

  it("returns breakdown components", async () => {
    const { kpiRouter } = await import("../kpi-router");
    const caller = kpiRouter.createCaller(makeCtx(1, 10, "agent"));
    const result = await caller.salary({ period: "month" }) as any;
    expect(result.breakdown).toBeDefined();
    expect(result.breakdown.base).toBeDefined();
    expect(result.breakdown.commission).toBeDefined();
    expect(result.breakdown.bonus).toBeDefined();
  });
});

describe("kpi.salaryReport", () => {
  it("returns salary data for all agents", async () => {
    const { kpiRouter } = await import("../kpi-router");
    const caller = kpiRouter.createCaller(makeCtx(1, 1, "supervisor"));
    const result = await caller.salaryReport({ period: "month" }) as any;
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("each salary has agentName", async () => {
    const { kpiRouter } = await import("../kpi-router");
    const caller = kpiRouter.createCaller(makeCtx(1, 1, "supervisor"));
    const result = await caller.salaryReport({ period: "month" }) as any;
    for (const s of result) {
      expect(s.agentName).toBeDefined();
    }
  });
});
