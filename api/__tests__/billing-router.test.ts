/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
  and: (...conds: unknown[]) => ({ __kind: "and", conds }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values }),
  gte: (col: unknown, val: unknown) => ({ __kind: "gte", col, val }),
}));

vi.mock("../telegram-router", () => ({
  notifyAdmin: vi.fn(async () => {}),
  tgMessages: { upgradeRequest: vi.fn(() => "mock upgrade message") },
}));

vi.mock("../lib/feature-gating", () => ({
  checkSubscriptionAccess: vi.fn(async () => true),
}));

vi.mock("../lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("../lib/env", () => ({
  env: { isProduction: false },
}));

import { tenants, users, products, orders } from "@db/schema";

interface FakeTenant {
  id: number;
  slug: string;
  name: string;
  plan: string;
  status: string;
  trialEndsAt: Date | null;
  planExpiresAt: Date | null;
  maxUsers: number | null;
  maxProducts: number | null;
  maxOrdersMonth: number | null;
  ownerEmail: string | null;
  ownerPhone: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeUser {
  id: number;
  tenantId: number;
  name: string;
  email: string;
  passwordHash: string;
  role: string;
  status: string;
}

interface FakeProduct {
  id: number;
  tenantId: number;
  name: string;
}

interface FakeOrder {
  id: number;
  tenantId: number;
  createdAt: Date;
}

let tenantsTable: FakeTenant[] = [];
let usersTable: FakeUser[] = [];
let productsTable: FakeProduct[] = [];
let ordersTable: FakeOrder[] = [];

function resetTables() {
  tenantsTable = [
    {
      id: 1,
      slug: "test-co",
      name: "Test Co",
      plan: "basic",
      status: "active",
      trialEndsAt: new Date(Date.now() + 7 * 86_400_000),
      planExpiresAt: null,
      maxUsers: 5,
      maxProducts: 50,
      maxOrdersMonth: null,
      ownerEmail: "owner@test.com",
      ownerPhone: "+998901234567",
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-01"),
    },
  ];
  usersTable = [
    { id: 10, tenantId: 1, name: "Admin", email: "admin@test.com", passwordHash: "x", role: "ceo", status: "active" },
  ];
  productsTable = [
    { id: 1, tenantId: 1, name: "Product A" },
  ];
  ordersTable = [
    { id: 1, tenantId: 1, createdAt: new Date() },
  ];
}

function tableOf(ref: unknown): string {
  if (ref === tenants) return "tenants";
  if (ref === users) return "users";
  if (ref === products) return "products";
  if (ref === orders) return "orders";
  return "other";
}

function rowsFor(table: string): unknown[] {
  if (table === "tenants") return tenantsTable;
  if (table === "users") return usersTable;
  if (table === "products") return productsTable;
  if (table === "orders") return ordersTable;
  return [];
}

const columnToFieldName = new Map<unknown, string>();
for (const [_field, col] of Object.entries(tenants)) columnToFieldName.set(col, _field);
for (const [_field, col] of Object.entries(users)) columnToFieldName.set(col, _field);
for (const [_field, col] of Object.entries(products)) columnToFieldName.set(col, _field);
for (const [_field, col] of Object.entries(orders)) columnToFieldName.set(col, _field);

function evalCond(row: unknown, cond: unknown): boolean {
  if (!cond || typeof cond !== "object") return true;
  const c = cond as Record<string, unknown>;
  if (c.__kind === "and") return (c.conds as unknown[]).every((inner: unknown) => evalCond(row, inner));
  if (c.__kind === "eq") {
    const fieldName = columnToFieldName.get(c.col) ?? (c.col as Record<string, unknown>)?.name ?? c.col;
    if (c.val && typeof c.val === "object" && columnToFieldName.has(c.val)) {
      const otherField = columnToFieldName.get(c.val)!;
      return String((row as Record<string, unknown>)[fieldName as string]) === String((row as Record<string, unknown>)[otherField as string]);
    }
    return String((row as Record<string, unknown>)[fieldName as string]) === String(c.val);
  }
  if (c.__kind === "gte") {
    const fieldName = columnToFieldName.get(c.col) ?? (c.col as Record<string, unknown>)?.name ?? c.col;
    const rowVal = (row as Record<string, unknown>)[fieldName as string];
    const condVal = c.val;
    if (rowVal instanceof Date && condVal instanceof Date) return rowVal >= condVal;
    return new Date(rowVal as string | number).getTime() >= new Date(condVal as string | number).getTime();
  }
  return true;
}

function makeMockDb() {
  function selectBuilder(proj?: unknown) {
    let currentTable = "other";
    const isCount = proj && typeof proj === "object" && !Array.isArray(proj) &&
      ((proj as Record<string, unknown>).c && ((proj as Record<string, unknown>).c as Record<string, unknown>).__kind === "sql");

    function applyProject(rows: unknown[]) {
      if (!proj || typeof proj !== "object" || Array.isArray(proj) || isCount) return rows;
      return rows.map(row => {
        const out: Record<string, unknown> = {};
        for (const [alias, colRef] of Object.entries(proj as Record<string, unknown>)) {
          if (colRef && typeof colRef === "object" && (colRef as Record<string, unknown>).__kind === "sql") {
            out[alias] = 0;
            continue;
          }
          const fieldName = columnToFieldName.get(colRef) ?? (colRef as Record<string, unknown>)?.name ?? alias;
          out[alias] = (row as Record<string, unknown>)[fieldName as string];
        }
        return out;
      });
    }

    const api: Record<string, unknown> = {
      from(ref: unknown) { currentTable = tableOf(ref); return api; },
      where(cond: unknown) {
        const filtered = rowsFor(currentTable).filter((r) => evalCond(r, cond));
        if (isCount) return Promise.resolve([{ c: filtered.length }]);
        return wrapResult(applyProject(filtered));
      },
      limit(n: number) {
        const rows = rowsFor(currentTable).slice(0, n);
        return wrapResult(applyProject(rows));
      },
    };

    function wrapResult(filtered: unknown[]) {
      const result = Promise.resolve(filtered);
      (result as unknown as { limit: (n: number) => Promise<unknown[]> }).limit = (n: number) => Promise.resolve(filtered.slice(0, n));
      return result;
    }

    return api;
  }

  const db: Record<string, unknown> = {
    select: (proj?: unknown) => selectBuilder(proj),
    update: (ref: unknown) => ({
      set(_patch: Record<string, unknown>) {
        return {
          where(cond: unknown) {
            for (const row of rowsFor(tableOf(ref))) {
              if (!evalCond(row, cond)) continue;
              for (const [key, val] of Object.entries(_patch)) {
                (row as Record<string, unknown>)[key] = val;
              }
            }
            return Promise.resolve();
          },
        };
      },
    }),
  };
  return db;
}

let mockDb: ReturnType<typeof makeMockDb>;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

function makeCtx(tenantId: number, userId: number, role = "operator"): any {
  return {
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    user: { id: userId, tenantId, role, status: "active" as const, name: "Test User", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test-co", name: "Test Co", plan: "basic" as const, status: "active" as const, ownerPhone: "+998901234567", ownerEmail: "owner@test.com", createdAt: new Date(), updatedAt: new Date() },
    db: null as unknown,
  };
}

beforeEach(() => {
  resetTables();
  mockDb = makeMockDb();
});

describe("billing.status", () => {
  it("returns correct plan info for a basic tenant", async () => {
    const { billingRouter } = await import("../billing-router");
    const caller = billingRouter.createCaller(makeCtx(1, 10));
    const result = await caller.status();

    expect(result.plan).toBe("basic");
    expect(result.planName).toBe("Basic");
    expect(result.planNameUz).toBe("Basic");
    expect(result.price).toBe(299000);
  });

  it("returns trialActive: true when trialEndsAt is in the future", async () => {
    tenantsTable[0].trialEndsAt = new Date(Date.now() + 7 * 86_400_000);
    tenantsTable[0].planExpiresAt = null;

    const { billingRouter } = await import("../billing-router");
    const caller = billingRouter.createCaller(makeCtx(1, 10));
    const result = await caller.status();

    expect(result.trialActive).toBe(true);
    expect(result.planActive).toBeFalsy();
  });

  it("returns planActive: true when planExpiresAt is in the future", async () => {
    tenantsTable[0].plan = "basic";
    tenantsTable[0].trialEndsAt = null;
    tenantsTable[0].planExpiresAt = new Date(Date.now() + 30 * 86_400_000);

    const { billingRouter } = await import("../billing-router");
    const caller = billingRouter.createCaller(makeCtx(1, 10));
    const result = await caller.status();

    expect(result.planActive).toBe(true);
    expect(result.trialActive).toBeFalsy();
  });

  it("returns isExpired: true when both dates are past and plan is not basic", async () => {
    tenantsTable[0].plan = "pro";
    tenantsTable[0].trialEndsAt = new Date("2020-01-01");
    tenantsTable[0].planExpiresAt = new Date("2020-01-01");

    const { billingRouter } = await import("../billing-router");
    const caller = billingRouter.createCaller(makeCtx(1, 10));
    const result = await caller.status();

    expect(result.isExpired).toBe(true);
    expect(result.trialActive).toBeFalsy();
    expect(result.planActive).toBeFalsy();
  });

  it("returns isExpired: true when plan is basic and both dates are past", async () => {
    tenantsTable[0].plan = "basic";
    tenantsTable[0].trialEndsAt = new Date("2020-01-01");
    tenantsTable[0].planExpiresAt = new Date("2020-01-01");

    const { billingRouter } = await import("../billing-router");
    const caller = billingRouter.createCaller(makeCtx(1, 10));
    const result = await caller.status();

    expect(result.isExpired).toBe(true);
  });

  it("calculates correct daysLeft for trial", async () => {
    tenantsTable[0].trialEndsAt = new Date(Date.now() + 5 * 86_400_000);
    tenantsTable[0].planExpiresAt = null;

    const { billingRouter } = await import("../billing-router");
    const caller = billingRouter.createCaller(makeCtx(1, 10));
    const result = await caller.status();

    expect(result.daysLeft).toBe(5);
  });

  it("calculates correct daysLeft for active paid plan", async () => {
    tenantsTable[0].plan = "basic";
    tenantsTable[0].trialEndsAt = null;
    tenantsTable[0].planExpiresAt = new Date(Date.now() + 20 * 86_400_000);

    const { billingRouter } = await import("../billing-router");
    const caller = billingRouter.createCaller(makeCtx(1, 10));
    const result = await caller.status();

    expect(result.daysLeft).toBe(20);
  });

  it("returns daysLeft: 0 when expired", async () => {
    tenantsTable[0].plan = "basic";
    tenantsTable[0].trialEndsAt = new Date("2020-01-01");
    tenantsTable[0].planExpiresAt = new Date("2020-01-01");

    const { billingRouter } = await import("../billing-router");
    const caller = billingRouter.createCaller(makeCtx(1, 10));
    const result = await caller.status();

    expect(result.daysLeft).toBe(0);
  });

  it("throws NOT_FOUND when tenant does not exist", async () => {
    tenantsTable = [];

    const { billingRouter } = await import("../billing-router");
    const caller = billingRouter.createCaller(makeCtx(999, 10));

    await expect(caller.status()).rejects.toThrow();
  });

  it("returns correct usage counts", async () => {
    usersTable = [
      { id: 10, tenantId: 1, name: "U1", email: "u1@t.com", passwordHash: "x", role: "operator", status: "active" },
      { id: 11, tenantId: 1, name: "U2", email: "u2@t.com", passwordHash: "x", role: "agent", status: "active" },
    ];
    productsTable = [
      { id: 1, tenantId: 1, name: "P1" },
      { id: 2, tenantId: 1, name: "P2" },
      { id: 3, tenantId: 1, name: "P3" },
    ];
    ordersTable = [
      { id: 1, tenantId: 1, createdAt: new Date() },
      { id: 2, tenantId: 1, createdAt: new Date() },
    ];

    const { billingRouter } = await import("../billing-router");
    const caller = billingRouter.createCaller(makeCtx(1, 10));
    const result = await caller.status();

    expect(result.usage.users).toBe(2);
    expect(result.usage.products).toBe(3);
    expect(result.usage.orders).toBe(2);
  });

  it("returns limits from the plan", async () => {
    const { billingRouter } = await import("../billing-router");
    const caller = billingRouter.createCaller(makeCtx(1, 10));
    const result = await caller.status();

    expect(result.limits.maxUsers).toBe(5);
    expect(result.limits.maxProducts).toBe(50);
    expect(result.limits.maxOrdersMonth).toBeNull();
  });

  it("returns all available plans", async () => {
    const { billingRouter } = await import("../billing-router");
    const caller = billingRouter.createCaller(makeCtx(1, 10));
    const result = await caller.status();

    expect(result.plans).toHaveLength(3);
    expect(result.plans.map((p: { key: string }) => p.key)).toEqual(["basic", "pro", "exclusive"]);
  });

  it("returns trialEndsAt and planExpiresAt from tenant", async () => {
    const trialEnd = new Date(Date.now() + 3 * 86_400_000);
    tenantsTable[0].trialEndsAt = trialEnd;
    tenantsTable[0].planExpiresAt = null;

    const { billingRouter } = await import("../billing-router");
    const caller = billingRouter.createCaller(makeCtx(1, 10));
    const result = await caller.status();

    expect(result.trialEndsAt).toEqual(trialEnd);
    expect(result.planExpiresAt).toBeNull();
  });
});

describe("billing.requestUpgrade", () => {
  it("returns success with correct message for basic plan", async () => {
    const { billingRouter } = await import("../billing-router");
    const caller = billingRouter.createCaller(makeCtx(1, 10, "ceo"));
    const result = await caller.requestUpgrade({ plan: "basic" });

    expect(result.success).toBe(true);
    expect(result.plan).toBe("basic");
    expect(result.price).toBe(299000);
    expect(result.message).toContain("Basic");
  });

  it("returns success with correct message for pro plan", async () => {
    const { billingRouter } = await import("../billing-router");
    const caller = billingRouter.createCaller(makeCtx(1, 10, "ceo"));
    const result = await caller.requestUpgrade({ plan: "pro" });

    expect(result.success).toBe(true);
    expect(result.plan).toBe("pro");
    expect(result.price).toBe(599000);
    expect(result.message).toContain("Pro");
  });

  it("updates tenants.updatedAt", async () => {
    const before = tenantsTable[0].updatedAt;

    const { billingRouter } = await import("../billing-router");
    const caller = billingRouter.createCaller(makeCtx(1, 10, "ceo"));
    await caller.requestUpgrade({ plan: "basic" });

    expect(tenantsTable[0].updatedAt).not.toEqual(before);
    expect(tenantsTable[0].updatedAt).toBeInstanceOf(Date);
  });

  it("calls notifyAdmin with tgMessages.upgradeRequest", async () => {
    const { billingRouter } = await import("../billing-router");
    const { notifyAdmin, tgMessages } = await import("../telegram-router");
    const caller = billingRouter.createCaller(makeCtx(1, 10, "ceo"));
    await caller.requestUpgrade({ plan: "basic" });

    expect(tgMessages.upgradeRequest).toHaveBeenCalledWith(
      "Test Co",
      "Basic",
      expect.any(String),
      "+998901234567",
    );
    expect(notifyAdmin).toHaveBeenCalled();
  });

  it("rejects non-admin roles (operator)", async () => {
    const { billingRouter } = await import("../billing-router");
    const caller = billingRouter.createCaller(makeCtx(1, 10, "operator"));

    await expect(caller.requestUpgrade({ plan: "basic" })).rejects.toThrow();
  });

  it("rejects non-admin roles (agent)", async () => {
    const { billingRouter } = await import("../billing-router");
    const caller = billingRouter.createCaller(makeCtx(1, 10, "agent"));

    await expect(caller.requestUpgrade({ plan: "basic" })).rejects.toThrow();
  });

  it("accepts ceo role", async () => {
    const { billingRouter } = await import("../billing-router");
    const caller = billingRouter.createCaller(makeCtx(1, 10, "ceo"));
    const result = await caller.requestUpgrade({ plan: "pro" });

    expect(result.success).toBe(true);
  });
});
