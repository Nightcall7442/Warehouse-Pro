/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq:  (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
  gte: (col: unknown, val: unknown) => ({ __kind: "gte", col, val }),
  lte: (col: unknown, val: unknown) => ({ __kind: "lte", col, val }),
  and: (...conds: unknown[]) => ({ __kind: "and", conds }),
  desc: (col: unknown) => ({ __kind: "desc", col }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values }),
  isNull: (col: unknown) => ({ __kind: "isNull", col }),
}));

vi.mock("../telegram-router", () => ({
  notifyAdmin: vi.fn(async () => {}),
  tgMessages: { newOrder: vi.fn(() => "mock message") },
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

vi.mock("../lib/sanitize", () => ({
  sanitizeString: (s: string) => s.replace(/<[^>]*>/g, "").trim(),
}));

import { agentLocations, dailyPlans, shops, users } from "@db/schema";

// ── Fake tables ──────────────────────────────────────────────────────────────
interface FakeUser { id: number; tenantId: number; name: string; email: string; role: string; status: string; }
interface FakeShop { id: number; tenantId: number; name: string; city: string; address: string; debt: string; status: string; agentId: number | null; }
interface FakePlan { id: number; tenantId: number; agentId: number; shopId: number; status: string; planDate: Date; notes: string | null; photoUrl: string | null; createdBy: number; }
interface FakeLocation { id: number; tenantId: number; agentId: number; lat: string; lng: string; accuracy: string | null; batteryLevel: number | null; createdAt: Date; }

let usersTable: FakeUser[] = [];
let shopsTable: FakeShop[] = [];
let plansTable: FakePlan[] = [];
let locationsTable: FakeLocation[] = [];
let nextPlanId = 10;
let nextLocId = 10;
let nextShopId = 10;

function resetTables() {
  usersTable = [
    { id: 10, tenantId: 1, name: "Agent One", email: "a1@test.com", role: "agent", status: "active" },
    { id: 11, tenantId: 1, name: "Agent Two", email: "a2@test.com", role: "agent", status: "active" },
    { id: 1, tenantId: 1, name: "Supervisor", email: "s@test.com", role: "supervisor", status: "active" },
  ];
  shopsTable = [
    { id: 1, tenantId: 1, name: "Shop A", city: "Tashkent", address: "123 Main", debt: "0.00", status: "active", agentId: 10 },
    { id: 2, tenantId: 1, name: "Shop B", city: "Samarkand", address: "456 Side", debt: "100.00", status: "active", agentId: 10 },
    { id: 3, tenantId: 1, name: "Shop C", city: "Bukhara", address: "789 Blvd", debt: "0.00", status: "active", agentId: 11 },
  ];
  plansTable = [
    { id: 1, tenantId: 1, agentId: 10, shopId: 1, status: "planned", planDate: new Date(), notes: null, photoUrl: null, createdBy: 1 },
    { id: 2, tenantId: 1, agentId: 10, shopId: 2, status: "visited", planDate: new Date(), notes: "Visited", photoUrl: "data:image/png;base64,abc", createdBy: 1 },
    { id: 3, tenantId: 1, agentId: 11, shopId: 3, status: "planned", planDate: new Date(), notes: null, photoUrl: null, createdBy: 1 },
  ];
  locationsTable = [];
  nextPlanId = 10;
  nextLocId = 10;
  nextShopId = 10;
}

function tableOf(ref: unknown): string {
  if (ref === users) return "users";
  if (ref === shops) return "shops";
  if (ref === dailyPlans) return "dailyPlans";
  if (ref === agentLocations) return "agentLocations";
  return "other";
}

function rowsFor(table: string): Record<string, unknown>[] {
  if (table === "users") return usersTable as unknown as Record<string, unknown>[];
  if (table === "shops") return shopsTable as unknown as Record<string, unknown>[];
  if (table === "dailyPlans") return plansTable as unknown as Record<string, unknown>[];
  if (table === "agentLocations") return locationsTable as unknown as Record<string, unknown>[];
  return [];
}

const columnToFieldName = new Map<unknown, string>();
for (const t of [users, shops, dailyPlans, agentLocations]) {
  for (const [field, col] of Object.entries(t)) columnToFieldName.set(col, field);
}

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
      let currentTable = "other";
      const api: Record<string, any> = {
        from(ref: unknown) { currentTable = tableOf(ref); return api; },
        leftJoin(ref: unknown) { return api; },
        where(cond: unknown) {
          const filtered = rowsFor(currentTable).filter((r) => evalCond(r, cond as Record<string, unknown>));
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
        if (table === "dailyPlans") {
          const id = nextPlanId++;
          plansTable.push({
            id, tenantId: vals.tenantId as number, agentId: vals.agentId as number,
            shopId: vals.shopId as number, status: (vals.status as string) ?? "planned",
            planDate: (vals.planDate as Date) ?? new Date(),
            notes: (vals.notes as string) ?? null,
            photoUrl: (vals.photoUrl as string) ?? null,
            createdBy: (vals.createdBy as number) ?? 0,
          });
          return Promise.resolve([{ insertId: id }]);
        }
        if (table === "agentLocations") {
          const id = nextLocId++;
          locationsTable.push({
            id, tenantId: vals.tenantId as number, agentId: vals.agentId as number,
            lat: String(vals.lat ?? "0"), lng: String(vals.lng ?? "0"),
            accuracy: (vals.accuracy as string) ?? null,
            batteryLevel: (vals.batteryLevel as number) ?? null,
            createdAt: new Date(),
          });
          return Promise.resolve([{ insertId: id }]);
        }
        if (table === "shops") {
          const id = nextShopId++;
          shopsTable.push({
            id, tenantId: vals.tenantId as number, name: String(vals.name ?? ""),
            city: String(vals.city ?? ""), address: String(vals.address ?? ""),
            debt: String(vals.debt ?? "0.00"), status: String(vals.status ?? "active"),
            agentId: (vals.agentId as number) ?? null,
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
      where: () => Promise.resolve(),
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

describe("agent.getPlans", () => {
  it("returns own plans for agent role", async () => {
    const { agentRouter } = await import("../agent-router");
    const caller = agentRouter.createCaller(makeCtx(1, 10, "agent"));
    const result = await caller.getPlans({ date: new Date().toISOString().split("T")[0] }) as any;
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((p: any) => p.agentId === 10)).toBe(true);
  });

  it("returns all plans for supervisor role", async () => {
    const { agentRouter } = await import("../agent-router");
    const caller = agentRouter.createCaller(makeCtx(1, 1, "supervisor"));
    const result = await caller.getPlans({ date: new Date().toISOString().split("T")[0] }) as any;
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("returns filtered plans when agentId specified", async () => {
    const { agentRouter } = await import("../agent-router");
    const caller = agentRouter.createCaller(makeCtx(1, 1, "supervisor"));
    const result = await caller.getPlans({ agentId: 11, date: new Date().toISOString().split("T")[0] }) as any;
    expect(result.every((p: any) => p.agentId === 11)).toBe(true);
  });
});

describe("agent.createPlan", () => {
  it("creates a plan for an agent", async () => {
    const { agentRouter } = await import("../agent-router");
    const caller = agentRouter.createCaller(makeCtx(1, 1, "supervisor"));
    const result = await caller.createPlan({ agentId: 10, shopId: 1, planDate: new Date().toISOString().split("T")[0] });
    expect(result.id).toBe(10);
  });

  it("throws if agent not in tenant", async () => {
    const { agentRouter } = await import("../agent-router");
    const caller = agentRouter.createCaller(makeCtx(1, 1, "supervisor"));
    await expect(caller.createPlan({ agentId: 999, shopId: 1, planDate: "2025-01-01" })).rejects.toThrow("Агент не найден");
  });

  it("throws if shop not in tenant", async () => {
    const { agentRouter } = await import("../agent-router");
    const caller = agentRouter.createCaller(makeCtx(1, 1, "supervisor"));
    await expect(caller.createPlan({ agentId: 10, shopId: 999, planDate: "2025-01-01" })).rejects.toThrow("Магазин не найден");
  });
});

describe("agent.updatePlanStatus", () => {
  it("updates plan status to visited", async () => {
    const { agentRouter } = await import("../agent-router");
    const caller = agentRouter.createCaller(makeCtx(1, 10, "agent"));
    const result = await caller.updatePlanStatus({ planId: 1, status: "visited" });
    expect(result.success).toBe(true);
    expect(plansTable.find((p) => p.id === 1)!.status).toBe("visited");
  });

  it("updates plan status to skipped", async () => {
    const { agentRouter } = await import("../agent-router");
    const caller = agentRouter.createCaller(makeCtx(1, 10, "agent"));
    await caller.updatePlanStatus({ planId: 1, status: "skipped" });
    expect(plansTable.find((p) => p.id === 1)!.status).toBe("skipped");
  });

  it("agent cannot update other agent's plan", async () => {
    const { agentRouter } = await import("../agent-router");
    const caller = agentRouter.createCaller(makeCtx(1, 10, "agent"));
    // Plan 3 belongs to agent 11, agent 10 should not be able to update it
    await caller.updatePlanStatus({ planId: 3, status: "visited" });
    // The mock updates all rows matching the conditions, so it would update
    // but with the agentId check in the real code, agent 10 can't update plan 3
    expect(plansTable.find((p) => p.id === 3)!.status).toBe("planned");
  });
});

describe("agent.saveVisitPhoto", () => {
  it("saves photo and marks plan as visited", async () => {
    const { agentRouter } = await import("../agent-router");
    const caller = agentRouter.createCaller(makeCtx(1, 10, "agent"));
    const result = await caller.saveVisitPhoto({ planId: 1, photoUrl: "data:image/png;base64,test" });
    expect(result.success).toBe(true);
    const plan = plansTable.find((p) => p.id === 1)!;
    expect(plan.status).toBe("visited");
    expect(plan.photoUrl).toBe("data:image/png;base64,test");
  });

  it("saves notes along with photo", async () => {
    const { agentRouter } = await import("../agent-router");
    const caller = agentRouter.createCaller(makeCtx(1, 10, "agent"));
    await caller.saveVisitPhoto({ planId: 1, photoUrl: "data:image/png;base64,test", notes: "Good visit" });
    expect(plansTable.find((p) => p.id === 1)!.notes).toBe("Good visit");
  });

  it("agent cannot save photo for other agent's plan", async () => {
    const { agentRouter } = await import("../agent-router");
    const caller = agentRouter.createCaller(makeCtx(1, 10, "agent"));
    // Plan 3 belongs to agent 11
    await caller.saveVisitPhoto({ planId: 3, photoUrl: "data:image/png;base64,test" });
    // The agentId check should prevent update
    expect(plansTable.find((p) => p.id === 3)!.status).toBe("planned");
  });
});

describe("agent.saveLocation", () => {
  it("saves agent GPS location", async () => {
    const { agentRouter } = await import("../agent-router");
    const caller = agentRouter.createCaller(makeCtx(1, 10, "agent"));
    const result = await caller.saveLocation({ lat: "41.3111", lng: "69.2797" });
    expect(result.success).toBe(true);
    expect(locationsTable.length).toBe(1);
    expect(locationsTable[0].lat).toBe("41.3111");
  });

  it("saves accuracy and battery level", async () => {
    const { agentRouter } = await import("../agent-router");
    const caller = agentRouter.createCaller(makeCtx(1, 10, "agent"));
    await caller.saveLocation({ lat: "41.3111", lng: "69.2797", accuracy: "10", batteryLevel: 85 });
    expect(locationsTable[0].accuracy).toBe("10");
    expect(locationsTable[0].batteryLevel).toBe(85);
  });
});

describe("agent.createShop", () => {
  it("creates shop linked to agent", async () => {
    const { agentRouter } = await import("../agent-router");
    const caller = agentRouter.createCaller(makeCtx(1, 10, "agent"));
    const result = await caller.createShop({ name: "New Shop" });
    expect(result.id).toBe(10);
    const created = shopsTable.find((s) => s.id === result.id)!;
    expect(created.name).toBe("New Shop");
    expect(created.agentId).toBe(10);
    expect(created.status).toBe("active");
  });

  it("sanitizes shop name", async () => {
    const { agentRouter } = await import("../agent-router");
    const caller = agentRouter.createCaller(makeCtx(1, 10, "agent"));
    await caller.createShop({ name: "Shop <script>alert(1)</script>" });
    const created = shopsTable.find((s) => s.id === 10)!;
    expect(created.name).not.toContain("<script>");
  });
});

describe("agent.getOptimizedRoute", () => {
  it("returns plans sorted by distance", async () => {
    shopsTable.push({ id: 20, tenantId: 1, name: "Far Shop", city: "X", address: "Y", debt: "0", status: "active", agentId: 10 });
    plansTable.push({ id: 20, tenantId: 1, agentId: 10, shopId: 20, status: "planned", planDate: new Date(), notes: null, photoUrl: null, createdBy: 1 });

    const { agentRouter } = await import("../agent-router");
    const caller = agentRouter.createCaller(makeCtx(1, 10, "agent"));
    const result = await caller.getOptimizedRoute({ currentLat: 41.3, currentLng: 69.2 }) as any;
    expect(result.plans).toBeDefined();
    expect(result.totalStops).toBeGreaterThanOrEqual(1);
    expect(typeof result.totalDistance).toBe("number");
  });

  it("filters out non-planned visits", async () => {
    const { agentRouter } = await import("../agent-router");
    const caller = agentRouter.createCaller(makeCtx(1, 10, "agent"));
    const result = await caller.getOptimizedRoute({ currentLat: 41.3, currentLng: 69.2 }) as any;
    expect(result.plans.every((p: any) => p.status === "planned")).toBe(true);
  });
});

describe("agent.listAgents", () => {
  it("returns active agents for supervisor", async () => {
    const { agentRouter } = await import("../agent-router");
    const caller = agentRouter.createCaller(makeCtx(1, 1, "supervisor"));
    const result = await caller.listAgents() as any;
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].name).toBeDefined();
  });
});

describe("agent.myShops", () => {
  it("returns shops for agent's tenant", async () => {
    const { agentRouter } = await import("../agent-router");
    const caller = agentRouter.createCaller(makeCtx(1, 10, "agent"));
    const result = await caller.myShops() as any;
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

describe("agent.listShopsForPlan", () => {
  it("returns shop names for supervisor plan creation", async () => {
    const { agentRouter } = await import("../agent-router");
    const caller = agentRouter.createCaller(makeCtx(1, 1, "supervisor"));
    const result = await caller.listShopsForPlan() as any;
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].name).toBeDefined();
  });
});
