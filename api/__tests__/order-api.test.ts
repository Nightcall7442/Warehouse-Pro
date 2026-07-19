/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Order API endpoint integration tests.
 *
 * Exercises the full tRPC procedures exposed by order-router.ts:
 *  - create (POST /api/orders)
 *  - list   (GET  /api/orders)
 *  - getById (GET /api/orders/:id)
 *  - cancel  (PATCH /api/orders/:id/cancel)
 *  - updateStatus (PATCH /api/orders/:id/status)
 *  - delete  (DELETE /api/orders/:id)
 *
 * Uses a fake in-memory DB that interprets drizzle marker objects,
 * keeping tests fast and independent of MySQL.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", () => {
  const sqlFn = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values }),
    {
      join(chunks: unknown[], _sep?: unknown) { return { __kind: "sql_join", chunks }; },
      raw(str: string) { return { __kind: "sql_raw", str }; },
    },
  );
  return {
    eq:  (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
    and: (...conds: unknown[]) => ({ __kind: "and", conds }),
    desc: (col: unknown) => ({ __kind: "desc", col }),
    like: (col: unknown, val: unknown) => ({ __kind: "like", col, val }),
    isNull: (col: unknown) => ({ __kind: "isNull", col }),
    sql: sqlFn,
  };
});

vi.mock("../telegram-router", () => ({
  notifyAdmin: vi.fn(async () => {}),
  tgMessages: { newOrder: vi.fn(() => "mock message") },
}));

vi.mock("../lib/feature-gating", () => ({
  checkSubscriptionAccess: vi.fn(async () => true),
}));

import { orders, orderItems, warehouseStock, shops, users, products, warehouses } from "@db/schema";

// ── Fake tables ──────────────────────────────────────────────────────────────
interface FakeOrder { id: number; tenantId: number; agentId: number; shopId: number; status: string; orderNumber: string; subtotal: string; discount: string; total: string; notes: string | null; createdAt: Date; updatedAt: Date; }
interface FakeOrderItem { id: number; orderId: number; productId: number; quantity: string; unitPrice: string; subtotal: string; createdAt: Date; }
interface FakeStock { id: number; productId: number; tenantId: number; warehouseId: number; currentStock: string; reserved: string; available: string; updatedAt: Date; }
interface FakeShop { id: number; tenantId: number; name: string; }
interface FakeUser { id: number; tenantId: number; name: string; email: string; role: string; }
interface FakeProduct { id: number; tenantId: number; name: string; unitPrice: string; status: string; }

let ordersTable: FakeOrder[] = [];
let orderItemsTable: FakeOrderItem[] = [];
let stockTable: FakeStock[] = [];
let shopsTable: FakeShop[] = [];
let usersTable: FakeUser[] = [];
let productsTable: FakeProduct[] = [];
let warehousesTable: { id: number; tenantId: number; name: string; isDefault: boolean; status: string }[] = [];
let nextOrderId = 1;
let nextItemId = 1;

function resetTables() {
  ordersTable = [];
  orderItemsTable = [];
  stockTable = [
    { id: 1, productId: 1, tenantId: 1, warehouseId: 1, currentStock: "100.00", reserved: "0.00", available: "100.00", updatedAt: new Date() },
    { id: 2, productId: 2, tenantId: 1, warehouseId: 1, currentStock: "5.00", reserved: "0.00", available: "5.00", updatedAt: new Date() },
  ];
  shopsTable = [
    { id: 1, tenantId: 1, name: "Shop A" },
    { id: 2, tenantId: 2, name: "Shop B" },
  ];
  usersTable = [
    { id: 10, tenantId: 1, name: "Agent 1", email: "a1@test.com", role: "agent" },
    { id: 11, tenantId: 1, name: "Agent 2", email: "a2@test.com", role: "agent" },
    { id: 1, tenantId: 1, name: "Operator", email: "op@test.com", role: "operator" },
    { id: 100, tenantId: 2, name: "Agent T2", email: "a1@t2.com", role: "agent" },
  ];
  productsTable = [
    { id: 1, tenantId: 1, name: "Widget A", unitPrice: "100.00", status: "active" },
    { id: 2, tenantId: 1, name: "Widget B", unitPrice: "50.00", status: "active" },
  ];
  warehousesTable = [
    { id: 1, tenantId: 1, name: "Main", isDefault: true, status: "active" },
  ];
  nextOrderId = 1;
  nextItemId = 1;
}

