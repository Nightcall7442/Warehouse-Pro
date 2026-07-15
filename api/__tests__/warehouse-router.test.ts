/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
  and: (...conds: unknown[]) => ({ __kind: "and", conds }),
  desc: (col: unknown) => ({ __kind: "desc", col }),
  like: (col: unknown, val: unknown) => ({ __kind: "like", col, val }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values }),
}));

vi.mock("../telegram-router", () => ({
  notifyAdmin: vi.fn(async () => {}),
}));

vi.mock("../lib/feature-gating", () => ({
  checkSubscriptionAccess: vi.fn(async () => true),
}));

vi.mock("../lib/sse", () => ({
  sseBus: { emit: vi.fn() },
}));

vi.mock("../lib/sanitize", () => ({
  default: (val: unknown) => val,
}));

import { warehouseStock, products, stockMovements, settings, orderItems, orders, warehouses } from "@db/schema";

interface FakeStock {
  id: number;
  productId: number;
  tenantId: number;
  currentStock: string;
  reserved: string;
  available: string;
  updatedAt: Date;
}

interface FakeStockMovement {
  id: number;
  tenantId: number;
  productId: number;
  type: string;
  quantity: string;
  notes: string | null;
  createdAt: Date;
}

interface FakeProduct {
  id: number;
  tenantId: number;
  name: string;
  code: string;
  unitPrice: string;
  costPrice: string;
  reorderPoint: string;
  category: string;
  unit: string;
}

let stockTable: FakeStock[] = [];
let productsTable: FakeProduct[] = [];
let movementsTable: FakeStockMovement[] = [];
let settingsTable: unknown[] = [];
let ordersTable: unknown[] = [];
let orderItemsTable: unknown[] = [];
let warehousesTable: { id: number; tenantId: number; name: string; isDefault: boolean; status: string }[] = [];
let nextMovementId = 1;

function resetTables() {
  stockTable = [
    { id: 1, productId: 1, tenantId: 1, warehouseId: 1, currentStock: "100.00", reserved: "0.00", available: "100.00", updatedAt: new Date() },
    { id: 2, productId: 2, tenantId: 1, warehouseId: 1, currentStock: "5.00", reserved: "0.00", available: "5.00", updatedAt: new Date() },
  ];
  productsTable = [
    { id: 1, tenantId: 1, name: "Product A", code: "PA-001", unitPrice: "100.00", costPrice: "50.00", reorderPoint: "10.00", category: "Widgets", unit: "pcs" },
    { id: 2, tenantId: 1, name: "Product B", code: "PB-002", unitPrice: "50.00", costPrice: "25.00", reorderPoint: "20.00", category: "Widgets", unit: "pcs" },
  ];
  movementsTable = [];
  settingsTable = [];
  ordersTable = [];
  orderItemsTable = [];
  warehousesTable = [
    { id: 1, tenantId: 1, name: "Main", isDefault: true, status: "active" },
  ];
  nextMovementId = 1;
}

function tableOf(ref: unknown): string {
  if (ref === warehouseStock) return "warehouseStock";
  if (ref === products) return "products";
  if (ref === stockMovements) return "stockMovements";
  if (ref === settings) return "settings";
  if (ref === orderItems) return "orderItems";
  if (ref === orders) return "orders";
  if (ref === warehouses) return "warehouses";
  return "other";
}

function rowsFor(table: string): unknown[] {
  if (table === "warehouseStock") return stockTable;
  if (table === "products") return productsTable;
  if (table === "stockMovements") return movementsTable;
  if (table === "settings") return settingsTable;
  if (table === "orderItems") return orderItemsTable;
  if (table === "orders") return ordersTable;
  if (table === "warehouses") return warehousesTable;
  return [];
}

const columnToFieldName = new Map<unknown, string>();
for (const [field, col] of Object.entries(warehouseStock)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(products)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(stockMovements)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(settings)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(orderItems)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(orders)) columnToFieldName.set(col, field);
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
  return true;
}

