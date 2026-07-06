/**
 * Stock API integration tests.
 *
 * Tests:
 *  - Stock adjustment via API (warehouse.adjustStock)
 *  - Stock reservation on order creation
 *  - Stock restoration on order cancellation
 *  - Stock deduction on order completion
 *  - Tenant isolation for stock operations
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
    eq: (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
    and: (...conds: unknown[]) => ({ __kind: "and", conds }),
    desc: (col: unknown) => ({ __kind: "desc", col }),
    like: (col: unknown, val: unknown) => ({ __kind: "like", col, val }),
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

vi.mock("../lib/sse", () => ({
  sseBus: { emit: vi.fn() },
}));

import { orders, orderItems, warehouseStock, products, stockMovements, settings } from "@db/schema";

// ── Fake tables ──────────────────────────────────────────────────────────────
interface FakeStock { id: number; productId: number; tenantId: number; currentStock: string; reserved: string; available: string; updatedAt: Date; }
interface FakeStockMovement { id: number; tenantId: number; productId: number; type: string; quantity: string; notes: string | null; createdAt: Date; }
interface FakeOrder { id: number; tenantId: number; agentId: number; shopId: number; status: string; orderNumber: string; subtotal: string; discount: string; total: string; notes: string | null; createdAt: Date; updatedAt: Date; }
interface FakeOrderItem { id: number; orderId: number; productId: number; quantity: string; unitPrice: string; subtotal: string; createdAt: Date; }
interface FakeProduct { id: number; tenantId: number; name: string; code: string; unitPrice: string; costPrice: string; reorderPoint: string; status: string; }
interface FakeSetting { id: number; key: string; value: unknown; tenantId: number; }

let stockTable: FakeStock[] = [];
let movementsTable: FakeStockMovement[] = [];
let ordersTable: FakeOrder[] = [];
let orderItemsTable: FakeOrderItem[] = [];
let productsTable: FakeProduct[] = [];
let settingsTable: FakeSetting[] = [];
let nextOrderId = 1;
let nextItemId = 1;
let nextMovementId = 1;

function resetTables() {
  stockTable = [
    { id: 1, productId: 1, tenantId: 1, currentStock: "100.00", reserved: "0.00", available: "100.00", updatedAt: new Date() },
    { id: 2, productId: 2, tenantId: 1, currentStock: "5.00", reserved: "0.00", available: "5.00", updatedAt: new Date() },
    { id: 3, productId: 3, tenantId: 1, currentStock: "0.00", reserved: "0.00", available: "0.00", updatedAt: new Date() },
  ];
  movementsTable = [];
  ordersTable = [];
  orderItemsTable = [];
  productsTable = [
    { id: 1, tenantId: 1, name: "Widget A", code: "WA-001", unitPrice: "100.00", costPrice: "50.00", reorderPoint: "20.00", status: "active" },
    { id: 2, tenantId: 1, name: "Widget B", code: "WB-002", unitPrice: "50.00", costPrice: "25.00", reorderPoint: "10.00", status: "active" },
    { id: 3, tenantId: 1, name: "Empty Item", code: "EI-003", unitPrice: "200.00", costPrice: "100.00", reorderPoint: "5.00", status: "active" },
  ];
  settingsTable = [];
  nextOrderId = 1;
  nextItemId = 1;
  nextMovementId = 1;
}

function tableOf(ref: unknown): string {
  if (ref === warehouseStock) return "warehouseStock";
  if (ref === stockMovements) return "stockMovements";
  if (ref === orders) return "orders";
  if (ref === orderItems) return "orderItems";
  if (ref === products) return "products";
  if (ref === settings) return "settings";
  return "other";
}

function rowsFor(table: string): Record<string, unknown>[] {
  if (table === "warehouseStock") return stockTable as unknown as Record<string, unknown>[];
  if (table === "stockMovements") return movementsTable as unknown as Record<string, unknown>[];
  if (table === "orders") return ordersTable as unknown as Record<string, unknown>[];
  if (table === "orderItems") return orderItemsTable as unknown as Record<string, unknown>[];
  if (table === "products") return productsTable as unknown as Record<string, unknown>[];
  if (table === "settings") return settingsTable as unknown as Record<string, unknown>[];
  return [];
}

const columnToFieldName = new Map<unknown, string>();
for (const [field, col] of Object.entries(warehouseStock)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(stockMovements)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(orders)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(orderItems)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(products)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(settings)) columnToFieldName.set(col, field);

function evalCond(row: Record<string, unknown>, cond: Record<string, unknown>): boolean {
  if (!cond || typeof cond !== "object") return true;
  if (cond.__kind === "and") return (cond.conds as unknown[]).every((c: unknown) => evalCond(row, c as Record<string, unknown>));
  if (cond.__kind === "eq") {
    const fieldName = columnToFieldName.get(cond.col) ?? (cond.col as Record<string, unknown>)?.name ?? cond.col;
    return row[fieldName as string] === cond.val || String(row[fieldName as string]) === String(cond.val);
  }
  if (cond.__kind === "like") {
    const fieldName = columnToFieldName.get(cond.col) ?? (cond.col as Record<string, unknown>)?.name ?? cond.col;
    const val = row[fieldName as string] ?? "";
    const pattern = String(cond.val).replace(/^%/, ".*").replace(/%$/, "");
    return new RegExp(pattern, "i").test(String(val));
  }
  if (cond.__kind === "ne") {
    const fieldName = columnToFieldName.get(cond.col) ?? (cond.col as Record<string, unknown>)?.name ?? cond.col;
    return row[fieldName as string] !== cond.val && String(row[fieldName as string]) !== String(cond.val);
  }
  return true;
}

function evalSqlDelta(row: Record<string, unknown>, fieldName: string, expr: Record<string, unknown>): string {
  if (!expr || expr.__kind !== "sql") return row[fieldName] as string;
  const opStr = (expr.strings as string[]).find((s: string) => s.includes("+") || s.includes("-")) ?? "";
  const op = opStr.includes("+") ? "+" : "-";
  const amount = Number((expr.values as unknown[])[(expr.values as unknown[]).length - 1]);
  const current = Number(row[fieldName]);
  return (op === "+" ? current + amount : current - amount).toFixed(2);
}

function makeMockDb() {
  function selectBuilder() {
    let currentTable = "other";
    const wrap = (arr: unknown[]): any => Object.assign(Promise.resolve(arr), {
      limit: (n: number) => wrap(arr.slice(0, n)),
      offset: (n: number) => wrap(arr.slice(n)),
      orderBy: () => wrap(arr),
      for: () => wrap(arr),
    });
    const api: Record<string, unknown> = {
      from(ref: unknown) { currentTable = tableOf(ref); return api; },
      leftJoin() { return api; },
      where(cond: Record<string, unknown>) {
        const filtered = rowsFor(currentTable).filter((r) => evalCond(r, cond));
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
          where(cond: Record<string, unknown>) {
            for (const row of rowsFor(table)) {
              if (!evalCond(row, cond)) continue;
              for (const [key, val] of Object.entries(patch)) {
                if (val && typeof val === "object" && (val as Record<string, unknown>).__kind === "sql") {
                  row[key] = evalSqlDelta(row, key, val as Record<string, unknown>);
                } else if (val !== undefined) {
                  row[key] = val;
                }
              }
            }
            return Promise.resolve();
          },
        };
      },
    };
  }

  const db: any = {
    select: () => selectBuilder(),
    insert: (ref: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const table = tableOf(ref);
        if (table === "stockMovements") {
          const id = nextMovementId++;
          movementsTable.push({
            id, tenantId: vals.tenantId as number, productId: vals.productId as number, type: vals.type as string,
            quantity: String(vals.quantity), notes: (vals.notes as string) ?? null, createdAt: new Date(),
          });
          return Promise.resolve([{ insertId: id }]);
        }
        if (table === "orders") {
          const id = nextOrderId++;
          ordersTable.push({
            id, tenantId: vals.tenantId as number, agentId: vals.agentId as number, shopId: vals.shopId as number,
            status: (vals.status as string) ?? "new", orderNumber: (vals.orderNumber as string) ?? `ORD-${id}`,
            subtotal: String(vals.subtotal ?? "0.00"), discount: String(vals.discount ?? "0.00"),
            total: String(vals.total ?? "0.00"), notes: (vals.notes as string) ?? null,
            createdAt: new Date(), updatedAt: new Date(),
          });
          return Promise.resolve([{ insertId: id }]);
        }
        if (table === "orderItems") {
          const list = Array.isArray(vals) ? vals as Record<string, unknown>[] : [vals as Record<string, unknown>];
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
        if (table === "settings") {
          settingsTable.push({ ...vals as Record<string, unknown>, id: settingsTable.length + 1 } as unknown as FakeSetting);
          return Promise.resolve([{ insertId: settingsTable.length }]);
        }
        return Promise.resolve([{ insertId: 1 }]);
      },
    }),
    update: (ref: unknown) => updateBuilder(tableOf(ref)),
    delete: (ref: unknown) => ({
      where: () => {
        const table = tableOf(ref);
        const rows = rowsFor(table);
        const keep = rows.filter(() => true);
        if (table === "orders") ordersTable = keep as unknown as FakeOrder[];
        if (table === "orderItems") orderItemsTable = keep as unknown as FakeOrderItem[];
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

// ── Stock adjustment via API ────────────────────────────────────────────────
describe("warehouse.adjustStock — stock adjustment via API", () => {
  it("adjusts stock 'in' — increases currentStock and available", async () => {
    const { warehouseRouter } = await import("../warehouse-router");
    const caller = warehouseRouter.createCaller(makeCtx(1, 1, "operator"));
    await caller.adjustStock({ productId: 1, quantity: "50", type: "in", notes: "Restock" });

    const stock = stockTable.find(s => s.productId === 1 && s.tenantId === 1)!;
    expect(stock.currentStock).toBe("150.00");
    expect(stock.available).toBe("150.00");
  });

  it("adjusts stock 'out' — decreases currentStock and available", async () => {
    const { warehouseRouter } = await import("../warehouse-router");
    const caller = warehouseRouter.createCaller(makeCtx(1, 1, "operator"));
    await caller.adjustStock({ productId: 1, quantity: "30", type: "out", notes: "Manual out" });

    const stock = stockTable.find(s => s.productId === 1 && s.tenantId === 1)!;
    expect(stock.currentStock).toBe("70.00");
    expect(stock.available).toBe("70.00");
  });

  it("adjusts stock 'adjustment' — sets absolute value", async () => {
    const { warehouseRouter } = await import("../warehouse-router");
    const caller = warehouseRouter.createCaller(makeCtx(1, 1, "operator"));
    await caller.adjustStock({ productId: 1, quantity: "200", type: "adjustment" });

    const stock = stockTable.find(s => s.productId === 1 && s.tenantId === 1)!;
    expect(stock.currentStock).toBe("200");
  });

  it("creates a stock movement record", async () => {
    const { warehouseRouter } = await import("../warehouse-router");
    const caller = warehouseRouter.createCaller(makeCtx(1, 1, "operator"));
    await caller.adjustStock({ productId: 1, quantity: "25", type: "in", notes: "Restocked" });

    expect(movementsTable).toHaveLength(1);
    expect(movementsTable[0].type).toBe("in");
    expect(movementsTable[0].quantity).toBe("25");
    expect(movementsTable[0].notes).toBe("Restocked");
  });

  it("rejects unauthenticated stock adjustment", async () => {
    const { warehouseRouter } = await import("../warehouse-router");
    const ctx = makeCtx(1, 1);
    delete (ctx as any).user;
    delete (ctx as any).tenant;
    const caller = warehouseRouter.createCaller(ctx);
    await expect(
      caller.adjustStock({ productId: 1, quantity: "10", type: "in" })
    ).rejects.toThrow();
  });
});

// ── Stock reservation on order creation ─────────────────────────────────────
describe("stock reservation — order creation", () => {
  it("reserves exactly the requested quantity", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller({ ...makeCtx(1, 10, "agent"), db: mockDb });
    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 20, unitPrice: 100 }] });

    const stock = stockTable.find(s => s.productId === 1 && s.tenantId === 1)!;
    expect(stock.reserved).toBe("20.00");
    expect(stock.available).toBe("80.00");
    expect(stock.currentStock).toBe("100.00");
  });

  it("rejects order when stock is insufficient", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller({ ...makeCtx(1, 10, "agent"), db: mockDb });
    await expect(
      caller.create({ shopId: 1, items: [{ productId: 2, quantity: 50, unitPrice: 10 }] })
    ).rejects.toThrow(/Недостаточно товара/);

    const stock = stockTable.find(s => s.productId === 2)!;
    expect(stock.reserved).toBe("0.00");
    expect(stock.available).toBe("5.00");
  });

  it("rejects order when stock is zero", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller({ ...makeCtx(1, 10, "agent"), db: mockDb });
    await expect(
      caller.create({ shopId: 1, items: [{ productId: 3, quantity: 1, unitPrice: 200 }] })
    ).rejects.toThrow(/Недостаточно товара/);
  });

  it("reserves stock for multiple items in one order", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller({ ...makeCtx(1, 10, "agent"), db: mockDb });
    await caller.create({
      shopId: 1,
      items: [
        { productId: 1, quantity: 10, unitPrice: 100 },
        { productId: 2, quantity: 3, unitPrice: 50 },
      ],
    });

    const stock1 = stockTable.find(s => s.productId === 1)!;
    const stock2 = stockTable.find(s => s.productId === 2)!;
    expect(stock1.reserved).toBe("10.00");
    expect(stock1.available).toBe("90.00");
    expect(stock2.reserved).toBe("3.00");
    expect(stock2.available).toBe("2.00");
  });

  it("does not modify currentStock on reservation", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller({ ...makeCtx(1, 10, "agent"), db: mockDb });
    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 20, unitPrice: 100 }] });

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.currentStock).toBe("100.00");
  });
});

// ── Stock restoration on order cancellation ─────────────────────────────────
describe("stock restoration — order cancellation", () => {
  it("returns full reservation to available stock", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller({ ...makeCtx(1, 10, "agent"), db: mockDb });
    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 15, unitPrice: 100 }] });

    expect(stockTable.find(s => s.productId === 1)!.reserved).toBe("15.00");

    await caller.cancel({ id: 1 });

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.reserved).toBe("0.00");
    expect(stock.available).toBe("100.00");
    expect(stock.currentStock).toBe("100.00");
  });

  it("restores stock for multi-item order cancellation", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller({ ...makeCtx(1, 10, "agent"), db: mockDb });
    await caller.create({
      shopId: 1,
      items: [
        { productId: 1, quantity: 10, unitPrice: 100 },
        { productId: 2, quantity: 3, unitPrice: 50 },
      ],
    });
    await caller.cancel({ id: 1 });

    expect(stockTable.find(s => s.productId === 1)!.reserved).toBe("0.00");
    expect(stockTable.find(s => s.productId === 1)!.available).toBe("100.00");
    expect(stockTable.find(s => s.productId === 2)!.reserved).toBe("0.00");
    expect(stockTable.find(s => s.productId === 2)!.available).toBe("5.00");
  });

  it("stock is not double-restored on double cancel", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller({ ...makeCtx(1, 10, "agent"), db: mockDb });
    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 15, unitPrice: 100 }] });
    await caller.cancel({ id: 1 });

    await expect(caller.cancel({ id: 1 })).rejects.toThrow(/Можно отменить только новые заказы/);

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.available).toBe("100.00");
  });
});

// ── Stock deduction on order completion ──────────────────────────────────────
describe("stock deduction — order completion", () => {
  it("deducts from currentStock and clears reservation", async () => {
    const { orderRouter } = await import("../order-router");
    const agentCaller = orderRouter.createCaller({ ...makeCtx(1, 10, "agent"), db: mockDb });
    const opCaller = orderRouter.createCaller({ ...makeCtx(1, 1, "operator"), db: mockDb });

    await agentCaller.create({ shopId: 1, items: [{ productId: 1, quantity: 10, unitPrice: 100 }] });
    await opCaller.updateStatus({ id: 1, status: "completed" });

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.currentStock).toBe("90.00");
    expect(stock.reserved).toBe("0.00");
    expect(stock.available).toBe("90.00");
  });

  it("completing multi-item order deducts all items", async () => {
    const { orderRouter } = await import("../order-router");
    const agentCaller = orderRouter.createCaller({ ...makeCtx(1, 10, "agent"), db: mockDb });
    const opCaller = orderRouter.createCaller({ ...makeCtx(1, 1, "operator"), db: mockDb });

    await agentCaller.create({
      shopId: 1,
      items: [
        { productId: 1, quantity: 10, unitPrice: 100 },
        { productId: 2, quantity: 3, unitPrice: 50 },
      ],
    });
    await opCaller.updateStatus({ id: 1, status: "completed" });

    const stock1 = stockTable.find(s => s.productId === 1)!;
    const stock2 = stockTable.find(s => s.productId === 2)!;
    expect(stock1.currentStock).toBe("90.00");
    expect(stock1.reserved).toBe("0.00");
    expect(stock2.currentStock).toBe("2.00");
    expect(stock2.reserved).toBe("0.00");
  });

  it("cancel via updateStatus restores stock correctly", async () => {
    const { orderRouter } = await import("../order-router");
    const agentCaller = orderRouter.createCaller({ ...makeCtx(1, 10, "agent"), db: mockDb });
    const opCaller = orderRouter.createCaller({ ...makeCtx(1, 1, "operator"), db: mockDb });

    await agentCaller.create({ shopId: 1, items: [{ productId: 1, quantity: 20, unitPrice: 100 }] });
    const s1 = stockTable.find(s => s.productId === 1)!;
    expect(s1.reserved).toBe("20.00");
    expect(s1.available).toBe("80.00");

    await opCaller.updateStatus({ id: 1, status: "cancelled" });

    const s2 = stockTable.find(s => s.productId === 1)!;
    expect(s2.reserved).toBe("0.00");
    expect(s2.available).toBe("100.00");
    expect(s2.currentStock).toBe("100.00");
  });
});

// ── Tenant isolation for stock ──────────────────────────────────────────────
describe("stock operations — tenant isolation", () => {
  it("tenant 2 cannot see or modify tenant 1 stock via order creation", async () => {
    const { orderRouter } = await import("../order-router");
    const t2Caller = orderRouter.createCaller({ ...makeCtx(2, 100, "agent"), db: mockDb });

    // Tenant 2 has no products, so order should fail
    await expect(
      t2Caller.create({ shopId: 2, items: [{ productId: 1, quantity: 1, unitPrice: 100 }] })
    ).rejects.toThrow();

    // Tenant 1 stock unchanged
    const t1Stock = stockTable.find(s => s.productId === 1 && s.tenantId === 1)!;
    expect(t1Stock.available).toBe("100.00");
    expect(t1Stock.reserved).toBe("0.00");
  });

  it("stock adjustment is scoped to tenant", async () => {
    const { warehouseRouter } = await import("../warehouse-router");
    const caller1 = warehouseRouter.createCaller(makeCtx(1, 1, "operator"));

    await caller1.adjustStock({ productId: 1, quantity: "50", type: "in" });

    const t1Stock = stockTable.find(s => s.productId === 1 && s.tenantId === 1)!;
    expect(t1Stock.currentStock).toBe("150.00");

    // Movements are tenant-scoped
    expect(movementsTable[0].tenantId).toBe(1);
  });
});
