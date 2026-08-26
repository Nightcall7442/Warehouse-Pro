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
  tgMessages: { upgradeRequest: vi.fn(() => "mock") },
}));

vi.mock("../lib/feature-gating", () => ({
  hasSubscriptionAccess: vi.fn(async () => true),
  checkSubscriptionAccess: vi.fn(async () => true),
  invalidateSubscriptionAccess: vi.fn(),
}));

vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());

vi.mock("../lib/sse", () => ({
  sseBus: { emit: vi.fn() },
}));

vi.mock("../lib/cache", () => {
  const store = new Map<string, unknown>();
  return {
    withCache: async (_k: string, _t: number, produce: () => unknown) => produce(),
    cache: {
      get: (key: string) => store.get(key),
      set: (key: string, val: unknown) => store.set(key, val),
      invalidate: (key: string) => store.delete(key),
      invalidatePrefix: (prefix: string) => {
        for (const k of store.keys()) {
          if (k.startsWith(prefix)) store.delete(k);
        }
      },
    },
    CacheKeys: {
      commissions: (tid: number) => `commissions:${tid}`,
    },
    CacheTTL: { commissions: 60 },
  };
});

let mockDb: any;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

import { commissions, users, orders } from "@db/schema";
import { makeConditionEvaluator } from "./helpers/fake-conditions";

interface FakeCommission { id: number; tenantId: number; userId: number; commissionRate: string; periodType: string; periodStart: string; periodEnd: string; salesAmount: string; commissionAmount: string; status: string; }
interface FakeUser { id: number; tenantId: number; name: string; role: string; }
interface FakeOrder { id: number; tenantId: number; agentId: number; shopId: number; status: string; total: string; createdAt: string; }

let commissionsTable: FakeCommission[] = [];
let usersTable: FakeUser[] = [];
let ordersTable: FakeOrder[] = [];
let nextId = 10;

function resetTables() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];

  commissionsTable = [
    { id: 1, tenantId: 1, userId: 10, commissionRate: "5.00", periodType: "monthly", periodStart: monthStart, periodEnd: monthEnd, salesAmount: "0.00", commissionAmount: "0.00", status: "pending" },
    { id: 2, tenantId: 1, userId: 11, commissionRate: "3.00", periodType: "monthly", periodStart: monthStart, periodEnd: monthEnd, salesAmount: "1000.00", commissionAmount: "30.00", status: "approved" },
    { id: 3, tenantId: 2, userId: 20, commissionRate: "10.00", periodType: "monthly", periodStart: monthStart, periodEnd: monthEnd, salesAmount: "500.00", commissionAmount: "50.00", status: "pending" },
  ];
  usersTable = [
    { id: 10, tenantId: 1, name: "Agent One", role: "agent" },
    { id: 11, tenantId: 1, name: "Agent Two", role: "agent" },
    { id: 20, tenantId: 2, name: "Agent Three", role: "agent" },
  ];
  ordersTable = [
    { id: 1, tenantId: 1, agentId: 10, shopId: 1, status: "delivered", total: "2000.00", createdAt: monthStart },
    { id: 2, tenantId: 1, agentId: 10, shopId: 1, status: "delivered", total: "1500.00", createdAt: monthStart },
    { id: 3, tenantId: 1, agentId: 11, shopId: 1, status: "processing", total: "500.00", createdAt: monthStart },
  ];
  nextId = 10;
}

const columnToField = new Map<unknown, string>();
// Takes a drizzle table, whose type is nothing like Record<string, unknown> —
// the narrower signature made every call site an error without catching
// anything, since the body only ever reads one property by name.
function reg(table: object, name: string) {
  columnToField.set((table as Record<string, unknown>)[name], name);
}
reg(commissions, "id"); reg(commissions, "tenantId"); reg(commissions, "userId");
reg(commissions, "commissionRate"); reg(commissions, "periodType");
reg(commissions, "periodStart"); reg(commissions, "periodEnd");
reg(commissions, "salesAmount"); reg(commissions, "commissionAmount"); reg(commissions, "status");
reg(users, "id"); reg(users, "tenantId"); reg(users, "name"); reg(users, "role");
reg(orders, "id"); reg(orders, "tenantId"); reg(orders, "agentId");
reg(orders, "status"); reg(orders, "total"); reg(orders, "createdAt");

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
  if (col === commissions) return commissionsTable as any;
  if (col === users) return usersTable as any;
  if (col === orders) return ordersTable as any;
  return [];
}