function tableOf(ref: unknown): string {
  if (ref === orders) return "orders";
  if (ref === orderItems) return "orderItems";
  if (ref === warehouseStock) return "warehouseStock";
  if (ref === shops) return "shops";
  if (ref === users) return "users";
  if (ref === products) return "products";
  if (ref === warehouses) return "warehouses";
  return "other";
}

function rowsFor(table: string): unknown[] {
  if (table === "orders") return ordersTable;
  if (table === "orderItems") return orderItemsTable;
  if (table === "warehouseStock") return stockTable;
  if (table === "shops") return shopsTable;
  if (table === "users") return usersTable;
  if (table === "products") return productsTable;
  if (table === "warehouses") return warehousesTable;
  return [];
}

const columnToFieldName = new Map<unknown, string>();
for (const [field, col] of Object.entries(orders)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(orderItems)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(warehouseStock)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(shops)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(users)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(products)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(warehouses)) columnToFieldName.set(col, field);

function evalCond(row: unknown, cond: unknown): boolean {
  if (!cond || typeof cond !== "object") return true;
  const c = cond as Record<string, unknown>;
  const r = row as Record<string, unknown>;
  if (c.__kind === "and") return (c.conds as unknown[]).every((inner: unknown) => evalCond(row, inner));
  if (c.__kind === "eq") {
    const fieldName = columnToFieldName.get(c.col) ?? (c.col as Record<string, unknown>)?.name ?? c.col;
    return r[fieldName as string] === c.val || String(r[fieldName as string]) === String(c.val);
  }
  if (c.__kind === "like") {
    const fieldName = columnToFieldName.get(c.col) ?? (c.col as Record<string, unknown>)?.name ?? c.col;
    const val = r[fieldName as string] ?? "";
    const pattern = String(c.val).replace(/^%/, ".*").replace(/%$/, "");
    return new RegExp(pattern, "i").test(String(val));
  }
  if (c.__kind === "isNull") {
    const fieldName = columnToFieldName.get(c.col) ?? (c.col as Record<string, unknown>)?.name ?? c.col;
    return r[fieldName as string] === null || r[fieldName as string] === undefined;
  }
  return true;
}

function evalSqlDelta(row: unknown, fieldName: string, expr: unknown): string {
  const e = expr as Record<string, unknown>;
  if (!e || e.__kind !== "sql") return (row as Record<string, unknown>)[fieldName] as string;
  const opStr = (e.strings as string[]).find((s: string) => s.includes("+") || s.includes("-")) ?? "";
  const op = opStr.includes("+") ? "+" : "-";
  const amount = Number((e.values as unknown[])[(e.values as unknown[]).length - 1]);
  const current = Number((row as Record<string, unknown>)[fieldName]);
  return (op === "+" ? current + amount : current - amount).toFixed(2);
}

