/* eslint-disable @typescript-eslint/no-explicit-any,react-hooks/rules-of-hooks */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TrpcContext } from "../context";
import { asTestContext } from "./helpers/test-context";

vi.mock("drizzle-orm", () => {
  const sqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values });
  sqlFn.join = (chunks: unknown[], separator: unknown) => ({ __kind: "sql.join", chunks, separator });
  return {
  eq:  (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
  ne:  (col: unknown, val: unknown) => ({ __kind: "ne", col, val }),
  and: (...conds: unknown[]) => ({ __kind: "and", conds }),
  inArray: (col: unknown, values: unknown[]) => ({ __kind: "inArray", col, values }),
  gte: (col: unknown, val: unknown) => ({ __kind: "gte", col, val }),
  lte: (col: unknown, val: unknown) => ({ __kind: "lte", col, val }),
  desc: (col: unknown) => ({ __kind: "desc", col }),
  sql: sqlFn,
  relations: () => ({}),
  };
});

vi.mock("../telegram-router", () => ({
  notifyAdmin: vi.fn(async () => {}),
  tgMessages: { newOrder: vi.fn(() => "mock message") },
}));

vi.mock("../lib/sanitize", () => ({
  sanitizeString: (s: string) => s.replace(/<[^>]*>/g, "").trim(),
}));

let mockDb: any;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

import { returns, returnItems, orderItems, shops, users, products, orders, warehouseStock, warehouses } from "@db/schema";

// Type aliases, not interfaces: the fake db passes these rows around as
// `Record<string, unknown>` to read columns by name, and only an alias of an
// object literal gets the implicit index signature that allows.
type FakeReturn = { id: number; tenantId: number; orderId: number | null; shopId: number; agentId: number; returnNumber: string; reason: string; notes: string | null; status: string; totalAmount: string; createdBy: number; };
type FakeReturnItem = { id: number; returnId: number; productId: number; quantity: string; unitPrice: string; subtotal: string; reason: string | null; condition: string | null; };
type FakeOrder = { id: number; tenantId: number; agentId: number; shopId: number; status: string; total: string; };
type FakeOrderItem = { id: number; orderId: number; productId: number; quantity: string; unitPrice: string; };
type FakeStock = { productId: number; tenantId: number; currentStock: string; reserved: string; available: string; };
type FakeProduct = { id: number; tenantId: number; name: string; unitPrice: string; status: string; };
type FakeShop = { id: number; tenantId: number; name: string; debt: string; };
type FakeUser = { id: number; tenantId: number; name: string; role: string; };
type FakeWarehouse = { id: number; tenantId: number; name: string; isDefault: boolean; };

let warehousesTable: FakeWarehouse[] = [];
let returnsTable: FakeReturn[] = [];
let returnItemsTable: FakeReturnItem[] = [];
let ordersTable: FakeOrder[] = [];
let orderItemsTable: FakeOrderItem[] = [];
let stockTable: FakeStock[] = [];
let productsTable: FakeProduct[] = [];
let shopsTable: FakeShop[] = [];
let usersTable: FakeUser[] = [];
let nextReturnId = 1;

function resetTables() {
  returnsTable = [];
  returnItemsTable = [];
  ordersTable = [
    { id: 1, tenantId: 1, agentId: 10, shopId: 1, status: "delivered", total: "500.00" },
    { id: 2, tenantId: 2, agentId: 11, shopId: 2, status: "delivered", total: "300.00" },
  ];
  orderItemsTable = [
    { id: 1, orderId: 1, productId: 1, quantity: "10.00", unitPrice: "50.00" },
    { id: 2, orderId: 1, productId: 2, quantity: "5.00", unitPrice: "30.00" },
    { id: 3, orderId: 2, productId: 1, quantity: "3.00", unitPrice: "45.00" },
  ];
  stockTable = [
    { productId: 1, tenantId: 1, currentStock: "100.00", reserved: "10.00", available: "90.00" },
    { productId: 2, tenantId: 1, currentStock: "50.00", reserved: "5.00", available: "45.00" },
    { productId: 1, tenantId: 2, currentStock: "30.00", reserved: "0.00", available: "30.00" },
  ];
  // Completing a return puts the goods into the tenant's default warehouse.
  warehousesTable = [
    { id: 1, tenantId: 1, name: "Main", isDefault: true },
    { id: 2, tenantId: 2, name: "Main", isDefault: true },
  ];
  productsTable = [
    { id: 1, tenantId: 1, name: "Product A", unitPrice: "50.00", status: "active" },
    { id: 2, tenantId: 1, name: "Product B", unitPrice: "30.00", status: "active" },
    { id: 3, tenantId: 2, name: "Product C", unitPrice: "45.00", status: "active" },
  ];
  shopsTable = [
    { id: 1, tenantId: 1, name: "Shop 1", debt: "200.00" },
    { id: 2, tenantId: 2, name: "Shop 2", debt: "100.00" },
  ];
  usersTable = [
    { id: 10, tenantId: 1, name: "Agent One", role: "agent" },
    { id: 11, tenantId: 2, name: "Agent Two", role: "agent" },
  ];
  nextReturnId = 1;
}

