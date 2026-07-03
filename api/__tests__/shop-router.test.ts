import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq:  (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
  and: (...conds: unknown[]) => ({ __kind: "and", conds }),
  desc: (col: unknown) => ({ __kind: "desc", col }),
  like: (col: unknown, val: unknown) => ({ __kind: "like", col, val }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values }),
}));

vi.mock("../telegram-router", () => ({
  notifyAdmin: vi.fn(async () => {}),
  tgMessages: { newOrder: vi.fn(() => "mock message") },
}));

vi.mock("../lib/feature-gating", () => ({
  checkSubscriptionAccess: vi.fn(async () => true),
}));

vi.mock("../lib/sse", () => ({
  sseBus: { emit: vi.fn() },
}));

vi.mock("../lib/sanitize", () => ({
  sanitizeString: (s: string) => s.replace(/<[^>]*>/g, "").trim(),
  sanitizeSearch: (s: string) => s.replace(/['";\\]/g, "").replace(/--/g, "").trim(),
}));

vi.mock("../services/payment", () => ({
  PaymentService: { addPayment: vi.fn(async () => ({ success: true })) },
}));

import { shops, users, orders, payments } from "@db/schema";

interface FakeShop { id: number; tenantId: number; name: string; city: string; district: string; agentId: number; debt: string; status: string; ownerName: string | null; phone: string | null; address: string | null; photoUrl: string | null; gpsLat: string | null; gpsLng: string | null; notes: string | null; createdAt: Date; updatedAt: Date; }
interface FakeUser { id: number; tenantId: number; name: string; email: string; role: string; }
interface FakeOrder { id: number; tenantId: number; shopId: number; orderNumber: string; total: string; status: string; createdAt: Date; }
interface FakePayment { id: number; tenantId: number; shopId: number; amount: string; type: string; notes: string | null; createdBy: number | null; createdAt: Date; }

let shopsTable: FakeShop[] = [];
let usersTable: FakeUser[] = [];
let ordersTable: FakeOrder[] = [];
let paymentsTable: FakePayment[] = [];
let nextShopId = 3;

function resetTables() {
  shopsTable = [
    { id: 1, tenantId: 1, name: "Shop Alpha", city: "Tashkent", district: "Centr", agentId: 10, debt: "500.00", status: "active", ownerName: "Owner1", phone: "+998901234567", address: "Addr1", photoUrl: null, gpsLat: null, gpsLng: null, notes: null, createdAt: new Date(), updatedAt: new Date() },
    { id: 2, tenantId: 1, name: "Shop Beta", city: "Samarkand", district: "Old", agentId: 10, debt: "0.00", status: "active", ownerName: null, phone: null, address: null, photoUrl: null, gpsLat: null, gpsLng: null, notes: null, createdAt: new Date(), updatedAt: new Date() },
  ];
  usersTable = [
    { id: 10, tenantId: 1, name: "Agent One", email: "a1@test.com", role: "agent" },
    { id: 1, tenantId: 1, name: "Operator", email: "op@test.com", role: "operator" },
  ];
  ordersTable = [];
  paymentsTable = [];
  nextShopId = 3;
}

function tableOf(ref: unknown): string {
  if (ref === shops) return "shops";
  if (ref === users) return "users";
  if (ref === orders) return "orders";
  if (ref === payments) return "payments";
  return "other";
}

function rowsFor(table: string): unknown[] {
  if (table === "shops") return shopsTable;
  if (table === "users") return usersTable;
  if (table === "orders") return ordersTable;
  if (table === "payments") return paymentsTable;
  return [];
}

const columnToFieldName = new Map<unknown, string>();
const columnToTable = new Map<unknown, string>();
for (const [field, col] of Object.entries(shops)) { columnToFieldName.set(col, field); columnToTable.set(col, "shops"); }
for (const [field, col] of Object.entries(users)) { columnToFieldName.set(col, field); columnToTable.set(col, "users"); }
for (const [field, col] of Object.entries(orders)) { columnToFieldName.set(col, field); columnToTable.set(col, "orders"); }
for (const [field, col] of Object.entries(payments)) { columnToFieldName.set(col, field); columnToTable.set(col, "payments"); }

function evalCond(row: unknown, cond: unknown): boolean {
  if (!cond || typeof cond !== "object") return true;
  const c = cond as Record<string, unknown>;
  if (c.__kind === "and") return (c.conds as unknown[]).every((cc: unknown) => evalCond(row, cc));
  if (c.__kind === "eq") {
    const col = c.col as Record<string, unknown> | undefined;
    const fieldName = (columnToFieldName.get(col) ?? col?.name ?? c.col) as string;
    if (c.val && typeof c.val === "object" && columnToFieldName.has(c.val)) {
      const otherField = columnToFieldName.get(c.val)!;
      const r = row as Record<string, unknown>;
      return r[fieldName] === r[otherField] || String(r[fieldName]) === String(r[otherField]);
    }
    const r = row as Record<string, unknown>;
    return r[fieldName] === c.val || String(r[fieldName]) === String(c.val);
  }
  if (c.__kind === "like") {
    const col = c.col as Record<string, unknown> | undefined;
    const fieldName = (columnToFieldName.get(col) ?? col?.name ?? c.col) as string;
    const r = row as Record<string, unknown>;
    const val = r[fieldName] ?? "";
    const pattern = String(c.val).replace(/^%/, ".*").replace(/%$/, "");
    return new RegExp(pattern, "i").test(String(val));
  }
  return true;
}

function evalCondCross(leftRow: unknown, rightRow: unknown, cond: unknown): boolean {
  if (!cond || typeof cond !== "object") return true;
  const c = cond as Record<string, unknown>;
  if (c.__kind === "and") return (c.conds as unknown[]).every((cc: unknown) => evalCondCross(leftRow, rightRow, cc));
  if (c.__kind === "eq") {
    const col = c.col as Record<string, unknown> | undefined;
    const val = c.val as Record<string, unknown> | undefined;
    const leftField = columnToFieldName.get(col) ?? col?.name;
    const rightField = columnToFieldName.get(val) ?? val?.name;
    if (leftField && rightField) {
      const l = leftRow as Record<string, unknown>;
      const r = rightRow as Record<string, unknown>;
      return l[leftField as string] === r[rightField as string] || String(l[leftField as string]) === String(r[rightField as string]);
    }
    return false;
  }
  return true;
}

function makeMockDb() {
  function selectBuilder(proj?: unknown) {
    let currentTable = "other";
    let joinInfo: { table: string; condition: unknown } | null = null;
    const isCount = proj && typeof proj === "object" && !Array.isArray(proj) && (proj as Record<string, unknown>).count && ((proj as Record<string, unknown>).count as Record<string, unknown>).__kind === "sql";

    function applyJoinAndProject(filtered: unknown[]) {
      let rows = filtered;
      const joinMatches: (unknown | null)[] = [];
      if (joinInfo) {
        const joinRows = rowsFor(joinInfo.table) as Record<string, unknown>[];
        rows = filtered.map(row => {
          const match = joinRows.find(jr => evalCondCross(row, jr, joinInfo!.condition));
          joinMatches.push(match ?? null);
          if (!match) return row;
          const merged = { ...(row as Record<string, unknown>) };
          for (const [key, val] of Object.entries(match)) {
            if (!(key in merged)) merged[key] = val;
          }
          return merged;
        });
      }
      if (proj && typeof proj === "object" && !Array.isArray(proj) && !isCount) {
        const projRecord = proj as Record<string, unknown>;
        rows = rows.map((row, i) => {
          const out: Record<string, unknown> = {};
          for (const [alias, colRef] of Object.entries(projRecord)) {
            if (colRef && typeof colRef === "object" && (colRef as Record<string, unknown>).__kind === "sql") continue;
            const colTable = columnToTable.get(colRef);
            if (joinInfo && joinMatches[i] && colTable === joinInfo.table) {
              const colRefRecord = colRef as Record<string, unknown> | undefined;
              const fieldName = (columnToFieldName.get(colRef) ?? colRefRecord?.name ?? alias) as string;
              out[alias] = (joinMatches[i] as Record<string, unknown>)[fieldName];
            } else {
              const colRefRecord = colRef as Record<string, unknown> | undefined;
              const fieldName = (columnToFieldName.get(colRef) ?? colRefRecord?.name ?? alias) as string;
              out[alias] = (row as Record<string, unknown>)[fieldName];
            }
          }
          return out;
        });
      }
      return rows;
    }

    function wrapResult(filtered: unknown[]) {
      return Object.assign(Promise.resolve(filtered), {
        limit: (n: number) => wrapResult(filtered.slice(0, n)),
        offset: (n: number) => wrapResult(filtered.slice(n)),
        orderBy: () => wrapResult(filtered),
      });
    }

    const api: Record<string, unknown> & {
      from: (ref: unknown) => unknown;
      leftJoin: (ref: unknown, cond: unknown) => unknown;
      where: (cond: unknown) => unknown;
      limit: (n: number) => unknown;
      offset: (n: number) => unknown;
      orderBy: () => unknown;
    } = {
      from(ref: unknown) { currentTable = tableOf(ref); return api; },
      leftJoin(ref: unknown, cond: unknown) {
        joinInfo = { table: tableOf(ref), condition: cond };
        return api;
      },
      where(cond: unknown) {
        const filtered = (rowsFor(currentTable) as Record<string, unknown>[]).filter((r) => evalCond(r, cond));
        if (isCount) return Promise.resolve([{ count: filtered.length }]);
        const projected = applyJoinAndProject(filtered);
        return wrapResult(projected);
      },
      limit(n: number) {
        const rows = rowsFor(currentTable).slice(0, n);
        const projected = applyJoinAndProject(rows);
        return wrapResult(projected);
      },
      offset(n: number) {
        const rows = rowsFor(currentTable).slice(n);
        const projected = applyJoinAndProject(rows);
        return wrapResult(projected);
      },
      orderBy() {
        const filtered = rowsFor(currentTable);
        const projected = applyJoinAndProject(filtered);
        return wrapResult(projected);
      },
    };
    return api;
  }

  const db: any = {
    select: (proj?: unknown) => selectBuilder(proj),
    insert: (ref: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const table = tableOf(ref);
        if (table === "shops") {
          const id = nextShopId++;
          const row = { ...(vals as Record<string, unknown>), id, createdAt: new Date(), updatedAt: new Date() };
          shopsTable.push(row as FakeShop);
          return Promise.resolve([{ insertId: id }]);
        }
        return Promise.resolve([{ insertId: 1 }]);
      },
    }),
    update: (ref: unknown) => ({
      set(patch: Record<string, unknown>) {
        return {
          where(cond: unknown) {
            for (const row of (rowsFor(tableOf(ref)) as Record<string, unknown>[])) {
              if (!evalCond(row, cond)) continue;
              for (const [key, val] of Object.entries(patch)) {
                row[key] = val && typeof val === "object" && (val as Record<string, unknown>).__kind === "sql" ? row[key] : val;
              }
            }
            return Promise.resolve();
          },
        };
      },
    }),
    delete: (ref: unknown) => ({
      where: (cond: unknown) => {
        const table = tableOf(ref);
        const keep = (rowsFor(table) as Record<string, unknown>[]).filter((r) => !evalCond(r, cond));
        if (table === "shops") shopsTable = keep as unknown as FakeShop[];
        if (table === "orders") ordersTable = keep as unknown as FakeOrder[];
        if (table === "payments") paymentsTable = keep as unknown as FakePayment[];
        return Promise.resolve();
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
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
    db: null as unknown,
  };
}

beforeEach(() => {
  resetTables();
  mockDb = makeMockDb();
});

describe("shop.list", () => {
  it("returns shops with agentName from leftJoin, scoped by tenant", async () => {
    const { shopRouter } = await import("../shop-router");
    const caller = shopRouter.createCaller({ ...makeCtx(1, 1), db: mockDb });
    const result = (await caller.list()) as any;

    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.data[0].name).toBe("Shop Alpha");
    expect(result.data[0].agentName).toBe("Agent One");
  });

  it("filters by search", async () => {
    const { shopRouter } = await import("../shop-router");
    const caller = shopRouter.createCaller({ ...makeCtx(1, 1), db: mockDb });
    const result = (await caller.list({ search: "Alpha" })) as any;

    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe("Shop Alpha");
  });
});

describe("shop.getById", () => {
  it("returns shop with agent, recentOrders, paymentHistory", async () => {
    const { shopRouter } = await import("../shop-router");
    const caller = shopRouter.createCaller({ ...makeCtx(1, 1), db: mockDb });
    const result = await caller.getById({ id: 1 });

    expect(result).not.toBeNull();
    expect(result!.id).toBe(1);
    expect(result!.name).toBe("Shop Alpha");
    expect(result!.agent).toBeDefined();
    expect((result!.agent as any).name).toBe("Agent One");
    expect(result!.recentOrders).toEqual([]);
    expect(result!.paymentHistory).toEqual([]);
  });

  it("returns null for non-existent shop", async () => {
    const { shopRouter } = await import("../shop-router");
    const caller = shopRouter.createCaller({ ...makeCtx(1, 1), db: mockDb });
    const result = await caller.getById({ id: 999 });

    expect(result).toBeNull();
  });
});

describe("shop.create", () => {
  it("creates shop with sanitized name, returns id", async () => {
    const { shopRouter } = await import("../shop-router");
    const caller = shopRouter.createCaller({ ...makeCtx(1, 1), db: mockDb });
    const result = await caller.create({ name: "<b>New Shop</b>" });

    expect(result.id).toBe(3);
    const created = shopsTable.find(s => s.id === 3)!;
    expect(created.name).toBe("New Shop");
    expect(created.tenantId).toBe(1);
    expect(created.status).toBe("active");
    expect(created.debt).toBe("0.00");
  });
});

describe("shop.update", () => {
  it("updates shop fields", async () => {
    const { shopRouter } = await import("../shop-router");
    const caller = shopRouter.createCaller({ ...makeCtx(1, 1), db: mockDb });
    const result = await caller.update({ id: 1, name: "Updated Shop", city: "Bukhara" });

    expect(result.success).toBe(true);
    const updated = shopsTable.find(s => s.id === 1)!;
    expect(updated.name).toBe("Updated Shop");
    expect(updated.city).toBe("Bukhara");
  });
});

describe("shop.delete", () => {
  it("succeeds for shop with no orders or payments", async () => {
    const { shopRouter } = await import("../shop-router");
    const caller = shopRouter.createCaller({ ...makeCtx(1, 1), db: mockDb });
    const result = await caller.delete({ id: 2 });

    expect(result.success).toBe(true);
    expect(shopsTable.find(s => s.id === 2)).toBeUndefined();
  });

  it("blocks when shop has orders", async () => {
    ordersTable.push({ id: 1, tenantId: 1, shopId: 1, orderNumber: "ORD-001", total: "100.00", status: "new", createdAt: new Date() });

    const { shopRouter } = await import("../shop-router");
    const caller = shopRouter.createCaller({ ...makeCtx(1, 1), db: mockDb });

    await expect(caller.delete({ id: 1 })).rejects.toThrow(/Невозможно удалить магазин/);
    expect(shopsTable.find(s => s.id === 1)).toBeDefined();
  });

  it("blocks when shop has payments", async () => {
    paymentsTable.push({ id: 1, tenantId: 1, shopId: 1, amount: "200.00", type: "payment", notes: null, createdBy: 1, createdAt: new Date() });

    const { shopRouter } = await import("../shop-router");
    const caller = shopRouter.createCaller({ ...makeCtx(1, 1), db: mockDb });

    await expect(caller.delete({ id: 1 })).rejects.toThrow(/Невозможно удалить магазин/);
    expect(shopsTable.find(s => s.id === 1)).toBeDefined();
  });
});
