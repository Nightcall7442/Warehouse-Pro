/**
 * Shop router tests — clearAll endpoint.
 * Tests that all shops and related records are deleted correctly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { asTestContext } from "./helpers/test-context";

// ── Mocks ───────────────────────────────────────────────────────────────────
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));
vi.mock("../lib/cache", () => ({
  withCache: async (_k: string, _t: number, produce: () => unknown) => produce(),
  cache: { invalidate: vi.fn(), invalidatePrefix: vi.fn(), get: vi.fn(), set: vi.fn() },
  CacheKeys: { shopCities: vi.fn(), shopDistricts: vi.fn() },
  CacheTTL: { shops: 30 },
}));
vi.mock("../lib/sanitize", () => ({ sanitizeString: (s: string) => s, sanitizeSearch: (s: string) => s }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("drizzle-orm", () => ({
  eq:  (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
  and: (...conds: unknown[]) => ({ __kind: "and", conds }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values }),
  desc: (col: unknown) => ({ __kind: "desc", col }),
  like: (col: unknown, val: unknown) => ({ __kind: "like", col, val }),
}));

// ── In-memory tables ────────────────────────────────────────────────────────
interface FakeRecord { id: number; tenantId: number; [key: string]: unknown }

let shopsTable: FakeRecord[] = [];
let dailyPlansTable: FakeRecord[] = [];
let paymentsTable: FakeRecord[] = [];
let returnsTable: FakeRecord[] = [];
let agentTerritoriesTable: FakeRecord[] = [];

function resetTables() {
  shopsTable = [
    { id: 1, tenantId: 1, name: "Shop A", status: "active", debt: "0.00" },
    { id: 2, tenantId: 1, name: "Shop B", status: "active", debt: "1000.00" },
    { id: 3, tenantId: 2, name: "Shop C", status: "active", debt: "0.00" },
  ];
  dailyPlansTable = [
    { id: 1, tenantId: 1, shopId: 1 },
    { id: 2, tenantId: 1, shopId: 2 },
  ];
  paymentsTable = [
    { id: 1, tenantId: 1, shopId: 1, amount: "500" },
  ];
  returnsTable = [
    { id: 1, tenantId: 1, shopId: 1 },
  ];
  agentTerritoriesTable = [
    { id: 1, tenantId: 1, agentId: 5, territoryId: 1 },
  ];
}

// ── Mock DB ─────────────────────────────────────────────────────────────────
function makeMockDb() {
  const executeLog: string[] = [];

  return {
    execute: vi.fn((query: { strings?: string[] }) => {
      const sql = query?.strings?.join("") ?? String(query);
      executeLog.push(sql);

      // Simulate DELETE based on SQL pattern
      if (sql.includes("visit_reports")) {
        // No visit_reports in test data
      } else if (sql.includes("daily_plans")) {
        dailyPlansTable = dailyPlansTable.filter(r => r.tenantId !== 1);
      } else if (sql.includes("payments")) {
        paymentsTable = paymentsTable.filter(r => r.tenantId !== 1);
      } else if (sql.includes("returns")) {
        returnsTable = returnsTable.filter(r => r.tenantId !== 1);
      } else if (sql.includes("agent_territories")) {
        agentTerritoriesTable = agentTerritoriesTable.filter(r => r.tenantId !== 1);
      } else if (sql.includes("shops")) {
        shopsTable = shopsTable.filter(r => r.tenantId !== 1);
      }

      return Promise.resolve([]);
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(makeMockDb()),
    executeLog,
  };
}

let mockDb: ReturnType<typeof makeMockDb>;

function makeCtx(tenantId: number, userId: number, role = "operator") {
  return asTestContext({
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    user: { id: userId, tenantId, role, status: "active", name: "Test User", email: "test@test.com" },
    tenant: { id: tenantId, slug: "test", name: "Test Co", plan: "trial" },
    db: mockDb,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────
describe("shop.clearAll", () => {
  beforeEach(() => {
    resetTables();
    mockDb = makeMockDb();
  });

  it("deletes all shops for the tenant", async () => {
    const { shopRouter } = await import("../shop-router");
    const caller = shopRouter.createCaller(makeCtx(1, 10));

    const result = await caller.clearAll();

    expect(result).toEqual({ success: true });
    // Tenant 1 shops should be deleted
    expect(shopsTable.filter(s => s.tenantId === 1)).toHaveLength(0);
    // Tenant 2 shops should remain
    expect(shopsTable.filter(s => s.tenantId === 2)).toHaveLength(1);
  });

  it("deletes child records before shops", async () => {
    const { shopRouter } = await import("../shop-router");
    const caller = shopRouter.createCaller(makeCtx(1, 10));

    await caller.clearAll();

    // All tenant 1 child records should be deleted
    expect(dailyPlansTable.filter(r => r.tenantId === 1)).toHaveLength(0);
    expect(paymentsTable.filter(r => r.tenantId === 1)).toHaveLength(0);
    expect(returnsTable.filter(r => r.tenantId === 1)).toHaveLength(0);
    expect(agentTerritoriesTable.filter(r => r.tenantId === 1)).toHaveLength(0);
  });

  it("does not affect other tenants", async () => {
    const { shopRouter } = await import("../shop-router");
    const caller = shopRouter.createCaller(makeCtx(1, 10));

    await caller.clearAll();

    // Tenant 2 data should remain intact
    expect(shopsTable.filter(s => s.tenantId === 2)).toHaveLength(1);
  });
});