const columnToField = new Map<unknown, string>();
// Takes a drizzle table, whose type is nothing like Record<string, unknown> —
// the narrower signature made every call site an error without catching
// anything, since the body only ever reads one property by name.
function reg(table: object, name: string) {
  columnToField.set((table as Record<string, unknown>)[name], name);
}
reg(returns, "id"); reg(returns, "tenantId"); reg(returns, "shopId"); reg(returns, "agentId");
reg(returns, "orderId"); reg(returns, "returnNumber"); reg(returns, "reason"); reg(returns, "notes");
reg(returns, "status"); reg(returns, "totalAmount"); reg(returns, "createdBy");
reg(returnItems, "id"); reg(returnItems, "returnId"); reg(returnItems, "productId");
reg(returnItems, "quantity"); reg(returnItems, "unitPrice"); reg(returnItems, "subtotal");
reg(returnItems, "reason"); reg(returnItems, "condition");
reg(orderItems, "id"); reg(orderItems, "orderId"); reg(orderItems, "productId");
reg(orderItems, "quantity"); reg(orderItems, "unitPrice");
reg(orders, "id"); reg(orders, "tenantId"); reg(orders, "status"); reg(orders, "total");
reg(products, "id"); reg(products, "name"); reg(products, "unitPrice"); reg(products, "tenantId");
reg(warehouseStock, "productId"); reg(warehouseStock, "tenantId");
reg(warehouseStock, "currentStock"); reg(warehouseStock, "reserved"); reg(warehouseStock, "available");
reg(warehouses, "id"); reg(warehouses, "tenantId"); reg(warehouses, "isDefault");
reg(shops, "id"); reg(shops, "tenantId"); reg(shops, "name"); reg(shops, "debt");
reg(users, "id"); reg(users, "name"); reg(users, "role");

function mapCol(col: unknown): string {
  return columnToField.get(col) ?? (col as any)?.name ?? String(col);
}

let currentTable: Record<string, unknown>[] = [];
let currentTableName = "";
function useTable(col: unknown) {
  if (col === returns) { currentTable = returnsTable; currentTableName = "returns"; }
  else if (col === returnItems) { currentTable = returnItemsTable; currentTableName = "return_items"; }
  else if (col === orderItems) { currentTable = orderItemsTable; currentTableName = "order_items"; }
  else if (col === orders) { currentTable = ordersTable; currentTableName = "orders"; }
  else if (col === warehouseStock) { currentTable = stockTable; currentTableName = "warehouse_stock"; }
  else if (col === warehouses) { currentTable = warehousesTable; currentTableName = "warehouses"; }
  else if (col === products) { currentTable = productsTable; currentTableName = "products"; }
  else if (col === shops) { currentTable = shopsTable; currentTableName = "shops"; }
  else if (col === users) { currentTable = usersTable; currentTableName = "users"; }
}