function makeMockDb() {
  function selectBuilder(proj?: unknown) {
    let currentTable = "other";
    const isCount = proj && typeof proj === "object" && !Array.isArray(proj) && (proj as Record<string, unknown>).count && ((proj as Record<string, unknown>).count as Record<string, unknown>).__kind === "sql";
    const wrap = (arr: unknown[]): any => Object.assign(Promise.resolve(arr), {
      limit: (n: number) => wrap(arr.slice(0, n)),
      offset: (n: number) => wrap(arr.slice(n)),
      orderBy: () => wrap(arr),
      for: () => wrap(arr),
    });
    const api: unknown = {
      from(ref: unknown) { currentTable = tableOf(ref); return api; },
      leftJoin() { return api; },
      innerJoin() { return api; },
      where(cond: unknown) {
        const filtered = rowsFor(currentTable).filter((r) => evalCond(r, cond));
        if (isCount) return Promise.resolve([{ count: filtered.length }]);
        return wrap(filtered);
      },
      limit(n: number) { return wrap(rowsFor(currentTable).slice(0, n)); },
      offset(n: number) { return wrap(rowsFor(currentTable).slice(n)); },
      orderBy() { return wrap(rowsFor(currentTable)); },
    };
    return api;
  }

  function updateBuilder(table: string) {
    return {
      set(patch: Record<string, unknown>) {
        return {
          where(cond: unknown) {
            for (const row of rowsFor(table)) {
              if (!evalCond(row, cond)) continue;
              const r = row as Record<string, unknown>;
              for (const [key, val] of Object.entries(patch)) {
                r[key] = val && typeof val === "object" && (val as Record<string, unknown>).__kind === "sql"
                  ? evalSqlDelta(row, key, val)
                  : val;
              }
            }
            return Promise.resolve();
          },
        };
      },
    };
  }

  const db: any = {
    select: (proj?: unknown) => selectBuilder(proj),
    insert: (ref: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const table = tableOf(ref);
        if (table === "orders") {
          const id = nextOrderId++;
          const raw = crypto.randomUUID().replace(/-/g, "");
          ordersTable.push({
            id, tenantId: vals.tenantId as number, agentId: vals.agentId as number, shopId: vals.shopId as number,
            status: (vals.status as string) ?? "new", orderNumber: (vals.orderNumber as string) ?? `ORD-${raw.slice(0, 12).toUpperCase()}`,
            subtotal: String(vals.subtotal ?? "0.00"), discount: String(vals.discount ?? "0.00"),
            total: String(vals.total ?? "0.00"), notes: (vals.notes as string) ?? null,
            createdAt: new Date(), updatedAt: new Date(),
          });
          return Promise.resolve([{ insertId: id }]);
        }
        if (table === "orderItems") {
          const list = Array.isArray(vals) ? vals : [vals];
          for (const v of list) {
            orderItemsTable.push({
              id: nextItemId++, orderId: v.orderId as number, productId: v.productId as number,
              quantity: String(v.quantity), unitPrice: String(v.unitPrice),
              subtotal: String(v.subtotal ?? Number(v.unitPrice) * Number(v.quantity)),
              createdAt: new Date(),
            });
          }
          return Promise.resolve([{ insertId: nextItemId }]);
        }
        return Promise.resolve([{ insertId: 1 }]);
      },
    }),
    update: (ref: unknown) => updateBuilder(tableOf(ref)),
    delete: (ref: unknown) => ({
      where: (cond: unknown) => {
        const table = tableOf(ref);
        const rows = rowsFor(table);
        const keep = rows.filter((r) => !evalCond(r, cond));
        if (table === "orders") ordersTable = keep as FakeOrder[];
        if (table === "orderItems") orderItemsTable = keep as FakeOrderItem[];
        return Promise.resolve();
      },
    }),
    execute: (sqlObj: unknown) => {
      if (!sqlObj || typeof sqlObj !== "object" || (sqlObj as Record<string, unknown>).__kind !== "sql") return Promise.resolve();
      const s = sqlObj as { strings: string[]; values: unknown[] };
      const fullSql = s.strings.join("");
      if (!fullSql.includes("UPDATE warehouse_stock")) return Promise.resolve();

      const updates: Array<{ productId: number; field: string; op: string; amount: number }> = [];
      const isCreatePattern = fullSql.includes("reserved = reserved +") || fullSql.includes("available = available -");
      const isCompletePattern = fullSql.includes("current_stock = CASE") && !fullSql.includes("reserved = reserved +");

      let caseIndex = 0;
      for (const val of s.values) {
        if (!val || typeof val !== "object") continue;
        const obj = val as Record<string, unknown>;
        if (obj.__kind === "sql_join" && Array.isArray(obj.chunks)) {
          if (caseIndex < 2) {
            let field = isCompletePattern ? (caseIndex === 0 ? "currentStock" : "reserved") : (caseIndex === 0 ? "reserved" : "available");
            let op = isCreatePattern ? (caseIndex === 0 ? "+" : "-") : (isCompletePattern ? "-" : (caseIndex === 0 ? "-" : "+"));
            for (const chunk of obj.chunks) {
              if (!chunk || typeof chunk !== "object") continue;
              const c = chunk as { __kind: string; strings: string[]; values: unknown[] };
              if (c.__kind !== "sql") continue;
              updates.push({ productId: Number(c.values[0]), field, op, amount: Number(c.values[1]) });
            }
          }
          caseIndex++;
        }
      }

      const tenantId = s.values.filter(v => typeof v !== "object" || v === null).pop();
      for (const u of updates) {
        for (const row of stockTable) {
          if (String(row.productId) === String(u.productId) && String(row.tenantId) === String(tenantId) && u.field) {
            const cur = Number((row as unknown as Record<string, string>)[u.field]);
            (row as unknown as Record<string, string>)[u.field] = (u.op === "+" ? cur + u.amount : cur - u.amount).toFixed(2);
          }
        }
      }
      return Promise.resolve();
    },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return db;
}