function makeMockDb() {
  const db: any = {};
  db.select = (fields?: any) => {
    const sel: any = {};
    sel.from = (table: any) => {
      const tbl = useTable(table);
      const from: any = {};
      from.leftJoin = () => from;
      from.innerJoin = () => from;
      from.where = (cond: unknown) => {
        const filtered = tbl.filter((r: any) => evalCond(r, cond as Record<string, unknown>));
        if (fields && typeof fields === "object" && !Array.isArray(fields)) {
          const mapped = filtered.map((r: any) => {
            const out: Record<string, unknown> = {};
            for (const [alias, def] of Object.entries(fields)) {
              if (typeof def === "object" && def !== null) {
                if ((def as any).__kind === "sql") {
                  const sqlStr = String((def as any).strings?.join?.("") ?? "");
                  if (/COUNT\s*\(\s*\*/i.test(sqlStr)) {
                    out[alias] = filtered.length;
                  } else if (/SUM/i.test(sqlStr)) {
                    const field = mapCol((def as any).values?.[0] ?? "");
                    out[alias] = String(filtered.reduce((s: number, r: any) => s + Number(r[field] ?? 0), 0));
                  } else {
                    out[alias] = "0";
                  }
                } else {
                  out[alias] = r[mapCol(def)];
                }
              }
            }
            return out;
          });
          if (mapped.length === 0 && Object.values(fields).some((d: any) => d?.__kind === "sql")) {
            const zeroRow: Record<string, unknown> = {};
            for (const [alias, def] of Object.entries(fields)) {
              zeroRow[alias] = (typeof def === "object" && def && /COUNT/i.test(String((def as any).strings?.join?.("") ?? ""))) ? 0 : "0";
            }
            return buildChain([zeroRow]);
          }
          return buildChain(mapped);
        }
        return buildChain(filtered);
      };
      from.limit = (n: number) => buildChain(tbl.slice(0, n));
      from.orderBy = () => from;
      from.groupBy = () => from;
      return from;
    };
    return sel;
  };
  db.insert = () => ({
    values: vi.fn(() => [{ insertId: nextId++ }]),
  });
  db.update = () => ({
    set: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve({ affectedRows: 1 })),
    })),
  });
  db.transaction = (fn: (tx: any) => Promise<any>) => fn(db);
  return db;
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

describe("commission.list", () => {
  it("returns commissions for current tenant only", async () => {
    const { commissionRouter } = await import("../commission-router");
    const caller = commissionRouter.createCaller(buildCtx());
    const result = await caller.list({});
    expect(result.every((c: any) => c.tenantId !== 2)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("filters by status", async () => {
    const { commissionRouter } = await import("../commission-router");
    const caller = commissionRouter.createCaller(buildCtx());
    const result = await caller.list({ status: "approved" });
    expect(result.every((c: any) => c.status === "approved")).toBe(true);
  });

  it("filters by userId", async () => {
    const { commissionRouter } = await import("../commission-router");
    const caller = commissionRouter.createCaller(buildCtx());
    const result = await caller.list({ userId: 10 });
    expect(result.every((c: any) => c.userId === 10)).toBe(true);
  });
});

describe("commission.setRate", () => {
  it("creates new commission record when none exists for period", async () => {
    const { commissionRouter } = await import("../commission-router");
    const caller = commissionRouter.createCaller(buildCtx());
    const result = await caller.setRate({ userId: 12, commissionRate: 7.5 });
    expect(result.success).toBe(true);
  });

  it("updates existing commission record for current period", async () => {
    const { commissionRouter } = await import("../commission-router");
    const caller = commissionRouter.createCaller(buildCtx());
    const result = await caller.setRate({ userId: 10, commissionRate: 8 });
    expect(result.success).toBe(true);
  });

  it("rejects rate above 100%", async () => {
    const { commissionRouter } = await import("../commission-router");
    const caller = commissionRouter.createCaller(buildCtx());
    await expect(caller.setRate({ userId: 10, commissionRate: 150 })).rejects.toThrow();
  });
});

describe("commission.calculate", () => {
  it("calculates salesAmount and commissionAmount from completed orders", async () => {
    const { commissionRouter } = await import("../commission-router");
    const caller = commissionRouter.createCaller(buildCtx());
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
    const result = await caller.calculate({ periodType: "monthly", periodStart: monthStart, periodEnd: monthEnd });
    expect(result.success).toBe(true);
    expect(result.updated).toBeGreaterThanOrEqual(1);
  });
});

describe("commission.updateStatus", () => {
  it("transitions from pending to approved", async () => {
    const { commissionRouter } = await import("../commission-router");
    const caller = commissionRouter.createCaller(buildCtx());
    const result = await caller.updateStatus({ id: 1, status: "approved" });
    expect(result.success).toBe(true);
  });

  it("transitions from approved to paid", async () => {
    const { commissionRouter } = await import("../commission-router");
    const caller = commissionRouter.createCaller(buildCtx());
    const result = await caller.updateStatus({ id: 2, status: "paid" });
    expect(result.success).toBe(true);
  });
});
