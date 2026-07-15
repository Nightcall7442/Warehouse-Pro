/**
 * Stock concurrency tests.
 *
 * Tests that the stock reservation logic is correct when multiple orders
 * compete for the same limited stock. Uses an in-memory fake DB that
 * runs transactions sequentially (same thread), which validates the
 * sequential correctness of the stock check-and-reserve logic.
 *
 * Covers:
 *  - Sequential orders from the same stock pool
 *  - Final unit reservation (last unit is not overallocated)
 *  - Multi-product multi-order from single pool
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
    sql: sqlFn,
  };
});

vi.mock("../telegram-router", () => ({
  notifyAdmin: vi.fn(async () => {}),
  tgMessages: { newOrder: vi.fn(() => "mock message") },
}));

import { orders, orderItems, warehouseStock, products, warehouses } from "@db/schema";

interface FakeOrder { id: number; tenantId: number; agentId: number; shopId: number; status: string; }
interface FakeOrderItem { id: number; orderId: number; productId: number; quantity: string; }
interface FakeStock { productId: number; tenantId: number; warehouseId: number; currentStock: string; reserved: string; available: string; }

let ordersTable: FakeOrder[] = [];
let orderItemsTable: FakeOrderItem[] = [];
let stockTable: FakeStock[] = [];
let productsTable: { id: number; tenantId: number; name: string; unitPrice: string; status: string; costPrice?: string }[] = [];
let warehousesTable: { id: number; tenantId: number; name: string; isDefault: boolean; status: string }[] = [];
let nextOrderId = 1;
let nextItemId  = 1;

function resetTables() {
  ordersTable = [];
  orderItemsTable = [];
  stockTable = [
    { productId: 1, tenantId: 1, warehouseId: 1, currentStock: "50.00", reserved: "0.00", available: "50.00" },
    { productId: 2, tenantId: 1, warehouseId: 1, currentStock: "30.00", reserved: "0.00", available: "30.00" },
  ];
  productsTable = [
    { id: 1, tenantId: 1, name: "Product A", unitPrice: "100.00", status: "active", costPrice: "50.00" },
    { id: 2, tenantId: 1, name: "Product B", unitPrice: "200.00", status: "active", costPrice: "80.00" },
  ];
  warehousesTable = [
    { id: 1, tenantId: 1, name: "Main", isDefault: true, status: "active" },
  ];
  nextOrderId = 1;
  nextItemId  = 1;
}

function tableOf(ref: unknown): "orders" | "orderItems" | "warehouseStock" | "products" | "warehouses" | "other" {
  if (ref === orders) return "orders";
  if (ref === orderItems) return "orderItems";
  if (ref === warehouseStock) return "warehouseStock";
  if (ref === products) return "products";
  if (ref === warehouses) return "warehouses";
  return "other";
}

function rowsFor(table: ReturnType<typeof tableOf>): unknown[] {
  if (table === "orders") return ordersTable;
  if (table === "orderItems") return orderItemsTable;
  if (table === "warehouseStock") return stockTable;
  if (table === "products") return productsTable;
  if (table === "warehouses") return warehousesTable;
  return [];
}

const columnToFieldName = new Map<unknown, string>();
for (const [field, col] of Object.entries(orders))        columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(orderItems))    columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(warehouseStock)) columnToFieldName.set(col, field);
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
  function selectBuilder() {
    let table: ReturnType<typeof tableOf> = "other";
    const api = {
      from(ref: unknown) { table = tableOf(ref); return api; },
      leftJoin() { return api; },
      where(cond: unknown) {
        const filtered = rowsFor(table).filter((r) => evalCond(r, cond));
        const chain = Object.assign(Promise.resolve(filtered), {
          limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
          orderBy: () => Object.assign(Promise.resolve(filtered), { limit: (n: number) => Promise.resolve(filtered.slice(0, n)) }),
          for: () => chain,
        });
        return chain;
      },
      limit(n: number) { return Promise.resolve(rowsFor(table).slice(0, n)); },
    };
    return api;
  }

  function updateBuilder(table: ReturnType<typeof tableOf>) {
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

  const db = {
    select: () => selectBuilder(),
    insert: (ref: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const table = tableOf(ref);
        if (table === "orders") {
          const id = nextOrderId++;
          ordersTable.push({ id, tenantId: vals.tenantId as number, agentId: vals.agentId as number, shopId: vals.shopId as number, status: vals.status as string });
          return Promise.resolve([{ insertId: id }]);
        }
        if (table === "orderItems") {
          const list = Array.isArray(vals) ? vals : [vals];
          for (const v of list) orderItemsTable.push({ id: nextItemId++, orderId: v.orderId as number, productId: v.productId as number, quantity: String(v.quantity) });
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
            let field: string;
            if (isCompletePattern) {
              field = caseIndex === 0 ? "currentStock" : "reserved";
            } else if (caseIndex === 0) {
              field = "reserved";
            } else {
              field = "available";
            }
            let op: string;
            if (isCreatePattern) {
              op = caseIndex === 0 ? "+" : "-";
            } else if (isCompletePattern) {
              op = "-";
            } else {
              op = caseIndex === 0 ? "-" : "+";
            }
            for (const chunk of obj.chunks) {
              if (!chunk || typeof chunk !== "object") continue;
              const c = chunk as { __kind: string; strings: string[]; values: unknown[] };
              if (c.__kind !== "sql") continue;
              const productId = Number(c.values[0]);
              const amount = Number(c.values[1]);
              updates.push({ productId, field, op, amount });
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

function makeCtx(tenantId: number, userId: number, role = "agent") {
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

describe("stock concurrency — sequential correctness", () => {
  it("two orders exhausting stock: first succeeds, second is rejected", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 10, "agent"));

    // First order: takes 30 of 50 available
    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 30, unitPrice: 100 }] });
    expect(stockTable.find(s => s.productId === 1)!.available).toBe("20.00");
    expect(stockTable.find(s => s.productId === 1)!.reserved).toBe("30.00");

    // Second order: tries to take 25 of 20 remaining — should fail
    await expect(
      caller.create({ shopId: 1, items: [{ productId: 1, quantity: 25, unitPrice: 100 }] })
    ).rejects.toThrow();
    expect(stockTable.find(s => s.productId === 1)!.available).toBe("20.00");
    expect(stockTable.find(s => s.productId === 1)!.reserved).toBe("30.00");
  });

  it("last unit is not over-allocated", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 10, "agent"));

    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 50, unitPrice: 100 }] });
    expect(stockTable.find(s => s.productId === 1)!.available).toBe("0.00");
    expect(stockTable.find(s => s.productId === 1)!.reserved).toBe("50.00");

    await expect(
      caller.create({ shopId: 1, items: [{ productId: 1, quantity: 1, unitPrice: 100 }] })
    ).rejects.toThrow();
  });

  it("multi-product order: one product exhausted, other still available", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 10, "agent"));

    await caller.create({ shopId: 1, items: [
      { productId: 1, quantity: 50, unitPrice: 100 },
      { productId: 2, quantity: 25, unitPrice: 200 },
    ]});

    expect(stockTable.find(s => s.productId === 1)!.available).toBe("0.00");
    expect(stockTable.find(s => s.productId === 1)!.reserved).toBe("50.00");
    expect(stockTable.find(s => s.productId === 2)!.available).toBe("5.00");
    expect(stockTable.find(s => s.productId === 2)!.reserved).toBe("25.00");

    // Second order for product 2 only should succeed (there's still 5 left)
    await caller.create({ shopId: 1, items: [{ productId: 2, quantity: 5, unitPrice: 200 }] });
    expect(stockTable.find(s => s.productId === 2)!.available).toBe("0.00");
    expect(stockTable.find(s => s.productId === 2)!.reserved).toBe("30.00");
  });

  it("cancelling one order releases stock for another", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 10, "agent"));

    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 40, unitPrice: 100 }] });
    expect(stockTable.find(s => s.productId === 1)!.available).toBe("10.00");

    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 10, unitPrice: 100 }] });
    expect(stockTable.find(s => s.productId === 1)!.available).toBe("0.00");

    // Cancel the first order — stock should be released
    await caller.cancel({ id: 1 });
    expect(stockTable.find(s => s.productId === 1)!.available).toBe("40.00");
    expect(stockTable.find(s => s.productId === 1)!.reserved).toBe("10.00");

    // Now create a new order using the released stock
    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 30, unitPrice: 100 }] });
    expect(stockTable.find(s => s.productId === 1)!.available).toBe("10.00");
    expect(stockTable.find(s => s.productId === 1)!.reserved).toBe("40.00");
  });
});