let mockDb: ReturnType<typeof makeMockDb>;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

function makeCtx(tenantId: number, userId: number, role = "agent"): any {
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

// ── POST /api/orders (create) ───────────────────────────────────────────────
describe("order.create — POST /api/orders", () => {
  it("creates an order and returns id + orderNumber", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    const result = await caller.create({
      shopId: 1, items: [{ productId: 1, quantity: 20, unitPrice: 100 }],
    });
    expect(result.id).toBe(1);
    expect(result.orderNumber).toMatch(/^ORD-/);
  });

  it("reserves stock on creation", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 10, unitPrice: 50 }] });

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.reserved).toBe("10.00");
    expect(stock.available).toBe("90.00");
  });

  it("rejects when stock is insufficient", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    await expect(
      caller.create({ shopId: 1, items: [{ productId: 2, quantity: 50, unitPrice: 10 }] })
    ).rejects.toThrow(/Недостаточно товара/);
    expect(ordersTable).toHaveLength(0);
  });

  it("creates order with multiple items", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    await caller.create({
      shopId: 1,
      items: [
        { productId: 1, quantity: 5, unitPrice: 100 },
        { productId: 2, quantity: 2, unitPrice: 50 },
      ],
    });
    expect(ordersTable).toHaveLength(1);
    expect(orderItemsTable).toHaveLength(2);
  });

  it("requires at least one item", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    await expect(
      caller.create({ shopId: 1, items: [] })
    ).rejects.toThrow();
  });

  it("rejects unauthenticated users", async () => {
    const { orderRouter } = await import("../order-router");
    const ctx = makeCtx(1, 10);
    delete (ctx as any).user;
    delete (ctx as any).tenant;
    const caller = orderRouter.createCaller({ ...ctx, db: mockDb });
    await expect(
      caller.create({ shopId: 1, items: [{ productId: 1, quantity: 1, unitPrice: 100 }] })
    ).rejects.toThrow();
  }  );
});

// ── GET /api/orders (list) ──────────────────────────────────────────────────
describe("order.list — GET /api/orders", () => {
  it("returns empty list when no orders exist", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    const result = await caller.list();
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("returns created orders", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 5, unitPrice: 100 }] });

    const result = await caller.list();
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.data[0].status).toBe("new");
  });

  it("filters by status", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 5, unitPrice: 100 }] });

    const result = await caller.list({ status: "cancelled" });
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("isolates tenants — tenant 2 cannot see tenant 1 orders", async () => {
    const { orderRouter } = await import("../order-router");
    const caller1 = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    const caller2 = orderRouter.createCaller({ ...makeCtx(2, 100), db: mockDb });

    await caller1.create({ shopId: 1, items: [{ productId: 1, quantity: 5, unitPrice: 100 }] });

    const result1 = await caller1.list();
    const result2 = await caller2.list();
    expect(result1.data).toHaveLength(1);
    expect(result2.data).toHaveLength(0);
  });
});

