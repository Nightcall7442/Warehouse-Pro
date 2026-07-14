/**
 * Order business-logic tests.
 *
 * Mocks `drizzle-orm`'s query helpers (`eq`, `and`, `sql`) with simple,
 * introspectable marker objects instead of trying to parse drizzle's real
 * (circular, version-specific) SQL AST. This keeps the test independent of
 * drizzle's internals while still exercising the exact branching logic in
 * `order-router.ts` — every `eq(col, val)` / `and(...)` / `sql\`col +/- n\`
 * call in the router is replaced by a marker the in-memory fake DB below can
 * interpret directly.
 *
 * Covers the money/stock critical paths:
 *  - creating an order reserves exactly the requested quantity
 *  - creating an order with more than the available stock is rejected,
 *    and no partial reservation leaks through
 *  - cancelling an order returns the full reservation, exactly once
 *  - completing an order deducts stock and clears the reservation, once
 *  - updateStatus can't double-apply stock changes on a repeated call
 *    (duplicate request after a network retry, double-click, etc.)
 *  - an agent cannot cancel another agent's order
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock drizzle-orm's query helpers with introspectable markers ───────────────
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

// ── Fake in-memory tables ─────────────────────────────────────────────────────
interface FakeOrder { id: number; tenantId: number; agentId: number; shopId: number; status: string; }
interface FakeOrderItem { id: number; orderId: number; productId: number; quantity: string; }
interface FakeStock { productId: number; tenantId: number; currentStock: string; reserved: string; available: string; }
interface FakeProduct { id: number; tenantId: number; name: string; unitPrice: string; status: string; }

let ordersTable: FakeOrder[]         = [];
let orderItemsTable: FakeOrderItem[] = [];
let stockTable: FakeStock[]          = [];
let productsTable: FakeProduct[]     = [];
let warehousesTable: { id: number; tenantId: number; name: string; isDefault: boolean; status: string }[] = [];
let nextOrderId = 1;
let nextItemId  = 1;

function resetFakeTables() {
  ordersTable     = [];
  orderItemsTable = [];
  stockTable      = [
    { productId: 1, tenantId: 1, warehouseId: 1, currentStock: "100.00", reserved: "0.00", available: "100.00" },
    { productId: 2, tenantId: 1, warehouseId: 1, currentStock: "5.00",   reserved: "0.00", available: "5.00"   },
  ];
  productsTable   = [
    { id: 1, tenantId: 1, name: "Product 1", unitPrice: "100.00", status: "active" },
    { id: 2, tenantId: 1, name: "Product 2", unitPrice: "50.00", status: "active" },
  ];
  warehousesTable = [
    { id: 1, tenantId: 1, name: "Main", isDefault: true, status: "active" },
  ];
  nextOrderId = 1;
  nextItemId  = 1;
}

function tableOf(ref: unknown): "orders" | "orderItems" | "warehouseStock" | "other" {
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

// Map every column object (across all three tables we care about) to its
// JS property name on the table — drizzle's `.name` is the snake_case DB
// column name (e.g. "product_id"), not the camelCase JS key our fake rows
// use, so we build this lookup once instead of trusting `.name`.
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

      // Parse the batch CASE/WHEN query
      // Create pattern: reserved = reserved + CASE ... / available = available - CASE ...
      // Cancel pattern: reserved = CASE ... ELSE reserved END / available = CASE ... ELSE available END

      const updates: Array<{ productId: number; field: string; op: string; amount: number }> = [];

      // Detect pattern
      const isCreatePattern = fullSql.includes("reserved = reserved +") || fullSql.includes("available = available -");
      const isCompletePattern = fullSql.includes("current_stock = CASE") && !fullSql.includes("reserved = reserved +");

      // Process each sql_join in the values
      let caseIndex = 0;
      for (const val of s.values) {
        if (!val || typeof val !== "object") continue;
        const obj = val as Record<string, unknown>;

        if (obj.__kind === "sql_join" && Array.isArray(obj.chunks)) {
          if (caseIndex < 2) {
            // Determine field from SQL context
            let field: string;
            if (isCompletePattern) {
              // Complete pattern: current_stock (case 0), reserved (case 1)
              field = caseIndex === 0 ? "currentStock" : "reserved";
            } else if (caseIndex === 0) {
              field = "reserved";
            } else {
              field = "available";
            }

            // Determine operation based on pattern
            let op: string;
            if (isCreatePattern) {
              // Create: reserved +, available -
              op = caseIndex === 0 ? "+" : "-";
            } else if (isCompletePattern) {
              // Complete: current_stock -, reserved -
              op = "-";
            } else {
              // Cancel: reserved -, available +
              op = caseIndex === 0 ? "-" : "+";
            }

            for (const chunk of obj.chunks) {
              if (!chunk || typeof chunk !== "object") continue;
              const c = chunk as { __kind: string; strings: string[]; values: unknown[] };
              if (c.__kind !== "sql") continue;

              // Each chunk is: WHEN product_id = ${productId} THEN ... ${amount}
              const productId = Number(c.values[0]);
              const amount = Number(c.values[1]);
              updates.push({ productId, field, op, amount });
            }
          }
          caseIndex++;
        }
      }

      // Get tenantId from the last non-object value
      const tenantId = s.values.filter(v => typeof v !== "object" || v === null).pop();

      // Apply updates
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
    user: { id: userId, tenantId, role, status: "active", name: "Test", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test", name: "Test Co", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    db: mockDb,
  };
}

beforeEach(() => {
  resetFakeTables();
  mockDb = makeMockDb();
});

describe("order.create — stock reservation", () => {
  it("reserves exactly the requested quantity and reduces available", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 20, unitPrice: 100 }] });

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.reserved).toBe("20.00");
    expect(stock.available).toBe("80.00");
    expect(stock.currentStock).toBe("100.00");
  });

  it("rejects an order that requests more than the available stock", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    await expect(
      caller.create({ shopId: 1, items: [{ productId: 2, quantity: 50, unitPrice: 10 }] })
    ).rejects.toThrow(/Недостаточно товара/);

    const stock = stockTable.find(s => s.productId === 2)!;
    expect(stock.reserved).toBe("0.00");
    expect(stock.available).toBe("5.00");
    expect(ordersTable).toHaveLength(0);
  });

  it("creates exactly one order row and one order_items row per line", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 10, "agent"));
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
});

describe("order.cancel — stock release", () => {
  it("returns the full reservation back to available stock", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 15, unitPrice: 100 }] });

    expect(stockTable.find(s => s.productId === 1)!.reserved).toBe("15.00");

    await caller.cancel({ id: 1 });

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.reserved).toBe("0.00");
    expect(stock.available).toBe("100.00");
    expect(ordersTable[0].status).toBe("cancelled");
  });

  it("refuses to cancel an order that isn't in 'new' status", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 10, unitPrice: 100 }] });
    await caller.cancel({ id: 1 });

    await expect(caller.cancel({ id: 1 })).rejects.toThrow(/Можно отменить только новые заказ/);
  });

  it("an agent cannot cancel another agent's order", async () => {
    const { orderRouter } = await import("../order-router");
    const ownerCaller    = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const intruderCaller = orderRouter.createCaller(makeCtx(1, 99, "agent"));

    await ownerCaller.create({ shopId: 1, items: [{ productId: 1, quantity: 10, unitPrice: 100 }] });

    await expect(intruderCaller.cancel({ id: 1 })).rejects.toThrow(/Заказ не найден/);
  });
});

describe("order.updateStatus — no double-apply on stock", () => {
  it("completing an order deducts currentStock once and clears the reservation", async () => {
    const { orderRouter } = await import("../order-router");
    const caller   = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const opCaller = orderRouter.createCaller(makeCtx(1, 1, "operator"));

    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 10, unitPrice: 100 }] });
    await opCaller.updateStatus({ id: 1, status: "completed" });

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.currentStock).toBe("90.00");
    expect(stock.reserved).toBe("0.00");
  });

  it("calling updateStatus(completed) twice does not deduct stock twice", async () => {
    const { orderRouter } = await import("../order-router");
    const caller   = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const opCaller = orderRouter.createCaller(makeCtx(1, 1, "operator"));

    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 10, unitPrice: 100 }] });
    await opCaller.updateStatus({ id: 1, status: "completed" });
    try { await opCaller.updateStatus({ id: 1, status: "completed" }); } catch { /* expected */ }

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.currentStock).toBe("90.00");
  });

  it("cancelling via updateStatus twice does not return the reservation twice", async () => {
    const { orderRouter } = await import("../order-router");
    const caller   = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const opCaller = orderRouter.createCaller(makeCtx(1, 1, "operator"));

    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 10, unitPrice: 100 }] });
    await opCaller.updateStatus({ id: 1, status: "cancelled" });
    try { await opCaller.updateStatus({ id: 1, status: "cancelled" }); } catch { /* expected */ }

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.available).toBe("100.00");
  });
});
