import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
  and: (...conds: unknown[]) => ({ __kind: "and", conds }),
  desc: (col: unknown) => ({ __kind: "desc", col }),
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

import { notifications, warehouseStock, products, orders, dailyPlans, shops } from "@db/schema";

interface FakeNotification {
  id: number;
  userId: number;
  tenantId: number;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: Date;
}

interface FakeStock {
  id: number;
  productId: number;
  tenantId: number;
  currentStock: string;
  reserved: string;
  available: string;
}

interface FakeProduct {
  id: number;
  tenantId: number;
  name: string;
  reorderPoint: string;
}

interface FakeOrder {
  id: number;
  tenantId: number;
  status: string;
}

let notificationsTable: FakeNotification[] = [];
let stockTable: FakeStock[] = [];
let productsTable: FakeProduct[] = [];
let ordersTable: FakeOrder[] = [];
let plansTable: unknown[] = [];
let shopsTable: unknown[] = [];

function resetTables() {
  notificationsTable = [
    { id: 1, userId: 10, tenantId: 1, title: "Order created", message: "New order", isRead: false, createdAt: new Date("2025-01-02") },
    { id: 2, userId: 10, tenantId: 1, title: "Stock low", message: "Widget A low", isRead: true, createdAt: new Date("2025-01-01") },
    { id: 3, userId: 20, tenantId: 1, title: "Other user", message: "For user 20", isRead: false, createdAt: new Date() },
  ];
  stockTable = [
    { id: 1, productId: 1, tenantId: 1, currentStock: "3.00", reserved: "0.00", available: "3.00" },
  ];
  productsTable = [
    { id: 1, tenantId: 1, name: "Product A", reorderPoint: "10.00" },
  ];
  ordersTable = [
    { id: 1, tenantId: 1, status: "new" },
  ];
  plansTable = [];
  shopsTable = [];
}

function tableOf(ref: unknown): string {
  if (ref === notifications) return "notifications";
  if (ref === warehouseStock) return "warehouseStock";
  if (ref === products) return "products";
  if (ref === orders) return "orders";
  if (ref === dailyPlans) return "dailyPlans";
  if (ref === shops) return "shops";
  return "other";
}

function rowsFor(table: string): unknown[] {
  if (table === "notifications") return notificationsTable;
  if (table === "warehouseStock") return stockTable;
  if (table === "products") return productsTable;
  if (table === "orders") return ordersTable;
  if (table === "dailyPlans") return plansTable;
  if (table === "shops") return shopsTable;
  return [];
}

const columnToFieldName = new Map<unknown, string>();
for (const [_field, col] of Object.entries(notifications)) columnToFieldName.set(col, _field);
for (const [_field, col] of Object.entries(warehouseStock)) columnToFieldName.set(col, _field);
for (const [_field, col] of Object.entries(products)) columnToFieldName.set(col, _field);
for (const [_field, col] of Object.entries(orders)) columnToFieldName.set(col, _field);
for (const [_field, col] of Object.entries(dailyPlans)) columnToFieldName.set(col, _field);
for (const [_field, col] of Object.entries(shops)) columnToFieldName.set(col, _field);

function evalCond(row: unknown, cond: unknown): boolean {
  if (!cond || typeof cond !== "object") return true;
  const c = cond as Record<string, unknown>;
  const r = row as Record<string, unknown>;
  if (c.__kind === "and") return (c.conds as unknown[]).every((inner: unknown) => evalCond(row, inner));
  if (c.__kind === "eq") {
    const fieldName = (columnToFieldName.get(c.col) ?? (c.col as Record<string, unknown>)?.name ?? c.col) as string;
    if (c.val && typeof c.val === "object" && columnToFieldName.has(c.val)) {
      const otherField = columnToFieldName.get(c.val)!;
      return r[fieldName] === r[otherField] || String(r[fieldName]) === String(r[otherField]);
    }
    return r[fieldName] === c.val || String(r[fieldName]) === String(c.val);
  }
  if (c.__kind === "sql") {
    if (c.strings && (c.strings as string[]).some((s: string) => s.includes("<"))) {
      const leftField = (columnToFieldName.get((c.values as unknown[])[0]) ?? ((c.values as unknown[])[0] as Record<string, unknown>)?.name) as string;
      const rightField = (columnToFieldName.get((c.values as unknown[])[1]) ?? ((c.values as unknown[])[1] as Record<string, unknown>)?.name) as string;
      if (leftField && rightField) {
        return Number(r[leftField]) < Number(r[rightField]);
      }
      if (leftField && !rightField) {
        return Number(r[leftField]) < Number((c.values as unknown[])[1]);
      }
    }
    return true;
  }
  return true;
}