// ── GET /api/orders/:id (getById) ───────────────────────────────────────────
describe("order.getById — GET /api/orders/:id", () => {
  it("returns order with items and shop", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    const created = await caller.create({
      shopId: 1,
      items: [{ productId: 1, quantity: 5, unitPrice: 100 }],
    });

    const order = await caller.getById({ id: created.id });
    expect(order).not.toBeNull();
    expect(order!.id).toBe(created.id);
    expect(order!.items).toHaveLength(1);
    expect(order!.shop).toBeDefined();
    expect(order!.shop!.name).toBe("Shop A");
  });

  it("returns null for non-existent order", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    const order = await caller.getById({ id: 999 });
    expect(order).toBeNull();
  });

  it("returns null for order belonging to different tenant", async () => {
    const { orderRouter } = await import("../order-router");
    const caller1 = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    await caller1.create({ shopId: 1, items: [{ productId: 1, quantity: 5, unitPrice: 100 }] });

    const caller2 = orderRouter.createCaller({ ...makeCtx(2, 100), db: mockDb });
    const order = await caller2.getById({ id: 1 });
    expect(order).toBeNull();
  });
});

// ── PATCH /api/orders/:id/cancel ────────────────────────────────────────────
describe("order.cancel — PATCH /api/orders/:id/cancel", () => {
  it("cancels a new order and restores stock", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 15, unitPrice: 100 }] });

    const result = await caller.cancel({ id: 1 });
    expect(result.success).toBe(true);

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.reserved).toBe("0.00");
    expect(stock.available).toBe("100.00");
    expect(ordersTable[0].status).toBe("cancelled");
  });

  it("refuses to cancel a non-new order", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 5, unitPrice: 100 }] });
    await caller.cancel({ id: 1 });

    await expect(caller.cancel({ id: 1 })).rejects.toThrow(/Можно отменить только новые заказы/);
  });

  it("agent cannot cancel another agent's order", async () => {
    const { orderRouter } = await import("../order-router");
    const ownerCaller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    await ownerCaller.create({ shopId: 1, items: [{ productId: 1, quantity: 5, unitPrice: 100 }] });

    const intruderCaller = orderRouter.createCaller({ ...makeCtx(1, 11), db: mockDb });
    await expect(intruderCaller.cancel({ id: 1 })).rejects.toThrow(/Заказ не найден/);
  });

  it("returns error for non-existent order", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    await expect(caller.cancel({ id: 999 })).rejects.toThrow(/Заказ не найден/);
  });
});

