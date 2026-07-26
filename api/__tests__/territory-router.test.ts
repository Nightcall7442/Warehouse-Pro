/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq:  (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
  and: (...conds: unknown[]) => ({ __kind: "and", conds }),
  desc: (col: unknown) => ({ __kind: "desc", col }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values }),
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

import { territories, shops } from "@db/schema";

// ── Fake tables ──────────────────────────────────────────────────────────────
interface FakeTerritory { id: number; tenantId: number; name: string; color: string | null; }
interface FakeShop { id: number; tenantId: number; name: string; city: string; address: string; status: string; territoryId: number | null; }

let territoriesTable: FakeTerritory[] = [];
let shopsTable: FakeShop[] = [];
let nextId = 10;

function resetTables() {
  territoriesTable = [
    { id: 1, tenantId: 1, name: "Central", color: "#FF0000" },
    { id: 2, tenantId: 1, name: "North", color: "#00FF00" },
  ];
  shopsTable = [
    { id: 1, tenantId: 1, name: "Shop A", city: "Tashkent", address: "123 Main", status: "active", territoryId: 1 },
    { id: 2, tenantId: 1, name: "Shop B", city: "Samarkand", address: "456 Side", status: "active", territoryId: 2 },
    { id: 3, tenantId: 1, name: "Shop C", city: "Bukhara", address: "789 Blvd", status: "active", territoryId: null },
  ];
  nextId = 10;
}

function tableOf(ref: unknown): string {
  if (ref === territories) return "territories";
  if (ref === shops) return "shops";
  return "other";
}

function rowsFor(table: string): Record<string, unknown>[] {
  if (table === "territories") return territoriesTable as unknown as Record<string, unknown>[];
  if (table === "shops") return shopsTable as unknown as Record<string, unknown>[];
  return [];
}

const columnToFieldName = new Map<unknown, string>();
for (const [field, col] of Object.entries(territories)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(shops)) columnToFieldName.set(col, field);

function evalCond(row: Record<string, unknown>, cond: Record<string, unknown>): boolean {
  if (!cond || typeof cond !== "object") return true;
  if (cond.__kind === "and") return (cond.conds as unknown[]).every((inner: unknown) => evalCond(row, inner as Record<string, unknown>));
  if (cond.__kind === "eq") {
    const fieldName = columnToFieldName.get(cond.col) ?? (cond.col as Record<string, unknown>)?.name ?? cond.col;
    if (!(fieldName as string in row)) return true;
    return row[fieldName as string] === cond.val || String(row[fieldName as string]) === String(cond.val);
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
      const isCountQuery = proj && typeof proj === "object" && "count" in (proj as Record<string, unknown>);
      let currentTable = "other";
      const api: Record<string, any> = {
        from(ref: unknown) { currentTable = tableOf(ref); return api; },
        leftJoin(ref: unknown) {
          // Simple join simulation: attach shop count
          return {
            where(cond: unknown) {
              const filtered = rowsFor(currentTable).filter((r) => evalCond(r, cond as Record<string, unknown>));
              // For territories.list, compute shopCount
              if (currentTable === "territories") {
                const enriched = filtered.map((row) => {
                  const count = shopsTable.filter((s) => s.tenantId === row.tenantId && s.territoryId === row.id).length;
                  return { ...row, count };
                });
                if (isCountQuery) return chainable([{ count: enriched.length }]);
                return chainable(enriched);
              }
              return chainable(filtered);
            },
            orderBy() { return chainable([]); },
            groupBy() { return chainable([]); },
          };
        },
        where(cond: unknown) {
          const filtered = rowsFor(currentTable).filter((r) => evalCond(r, cond as Record<string, unknown>));
          if (isCountQuery) return chainable([{ count: filtered.length }]);
          return chainable(filtered);
        },
        limit(n: number) { return chainable(rowsFor(currentTable).slice(0, n)); },
        orderBy() { return chainable(rowsFor(currentTable)); },
        groupBy() { return chainable(rowsFor(currentTable)); },
      };
      return api;
    },
    insert: (ref: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const table = tableOf(ref);
        if (table === "territories") {
          const id = nextId++;
          territoriesTable.push({
            id, tenantId: vals.tenantId as number, name: vals.name as string,
            color: (vals.color as string) ?? null,
          });
          return Promise.resolve([{ insertId: id }]);
        }
        return Promise.resolve([{ insertId: 1 }]);
      },
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
    delete: (ref: unknown) => ({
      where: (cond: Record<string, unknown>) => {
        const table = tableOf(ref);
        if (table === "territories") {
          territoriesTable = territoriesTable.filter((r) => !evalCond(r as Record<string, unknown>, cond));
        }
        return Promise.resolve();
      },
    }),
    transaction: async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn(db),
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

describe("territory.list", () => {
  it("returns territories with shop counts", async () => {
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 10));
    const result = await caller.list() as any;
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].name).toBeDefined();
    expect(result[0].id).toBeDefined();
  });

  it("only returns territories for current tenant", async () => {
    territoriesTable.push({ id: 99, tenantId: 999, name: "Other", color: null });
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 10));
    const result = await caller.list() as any;
    expect(result.every((t: any) => t.tenantId !== 999)).toBe(true);
  });
});