function makeMockDb() {
  function selectBuilder(proj?: unknown) {
    let currentTable = "other";
    const isCountQuery = proj && typeof proj === "object" && (proj as Record<string, unknown>).count && ((proj as Record<string, unknown>).count as Record<string, unknown>).__kind === "sql";
    const wrap = (arr: unknown[]): any => Object.assign(Promise.resolve(arr), {
      limit: (n: number) => wrap(arr.slice(0, n)),
      offset: (n: number) => wrap(arr.slice(n)),
      orderBy: () => wrap(arr),
      for: () => wrap(arr),
    });
    const api: unknown = {
      from(ref: unknown) { currentTable = tableOf(ref); return api; },
      leftJoin() { return api; },
      where(cond: unknown) {
        const filtered = rowsFor(currentTable).filter((r) => evalCond(r, cond));
        if (isCountQuery) return Promise.resolve([{ count: filtered.length }]);
        return wrap(filtered);
      },
      limit(n: number) {
        const all = rowsFor(currentTable);
        if (isCountQuery) return Promise.resolve([{ count: all.slice(0, n).length }]);
        return wrap(all.slice(0, n));
      },
      offset(n: number) {
        const all = rowsFor(currentTable);
        if (isCountQuery) return Promise.resolve([{ count: all.slice(n).length }]);
        return wrap(all.slice(n));
      },
      orderBy() {
        const filtered = rowsFor(currentTable);
        if (isCountQuery) return Promise.resolve([{ count: filtered.length }]);
        return wrap(filtered);
      },
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
                if (val && typeof val === "object" && (val as Record<string, unknown>).__kind === "sql") {
                  const vObj = val as Record<string, unknown>;
                  const opStr = (vObj.strings as string[]).find((s: string) => s.includes("+") || s.includes("-")) ?? "";
                  const op = opStr.includes("+") ? "+" : "-";
                  const amount = Number((vObj.values as unknown[])[(vObj.values as unknown[]).length - 1]);
                  const current = Number(r[key]);
                  r[key] = (op === "+" ? current + amount : current - amount).toFixed(2);
                } else if (val !== undefined) {
                  r[key] = val;
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
    select: (proj?: unknown) => selectBuilder(proj),
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
        return Promise.resolve([{ insertId: 1 }]);
      },
    }),
    update: (ref: unknown) => updateBuilder(tableOf(ref)),
    delete: (ref: unknown) => ({
      where: (cond: unknown) => {
        const table = tableOf(ref);
        const rows = rowsFor(table);
        const keep = rows.filter((r) => !evalCond(r, cond));
        if (table === "orders") ordersTable = keep;
        if (table === "orderItems") orderItemsTable = keep;
        return Promise.resolve();
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };

  return db;
}

let mockDb: ReturnType<typeof makeMockDb>;
vi.mock("../queries/connection", () => ({
  getDb: () => mockDb,
}));

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

describe("warehouse.adjustStock", () => {
  it("increases currentStock and available for type 'in'", async () => {
    const { warehouseRouter } = await import("../warehouse-router");
    const caller = warehouseRouter.createCaller(makeCtx(1, 1, "operator"));
    await caller.adjustStock({ productId: 1, quantity: "50", type: "in", notes: "Restock" });

    const stock = stockTable.find(s => s.productId === 1 && s.tenantId === 1)!;
    expect(stock.currentStock).toBe("150.00");
    expect(stock.available).toBe("150.00");
  });

  it("decreases currentStock and available for type 'out'", async () => {
    const { warehouseRouter } = await import("../warehouse-router");
    const caller = warehouseRouter.createCaller(makeCtx(1, 1, "operator"));
    await caller.adjustStock({ productId: 1, quantity: "30", type: "out", notes: "Manual out" });

    const stock = stockTable.find(s => s.productId === 1 && s.tenantId === 1)!;
    expect(stock.currentStock).toBe("70.00");
    expect(stock.available).toBe("70.00");
  });

  it("sets currentStock to exact value for type 'adjustment'", async () => {
    const { warehouseRouter } = await import("../warehouse-router");
    const caller = warehouseRouter.createCaller(makeCtx(1, 1, "operator"));
    await caller.adjustStock({ productId: 1, quantity: "200", type: "adjustment" });

    const stock = stockTable.find(s => s.productId === 1 && s.tenantId === 1)!;
    expect(stock.currentStock).toBe("200");
  });

  it("creates stock movement record with type, quantity, notes", async () => {
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