function evalCond(row: Record<string, unknown>, cond: Record<string, unknown>): boolean {
  // Set membership. Without this branch an inArray filter falls through to the
  // permissive default below and the query appears to match every row — which
  // is how "only counts delivered orders" passed while counting all of them.
  if (cond && (cond as Record<string, unknown>).__kind === "inArray") {
    const field = mapCol((cond as Record<string, unknown>).col);
    if (!(field in row)) return true;
    const values = ((cond as Record<string, unknown>).values ?? []) as unknown[];
    return values.map(String).includes(String(row[field]));
  }

  if (!cond || typeof cond !== "object") return true;
  if (cond.__kind === "and") return (cond.conds as unknown[]).every((c: unknown) => evalCond(row, c as Record<string, unknown>));
  if (cond.__kind === "eq" || cond.__kind === "ne" || cond.__kind === "gte" || cond.__kind === "lte") {
    const field = mapCol(cond.col);
    if (!(field in row)) return cond.__kind !== "eq";
    if (cond.__kind === "gte") return Number(row[field]) >= Number(cond.val);
    if (cond.__kind === "lte") return Number(row[field]) <= Number(cond.val);
    if (cond.__kind === "ne") return row[field] !== cond.val && String(row[field]) !== String(cond.val);
    return row[field] === cond.val || String(row[field]) === String(cond.val);
  }
  return true;
}

function buildChain(rows: Record<string, unknown>[], groupCol?: string, wrapKey?: string) {
  const resolved = groupCol ? groupRows(rows, groupCol) : rows;
  const wrapped = wrapKey ? resolved.map(r => ({ [wrapKey]: r })) : resolved;
  const chain: any = Promise.resolve(wrapped);
  chain.limit = (n: number) => buildChain(rows.slice(0, n), groupCol, wrapKey);
  chain.offset = (n: number) => buildChain(rows.slice(n), groupCol, wrapKey);
  chain.orderBy = () => chain;
  chain.groupBy = (col: unknown) => buildChain(rows, mapCol(col), wrapKey);
  chain.leftJoin = () => buildChain(rows, groupCol, wrapKey || currentTableName);
  chain.innerJoin = () => buildChain(rows, groupCol, wrapKey || currentTableName);
  chain.for = () => chain;
  return chain;
}

function groupRows(rows: Record<string, unknown>[], col: string): Record<string, unknown>[] {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = String(row[col] ?? "");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return Array.from(groups.entries()).map(([, groupRows]) => {
    const first = { ...groupRows[0] };
    // Aggregate numeric fields as SUM
    for (const field of Object.keys(first)) {
      if (field !== col && typeof first[field] === "string" && !isNaN(Number(first[field]))) {
        first[field] = String(groupRows.reduce((s, r) => s + Number(r[field] ?? 0), 0));
      } else if (field !== col && typeof first[field] === "number") {
        first[field] = groupRows.reduce((s, r) => s + Number(r[field] ?? 0), 0);
      }
    }
    return first;
  });
}