describe("territory.create", () => {
  it("creates territory with name and color", async () => {
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));
    const result = await caller.create({ name: "South", color: "#0000FF" });
    expect(result.id).toBe(10);
    const created = territoriesTable.find((t) => t.id === result.id)!;
    expect(created.name).toBe("South");
    expect(created.color).toBe("#0000FF");
  });

  it("creates territory without color", async () => {
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));
    const result = await caller.create({ name: "West" });
    expect(result.id).toBe(10);
    const created = territoriesTable.find((t) => t.id === result.id)!;
    expect(created.name).toBe("West");
    expect(created.color).toBeNull();
  });
});

describe("territory.update", () => {
  it("updates territory name", async () => {
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));
    const result = await caller.update({ id: 1, name: "Central Updated" });
    expect(result.success).toBe(true);
    expect(territoriesTable.find((t) => t.id === 1)!.name).toBe("Central Updated");
  });

  it("updates territory color", async () => {
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));
    await caller.update({ id: 1, color: "#AABBCC" });
    expect(territoriesTable.find((t) => t.id === 1)!.color).toBe("#AABBCC");
  });

  it("only updates territories in same tenant", async () => {
    territoriesTable.push({ id: 99, tenantId: 999, name: "Other", color: null });
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));
    await caller.update({ id: 99, name: "Hacked" });
    expect(territoriesTable.find((t) => t.id === 99)!.name).toBe("Other");
  });
});

describe("territory.delete", () => {
  it("deletes territory and unlinks shops", async () => {
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));
    const result = await caller.delete({ id: 1 });
    expect(result.success).toBe(true);
    expect(territoriesTable.find((t) => t.id === 1)).toBeUndefined();
    // Shop that had territoryId=1 should now have null
    const shop1 = shopsTable.find((s) => s.id === 1)!;
    expect(shop1.territoryId).toBeNull();
  });

  it("only deletes territories in same tenant", async () => {
    territoriesTable.push({ id: 99, tenantId: 999, name: "Other", color: null });
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));
    await caller.delete({ id: 99 });
    expect(territoriesTable.find((t) => t.id === 99)).toBeDefined();
  });
});

describe("territory.getShops", () => {
  it("returns shops in a territory", async () => {
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 10));
    const result = await caller.getShops({ territoryId: 1 }) as any;
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some((s: any) => s.name === "Shop A")).toBe(true);
  });

  it("returns empty for territory with no shops", async () => {
    territoriesTable.push({ id: 50, tenantId: 1, name: "Empty", color: null });
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 10));
    const result = await caller.getShops({ territoryId: 50 }) as any;
    expect(result).toHaveLength(0);
  });

  it("only returns active shops", async () => {
    shopsTable.push({ id: 50, tenantId: 1, name: "Inactive", city: "X", address: "Y", status: "inactive", territoryId: 1 });
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 10));
    const result = await caller.getShops({ territoryId: 1 }) as any;
    expect(result.every((s: any) => s.name !== "Inactive")).toBe(true);
  });
});

describe("territory.delete — cascading", () => {
  it("nullifies territoryId on all shops referencing deleted territory", async () => {
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));

    const shopBefore = shopsTable.find(s => s.id === 1)!;
    expect(shopBefore.territoryId).toBe(1);

    await caller.delete({ id: 1 });

    const shopAfter = shopsTable.find(s => s.id === 1)!;
    expect(shopAfter.territoryId).toBeNull();
  });

  it("does not affect shops in other territories", async () => {
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));

    await caller.delete({ id: 1 });

    const shop2 = shopsTable.find(s => s.id === 2)!;
    expect(shop2.territoryId).toBe(2);
  });

  it("does not affect shops with null territoryId", async () => {
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 1, "supervisor"));

    const shop3 = shopsTable.find(s => s.id === 3)!;
    expect(shop3.territoryId).toBeNull();

    await caller.delete({ id: 1 });

    const shop3After = shopsTable.find(s => s.id === 3)!;
    expect(shop3After.territoryId).toBeNull();
  });
});

describe("territory.getShops — filtering", () => {
  it("only returns shops belonging to current tenant", async () => {
    shopsTable.push({ id: 99, tenantId: 999, name: "Other Tenant Shop", city: "X", address: "Y", status: "active", territoryId: 1 });
    const { territoryRouter } = await import("../territory-router");
    const caller = territoryRouter.createCaller(makeCtx(1, 10));
    const result = await caller.getShops({ territoryId: 1 }) as any;
    expect(result.every((s: any) => s.tenantId !== 999)).toBe(true);
  });
});