function evalCondCross(leftRow: unknown, rightRow: unknown, cond: unknown): boolean {
  if (!cond || typeof cond !== "object") return true;
  const c = cond as Record<string, unknown>;
  if (c.__kind === "and") return (c.conds as unknown[]).every((inner: unknown) => evalCondCross(leftRow, rightRow, inner));
  if (c.__kind === "eq") {
    const leftField = (columnToFieldName.get(c.col) ?? (c.col as Record<string, unknown>)?.name) as string;
    const rightField = (columnToFieldName.get(c.val) ?? (c.val as Record<string, unknown>)?.name) as string;
    if (leftField && rightField) {
      const l = leftRow as Record<string, unknown>;
      const r = rightRow as Record<string, unknown>;
      return l[leftField] === r[rightField] || String(l[leftField]) === String(r[rightField]);
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

    function applyJoin(rows: unknown[]) {
      if (!joinInfo) return rows;
      const joinRows = rowsFor(joinInfo.table);
      return rows.map(row => {
        const match = joinRows.find(jr => evalCondCross(row, jr, joinInfo!.condition));
        return { ...row as Record<string, unknown>, ...(match || {}) };
      });
    }

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

    function applyJoinAndProject(rows: unknown[]) {
      return applyProject(applyJoin(rows));
    }

    function wrapResult(filtered: unknown[]) {
      const result = Promise.resolve(filtered);
      (result as unknown as { limit: (n: number) => Promise<unknown[]> }).limit = (n: number) => Promise.resolve(filtered.slice(0, n));
      (result as unknown as { offset: (n: number) => Promise<unknown[]> }).offset = (n: number) => Promise.resolve(filtered.slice(n));
      (result as unknown as { orderBy: () => Promise<unknown[]> }).orderBy = () => {
        const r2 = Promise.resolve(filtered);
        (r2 as unknown as { limit: (n: number) => Promise<unknown[]> }).limit = (n: number) => {
          const lr = Promise.resolve(filtered.slice(0, n));
          (lr as unknown as { offset: (o: number) => Promise<unknown[]> }).offset = (o: number) => Promise.resolve(filtered.slice(o, o + n));
          return lr;
        };
        (r2 as unknown as { offset: (n: number) => Promise<unknown[]> }).offset = (n: number) => Promise.resolve(filtered.slice(n));
        return r2;
      };
      return result;
    }

    const api: Record<string, unknown> = {
      from(ref: unknown) { currentTable = tableOf(ref); return api; },
      leftJoin(ref: unknown, cond: unknown) {
        joinInfo = { table: tableOf(ref), condition: cond };
        return api;
      },
      where(cond: unknown) {
        const joined = applyJoin(rowsFor(currentTable));
        const filtered = joined.filter((r) => evalCond(r, cond));
        if (isCount) return Promise.resolve([{ count: filtered.length }]);
        return wrapResult(applyProject(filtered));
      },
      limit(n: number) {
        const rows = rowsFor(currentTable).slice(0, n);
        return wrapResult(applyJoinAndProject(rows));
      },
      offset(n: number) {
        const rows = rowsFor(currentTable).slice(n);
        return wrapResult(applyJoinAndProject(rows));
      },
      orderBy() {
        const filtered = rowsFor(currentTable);
        return wrapResult(applyJoinAndProject(filtered));
      },
    };
    return api;
  }

  const db: Record<string, unknown> = {
    select: (proj?: unknown) => selectBuilder(proj),
    insert: () => ({
      values: () => {
        return Promise.resolve([{ insertId: 1 }]);
      },
    }),
    update: (ref: unknown) => ({
      set(patch: Record<string, unknown>) {
        return {
          where(cond: unknown) {
            for (const row of rowsFor(tableOf(ref))) {
              if (!evalCond(row, cond)) continue;
              for (const [key, val] of Object.entries(patch)) {
                (row as Record<string, unknown>)[key] = val && typeof val === "object" && (val as Record<string, unknown>).__kind === "sql" ? (row as Record<string, unknown>)[key] : val;
              }
            }
            return Promise.resolve();
          },
        };
      },
    }),
    delete: () => ({
      where: () => {
        return Promise.resolve();
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return db;
}

let mockDb: ReturnType<typeof makeMockDb>;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

const mockCache = { data: new Map<string, unknown>(), get(k: string) { return this.data.get(k); }, set(k: string, v: unknown) { this.data.set(k, v); }, delete(k: string) { this.data.delete(k); }, clear() { this.data.clear(); }, invalidatePrefix(prefix: string) { for (const k of this.data.keys()) { if (k.startsWith(prefix)) this.data.delete(k); } } };
vi.mock("../lib/cache", () => ({ cache: mockCache, CacheKeys: { smartAlerts: (t: number, u: number) => `sa:${t}:${u}` }, CacheTTL: { shops: 60 } }));

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
  mockCache.clear();
});

describe("notification.list", () => {
  it("returns notifications for current user and tenant", async () => {
    const { notificationRouter } = await import("../notification-router");
    const caller = notificationRouter.createCaller(makeCtx(1, 10));
    const result = await caller.list();

    expect(result).toHaveLength(2);
    expect(result.map((n: any) => n.title)).toEqual(["Order created", "Stock low"]);
  });

  it("orders by createdAt desc", async () => {
    const { notificationRouter } = await import("../notification-router");
    const caller = notificationRouter.createCaller(makeCtx(1, 10));
    const result = await caller.list();

    expect(result[0].title).toBe("Order created");
    expect(result[1].title).toBe("Stock low");
  });
});

describe("notification.unreadCount", () => {
  it("returns correct count", async () => {
    const { notificationRouter } = await import("../notification-router");
    const caller = notificationRouter.createCaller(makeCtx(1, 10));
    const result = await caller.unreadCount();

    expect(result.count).toBe(1);
  });

  it("returns 0 when all read", async () => {
    notificationsTable.forEach(n => { n.isRead = true; });

    const { notificationRouter } = await import("../notification-router");
    const caller = notificationRouter.createCaller(makeCtx(1, 10));
    const result = await caller.unreadCount();

    expect(result.count).toBe(0);
  });
});

describe("notification.markRead", () => {
  it("sets isRead=true and emits SSE", async () => {
    const { notificationRouter } = await import("../notification-router");
    const { sseBus } = await import("../lib/sse");
    const caller = notificationRouter.createCaller(makeCtx(1, 10));
    const result = await caller.markRead({ id: 1 });

    expect(result.success).toBe(true);
    expect(notificationsTable.find(n => n.id === 1)!.isRead).toBe(true);
    expect(sseBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: "notification.new",
      tenantId: 1,
      userId: 10,
    }));
  });
});

describe("notification.markAllRead", () => {
  it("marks all user notifications read", async () => {
    const { notificationRouter } = await import("../notification-router");
    const caller = notificationRouter.createCaller(makeCtx(1, 10));
    const result = await caller.markAllRead();

    expect(result.success).toBe(true);
    expect(notificationsTable.filter(n => n.userId === 10 && n.tenantId === 1).every(n => n.isRead)).toBe(true);
  });
});

describe("notification.smartAlerts", () => {
  it("includes low_stock when stock < reorderPoint", async () => {
    const { notificationRouter } = await import("../notification-router");
    const caller = notificationRouter.createCaller(makeCtx(1, 10));
    const result = (await caller.smartAlerts()) as any;

    expect(result.some((a: unknown) => (a as Record<string, unknown>).type === "low_stock")).toBe(true);
  });

  it("includes pending_orders when new orders exist", async () => {
    const { notificationRouter } = await import("../notification-router");
    const caller = notificationRouter.createCaller(makeCtx(1, 10));
    const result = (await caller.smartAlerts()) as any;

    expect(result.some((a: unknown) => (a as Record<string, unknown>).type === "pending_orders")).toBe(true);
  });

  it("empty when no issues", async () => {
    stockTable = [
      { id: 1, productId: 1, tenantId: 1, currentStock: "100.00", reserved: "0.00", available: "100.00" },
    ];
    ordersTable = [];

    const { notificationRouter } = await import("../notification-router");
    const caller = notificationRouter.createCaller(makeCtx(1, 10));
    const result = await caller.smartAlerts();

    expect(result).toHaveLength(0);
  });
});