// ── PATCH /api/orders/:id/status ────────────────────────────────────────────
describe("order.updateStatus — PATCH /api/orders/:id/status", () => {
  it("transitions from new to processing", async () => {
    const { orderRouter } = await import("../order-router");
    const agentCaller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    const opCaller = orderRouter.createCaller({ ...makeCtx(1, 1, "operator"), db: mockDb });

    await agentCaller.create({ shopId: 1, items: [{ productId: 1, quantity: 5, unitPrice: 100 }] });
    await opCaller.updateStatus({ id: 1, status: "processing" });
    expect(ordersTable[0].status).toBe("processing");
  });

  it("transitions from new to completed and deducts stock", async () => {
    const { orderRouter } = await import("../order-router");
    const agentCaller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    const opCaller = orderRouter.createCaller({ ...makeCtx(1, 1, "operator"), db: mockDb });

    await agentCaller.create({ shopId: 1, items: [{ productId: 1, quantity: 10, unitPrice: 100 }] });
    await opCaller.updateStatus({ id: 1, status: "completed" });

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.currentStock).toBe("90.00");
    expect(stock.reserved).toBe("0.00");
  });

  it("transitions from new to cancelled and restores stock", async () => {
    const { orderRouter } = await import("../order-router");
    const agentCaller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    const opCaller = orderRouter.createCaller({ ...makeCtx(1, 1, "operator"), db: mockDb });

    await agentCaller.create({ shopId: 1, items: [{ productId: 1, quantity: 10, unitPrice: 100 }] });
    await opCaller.updateStatus({ id: 1, status: "cancelled" });

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.available).toBe("100.00");
    expect(stock.reserved).toBe("0.00");
  });

  it("rejects invalid status transition", async () => {
    const { orderRouter } = await import("../order-router");
    const agentCaller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    const opCaller = orderRouter.createCaller({ ...makeCtx(1, 1, "operator"), db: mockDb });

    await agentCaller.create({ shopId: 1, items: [{ productId: 1, quantity: 5, unitPrice: 100 }] });
    await opCaller.updateStatus({ id: 1, status: "completed" });

    await expect(
      opCaller.updateStatus({ id: 1, status: "processing" })
    ).rejects.toThrow(/Невозможно перевести/);
  });

  it("agents cannot update status (operator+ only)", async () => {
    const { orderRouter } = await import("../order-router");
    const agentCaller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    await agentCaller.create({ shopId: 1, items: [{ productId: 1, quantity: 5, unitPrice: 100 }] });

    await expect(
      agentCaller.updateStatus({ id: 1, status: "completed" })
    ).rejects.toThrow();
  });

  it("double-completion does not double deduct stock", async () => {
    const { orderRouter } = await import("../order-router");
    const agentCaller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    const opCaller = orderRouter.createCaller({ ...makeCtx(1, 1, "operator"), db: mockDb });

    await agentCaller.create({ shopId: 1, items: [{ productId: 1, quantity: 10, unitPrice: 100 }] });
    await opCaller.updateStatus({ id: 1, status: "completed" });
    try { await opCaller.updateStatus({ id: 1, status: "completed" }); } catch { /* expected */ }

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.currentStock).toBe("90.00");
  });
});

// ── DELETE /api/orders/:id ──────────────────────────────────────────────────
describe("order.delete — DELETE /api/orders/:id", () => {
  it("deletes a new order and restores stock", async () => {
    const { orderRouter } = await import("../order-router");
    const agentCaller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    const opCaller = orderRouter.createCaller({ ...makeCtx(1, 1, "operator"), db: mockDb });

    await agentCaller.create({ shopId: 1, items: [{ productId: 1, quantity: 10, unitPrice: 100 }] });
    const result = await opCaller.delete({ id: 1 });

    expect(result.success).toBe(true);
    // Soft delete: order still exists but deletedAt is set
    expect(ordersTable).toHaveLength(1);
    expect(ordersTable[0].deletedAt).toBeDefined();
    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.available).toBe("100.00");
  });

  it("deletes a processing order and restores stock", async () => {
    const { orderRouter } = await import("../order-router");
    const agentCaller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    const opCaller = orderRouter.createCaller({ ...makeCtx(1, 1, "operator"), db: mockDb });

    await agentCaller.create({ shopId: 1, items: [{ productId: 1, quantity: 10, unitPrice: 100 }] });
    await opCaller.updateStatus({ id: 1, status: "processing" });
    await opCaller.delete({ id: 1 });

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.available).toBe("100.00");
  });

  it("rejects deleting non-existent order", async () => {
    const { orderRouter } = await import("../order-router");
    const opCaller = orderRouter.createCaller({ ...makeCtx(1, 1, "operator"), db: mockDb });
    await expect(opCaller.delete({ id: 999 })).rejects.toThrow(/Заказ не найден/);
  });

  it("agents cannot delete orders (operator+ only)", async () => {
    const { orderRouter } = await import("../order-router");
    const agentCaller = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    await agentCaller.create({ shopId: 1, items: [{ productId: 1, quantity: 5, unitPrice: 100 }] });

    await expect(agentCaller.delete({ id: 1 })).rejects.toThrow();
  });

  it("cannot delete another tenant's order", async () => {
    const { orderRouter } = await import("../order-router");
    const caller1 = orderRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    await caller1.create({ shopId: 1, items: [{ productId: 1, quantity: 5, unitPrice: 100 }] });

    const opCaller2 = orderRouter.createCaller({ ...makeCtx(2, 1, "operator"), db: mockDb });
    await expect(opCaller2.delete({ id: 1 })).rejects.toThrow();
  });
});