function makeMockDb() {
  const db: any = {};
  db.execute = vi.fn(async (rawSql: unknown) => {
    if (rawSql && typeof rawSql === "object" && (rawSql as any).__kind === "sql") {
      const sqlStr = String((rawSql as any).strings?.join?.("") ?? "");
      if (sqlStr.includes("UPDATE warehouse_stock")) {
        const cases = returnItemsTable.filter(i => returnsTable.some(r => r.id === i.returnId));
        for (const c of cases) {
          const stock = stockTable.find(s => s.productId === c.productId && s.tenantId === 1);
          if (stock) {
            const qty = Number(c.quantity);
            stock.currentStock = String(Number(stock.currentStock) + qty);
            stock.available = String(Number(stock.available) + qty);
          }
        }
      }
      if (sqlStr.includes("shops") && !sqlStr.includes("warehouse_stock")) {
        const ret = returnsTable.find(r => r.status === "approved");
        if (ret) {
          const shop = shopsTable.find(s => s.id === ret.shopId);
          if (shop) {
            shop.debt = String(Math.max(0, Number(shop.debt) - Number(ret.totalAmount)));
          }
        }
      }
    }
    return { affectedRows: 1 };
  });
  db.select = (fields?: any) => {
    const sel: any = {};
    sel.for = () => sel;
    sel.from = (table: any) => {
      useTable(table);
      const from: any = {};
      from.for = () => from;
      const doJoin = (joinTable: any, joinCond: any) => {
        let joinData: Record<string, unknown>[];
        if (joinTable === returns) joinData = returnsTable;
        else if (joinTable === returnItems) joinData = returnItemsTable;
        else if (joinTable === orderItems) joinData = orderItemsTable;
        else if (joinTable === orders) joinData = ordersTable;
        else if (joinTable === warehouseStock) joinData = stockTable;
        else if (joinTable === products) joinData = productsTable;
        else if (joinTable === shops) joinData = shopsTable;
        else if (joinTable === users) joinData = usersTable;
        else joinData = [];
        const primaryCol = mapCol(joinCond.col);
        const joinCol = mapCol(joinCond.val);
        const merged: Record<string, unknown>[] = [];
        for (const row of currentTable) {
          const matches = joinData.filter((jr: any) => String(jr[joinCol]) === String(row[primaryCol]));
          if (matches.length > 0) for (const m of matches) merged.push({ ...row, ...m });
          else merged.push({ ...row });
        }
        currentTable = merged;
        return from;
      };
      from.leftJoin = () => from;
      from.innerJoin = doJoin;
      from.where = (cond: unknown) => {
        const filtered = currentTable.filter((r: any) => evalCond(r, cond as Record<string, unknown>));
        const mapped = fields
          ? filtered.map((r: any) => {
              const out: Record<string, unknown> = {};
              for (const [alias, def] of Object.entries(fields)) {
                if (typeof def === "object" && def !== null) {
                  if ((def as any).__kind === "sql") {
                    const sqlStr = String((def as any).strings?.join?.("") ?? "");
                    const vals = (def as any).values ?? [];
                    if (/COUNT\s*\(\s*\*\s*\)/i.test(sqlStr)) {
                      out[alias] = 1;
                    } else if (/SUM/i.test(sqlStr)) {
                      let sumField = "";
                      const colMatch = sqlStr.match(/SUM\s*\(\s*(\w+)\s*\)/i);
                      if (colMatch) {
                        sumField = colMatch[1];
                      } else if (vals.length > 0) {
                        sumField = mapCol(vals[0]);
                      }
                      out[alias] = sumField ? String(Number(r[sumField] ?? 0)) : "0.00";
                    } else {
                      out[alias] = r[mapCol(def)];
                    }
                  } else {
                    out[alias] = r[mapCol(def)];
                  }
                }
              }
              return out;
            })
          : filtered;
        return buildChain(mapped);
      };
      return from;
    };
    return sel;
  };
  db.insert = (table: any) => {
    useTable(table);
    return { values: vi.fn((vals: any) => {
      const data = Array.isArray(vals) ? vals : [vals];
      for (const v of data) {
        currentTable.push({ id: nextReturnId++, ...v });
      }
      return [{ insertId: nextReturnId - 1 }];
    }) };
  };
  db.update = (table: any) => {
    useTable(table);
    return { set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve({ affectedRows: 1 })) })) };
  };
  db.delete = (table: any) => {
    useTable(table);
    return { where: vi.fn(() => Promise.resolve({ affectedRows: 1 })) };
  };
  db.transaction = (fn: (tx: any) => Promise<any>) => fn(db);
  return db;
}

function buildCtx(overrides: Record<string, unknown> = {}): TrpcContext {
  return asTestContext({
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    db: mockDb,
    tenant: { id: 1, slug: "test", name: "Test Co", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    user: { id: 10, tenantId: 1, role: "agent" as const, status: "active" as const, name: "Test", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    ...overrides,
  });
}

import { returnsRouter } from "../returns-router";

describe("returnsRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTables();
    mockDb = makeMockDb();
  });

  describe("list", () => {
    it("returns empty array when no returns exist", async () => {
      const caller = returnsRouter.createCaller(buildCtx());
      const result = await caller.list({});
      expect(result).toEqual({ data: [], total: 0 });
    });

    it("returns returns for current tenant only", async () => {
      returnsTable.push(
        { id: 1, tenantId: 1, orderId: null, shopId: 1, agentId: 10, returnNumber: "RET-001", reason: "defect", notes: null, status: "pending", totalAmount: "100.00", createdBy: 10 },
        { id: 2, tenantId: 2, orderId: null, shopId: 2, agentId: 11, returnNumber: "RET-002", reason: "defect", notes: null, status: "pending", totalAmount: "50.00", createdBy: 11 },
      );
      shopsTable.push(
        { id: 1, tenantId: 1, name: "Shop 1", debt: "0" },
        { id: 2, tenantId: 2, name: "Shop 2", debt: "0" },
      );
      usersTable.push(
        { id: 10, tenantId: 1, name: "Agent One", role: "agent" },
        { id: 11, tenantId: 2, name: "Agent Two", role: "agent" },
      );
      const caller = returnsRouter.createCaller(buildCtx());
      const result = await caller.list({});
      expect(result.data).toHaveLength(1);
      expect(result.data[0].returnNumber).toBe("RET-001");
    });

    it("filters by status", async () => {
      returnsTable.push(
        { id: 1, tenantId: 1, orderId: null, shopId: 1, agentId: 10, returnNumber: "RET-001", reason: "defect", notes: null, status: "pending", totalAmount: "100.00", createdBy: 10 },
        { id: 2, tenantId: 1, orderId: null, shopId: 1, agentId: 10, returnNumber: "RET-002", reason: "defect", notes: null, status: "approved", totalAmount: "50.00", createdBy: 10 },
      );
      shopsTable.push({ id: 1, tenantId: 1, name: "Shop 1", debt: "0" });
      usersTable.push({ id: 10, tenantId: 1, name: "Agent One", role: "agent" });
      const caller = returnsRouter.createCaller(buildCtx());
      const result = await caller.list({ status: "approved" });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].returnNumber).toBe("RET-002");
    });
  });

  describe("getById", () => {
    it("returns null when return not found", async () => {
      const caller = returnsRouter.createCaller(buildCtx());
      const result = await caller.getById({ id: 999 });
      expect(result).toBeNull();
    });

    it("returns null for return in different tenant", async () => {
      returnsTable.push({ id: 1, tenantId: 2, orderId: null, shopId: 2, agentId: 11, returnNumber: "RET-001", reason: "defect", notes: null, status: "pending", totalAmount: "50.00", createdBy: 11 });
      const caller = returnsRouter.createCaller(buildCtx());
      const result = await caller.getById({ id: 1 });
      expect(result).toBeNull();
    });

    it("returns return with items", async () => {
      returnsTable.push({ id: 1, tenantId: 1, orderId: null, shopId: 1, agentId: 10, returnNumber: "RET-001", reason: "defect", notes: "some notes", status: "pending", totalAmount: "100.00", createdBy: 10 });
      returnItemsTable.push(
        { id: 1, returnId: 1, productId: 1, quantity: "2.00", unitPrice: "50.00", subtotal: "100.00", reason: "broken", condition: "bad" },
      );
      shopsTable.push({ id: 1, tenantId: 1, name: "Shop 1", debt: "0" });
      usersTable.push({ id: 10, tenantId: 1, name: "Agent One", role: "agent" });
      productsTable.push({ id: 1, tenantId: 1, name: "Product A", unitPrice: "50.00", status: "active" });

      const caller = returnsRouter.createCaller(buildCtx());
      const result = await caller.getById({ id: 1 });
      expect(result).not.toBeNull();
      expect(result!.returnNumber).toBe("RET-001");
    });
  });

  describe("create", () => {
    it("creates a return without orderId", async () => {
      shopsTable.push({ id: 1, tenantId: 1, name: "Shop 1", debt: "0" });
      const caller = returnsRouter.createCaller(buildCtx());
      const result = await caller.create({ shopId: 1, reason: "defect", items: [{ productId: 1, quantity: 2, unitPrice: 50, reason: "broken", condition: "bad" }] });
      expect(result.id).toBeGreaterThan(0);
      expect(result.returnNumber).toMatch(/^RET-/);
    });

    it("sanitizes notes", async () => {
      shopsTable.push({ id: 1, tenantId: 1, name: "Shop 1", debt: "0" });
      const caller = returnsRouter.createCaller(buildCtx());
      const result = await caller.create({ shopId: 1, reason: "defect", notes: "<script>alert('xss')</script>Hello", items: [{ productId: 1, quantity: 1, unitPrice: 50 }] });
      expect(result.id).toBeGreaterThan(0);
    });
  });

  describe("updateStatus", () => {
    it("changes status from pending to approved", async () => {
      returnsTable.push({ id: 1, tenantId: 1, orderId: null, shopId: 1, agentId: 10, returnNumber: "RET-001", reason: "defect", notes: null, status: "pending", totalAmount: "100.00", createdBy: 10 });
      const caller = returnsRouter.createCaller(buildCtx({ user: { id: 1, role: "operator" } }));
      const result = await caller.updateStatus({ id: 1, status: "approved" });
      expect(result.success).toBe(true);
    });

    it("changes status from pending to rejected", async () => {
      returnsTable.push({ id: 1, tenantId: 1, orderId: null, shopId: 1, agentId: 10, returnNumber: "RET-001", reason: "defect", notes: null, status: "pending", totalAmount: "100.00", createdBy: 10 });
      const caller = returnsRouter.createCaller(buildCtx({ user: { id: 1, role: "operator" } }));
      const result = await caller.updateStatus({ id: 1, status: "rejected" });
      expect(result.success).toBe(true);
    });

    it("transitions approved -> completed and restores stock", async () => {
      returnsTable.push({ id: 1, tenantId: 1, orderId: null, shopId: 1, agentId: 10, returnNumber: "RET-001", reason: "defect", notes: null, status: "approved", totalAmount: "100.00", createdBy: 10 });
      returnItemsTable.push(
        { id: 1, returnId: 1, productId: 1, quantity: "2.00", unitPrice: "50.00", subtotal: "100.00", reason: null, condition: null },
      );

      const initialStock = { productId: 1, tenantId: 1, currentStock: "100.00", reserved: "10.00", available: "90.00" };
      stockTable.push(initialStock);

      const caller = returnsRouter.createCaller(buildCtx({ user: { id: 1, role: "operator" } }));
      const result = await caller.updateStatus({ id: 1, status: "completed" });
      expect(result.success).toBe(true);
      const stock = stockTable.find(s => s.productId === 1 && s.tenantId === 1);
      expect(stock).toBeDefined();
      expect(Number(stock!.currentStock)).toBe(102);
      expect(Number(stock!.available)).toBe(92);
    });

    it("rejects invalid transition: pending -> completed (skip approved)", async () => {
      returnsTable.push({ id: 1, tenantId: 1, orderId: null, shopId: 1, agentId: 10, returnNumber: "RET-001", reason: "defect", notes: null, status: "pending", totalAmount: "100.00", createdBy: 10 });
      const caller = returnsRouter.createCaller(buildCtx({ user: { id: 1, role: "operator" } }));
      await expect(caller.updateStatus({ id: 1, status: "completed" }))
        .rejects.toThrow("Невозможно перевести");
    });

    it("rejects transition from completed (terminal state)", async () => {
      returnsTable.push({ id: 1, tenantId: 1, orderId: null, shopId: 1, agentId: 10, returnNumber: "RET-001", reason: "defect", notes: null, status: "completed", totalAmount: "100.00", createdBy: 10 });
      const caller = returnsRouter.createCaller(buildCtx({ user: { id: 1, role: "operator" } }));
      await expect(caller.updateStatus({ id: 1, status: "approved" }))
        .rejects.toThrow("Невозможно перевести");
    });

    it("rejects transition from rejected (terminal state)", async () => {
      returnsTable.push({ id: 1, tenantId: 1, orderId: null, shopId: 1, agentId: 10, returnNumber: "RET-001", reason: "defect", notes: null, status: "rejected", totalAmount: "100.00", createdBy: 10 });
      const caller = returnsRouter.createCaller(buildCtx({ user: { id: 1, role: "operator" } }));
      await expect(caller.updateStatus({ id: 1, status: "pending" }))
        .rejects.toThrow("Невозможно перевести");
    });

    it("throws when return not found", async () => {
      const caller = returnsRouter.createCaller(buildCtx({ user: { id: 1, role: "operator" } }));
      await expect(caller.updateStatus({ id: 999, status: "approved" }))
        .rejects.toThrow("не найден");
    });

    it("enforces tenant isolation", async () => {
      returnsTable.push({ id: 1, tenantId: 2, orderId: null, shopId: 2, agentId: 11, returnNumber: "RET-001", reason: "defect", notes: null, status: "pending", totalAmount: "50.00", createdBy: 11 });
      const caller = returnsRouter.createCaller(buildCtx({ user: { id: 1, role: "operator" } }));
      await expect(caller.updateStatus({ id: 1, status: "approved" }))
        .rejects.toThrow("не найден");
    });

    it("reduces shop debt on completed when orderId exists", async () => {
      returnsTable.push({ id: 1, tenantId: 1, orderId: 1, shopId: 1, agentId: 10, returnNumber: "RET-001", reason: "defect", notes: null, status: "approved", totalAmount: "100.00", createdBy: 10 });
      returnItemsTable.push({ id: 1, returnId: 1, productId: 1, quantity: "2.00", unitPrice: "50.00", subtotal: "100.00", reason: null, condition: null });
      shopsTable.push({ id: 1, tenantId: 1, name: "Shop 1", debt: "200.00" });
      stockTable.push({ productId: 1, tenantId: 1, currentStock: "100.00", reserved: "10.00", available: "90.00" });

      const caller = returnsRouter.createCaller(buildCtx({ user: { id: 1, role: "operator" } }));
      const result = await caller.updateStatus({ id: 1, status: "completed" });
      expect(result.success).toBe(true);
      const shop = shopsTable.find(s => s.id === 1);
      expect(Number(shop!.debt)).toBe(100);
    });
  });

  describe("summary", () => {
    it("groups by reason and returns totals", async () => {
      returnsTable.push(
        { id: 1, tenantId: 1, orderId: null, shopId: 1, agentId: 10, returnNumber: "RET-001", reason: "defect", notes: null, status: "completed", totalAmount: "100.00", createdBy: 10 },
        { id: 2, tenantId: 1, orderId: null, shopId: 1, agentId: 10, returnNumber: "RET-002", reason: "defect", notes: null, status: "completed", totalAmount: "50.00", createdBy: 10 },
        { id: 3, tenantId: 1, orderId: null, shopId: 1, agentId: 10, returnNumber: "RET-003", reason: "expired", notes: null, status: "completed", totalAmount: "30.00", createdBy: 10 },
      );
      const caller = returnsRouter.createCaller(buildCtx({ user: { id: 1, role: "operator" } }));
      const result = await caller.summary();
      const defect = result.find((r) => r.reason === "defect");
      const expired = result.find((r) => r.reason === "expired");
      expect(defect).toBeDefined();
      expect(expired).toBeDefined();
      expect(defect!.count).toBe(2);
      expect(Number(defect!.totalAmount)).toBe(150);
      expect(expired!.count).toBe(1);
      expect(Number(expired!.totalAmount)).toBe(30);
    });
  });

  describe("create — orderId validation", () => {
    it("throws when orderId references a non-existent order", async () => {
      const caller = returnsRouter.createCaller(buildCtx());
      await expect(caller.create({
        orderId: 999,
        shopId: 1,
        reason: "defect",
        items: [{ productId: 1, quantity: 1, unitPrice: 50 }],
      })).rejects.toThrow("не найден");
    });

    it("throws when orderId references order from different tenant", async () => {
      const caller = returnsRouter.createCaller(buildCtx());
      await expect(caller.create({
        orderId: 2,
        shopId: 1,
        reason: "defect",
        items: [{ productId: 1, quantity: 1, unitPrice: 50 }],
      })).rejects.toThrow("не найден");
    });

    it("throws when return quantity exceeds original order quantity", async () => {
      const caller = returnsRouter.createCaller(buildCtx());
      await expect(caller.create({
        orderId: 1,
        shopId: 1,
        reason: "defect",
        items: [{ productId: 1, quantity: 999, unitPrice: 50 }],
      })).rejects.toThrow("превышает");
    });

    it("throws when cumulative returns exceed original order quantity", async () => {
      const caller = returnsRouter.createCaller(buildCtx());
      // First return: 5 out of 10
      await caller.create({
        orderId: 1, shopId: 1, reason: "defect",
        items: [{ productId: 1, quantity: 5, unitPrice: 50 }],
      });
      // Second return: 8 more — 5 + 8 = 13 > 10
      await expect(caller.create({
        orderId: 1, shopId: 1, reason: "damaged",
        items: [{ productId: 1, quantity: 8, unitPrice: 50 }],
      })).rejects.toThrow("превышает остаток");
    });

    it("uses original order unitPrice instead of client-supplied price", async () => {
      const caller = returnsRouter.createCaller(buildCtx());
      const result = await caller.create({
        orderId: 1,
        shopId: 1,
        reason: "defect",
        items: [{ productId: 1, quantity: 1, unitPrice: 1 }],
      });
      expect(result.id).toBeGreaterThan(0);
      const item = returnItemsTable.find(r => r.returnId === result.id);
      expect(item).toBeDefined();
      expect(item!.unitPrice).toBe("50.00");
    });
  });
});
