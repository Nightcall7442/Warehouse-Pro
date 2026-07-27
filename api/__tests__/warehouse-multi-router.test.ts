/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", () => {
  const sqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values, rawStrings: strings, rawValues: values });
  return {
    eq: (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
    and: (...conds: unknown[]) => ({ __kind: "and", conds }),
    desc: (col: unknown) => ({ __kind: "desc", col }),
    sql: sqlFn,
    relations: () => ({}),
  };
});

vi.mock("../lib/cache", () => ({
  cache: { get: () => undefined, set: () => {}, invalidate: () => {}, invalidatePrefix: () => {} },
  CacheKeys: { dashboardKpis: () => "", commissions: () => "" },
  CacheTTL: { commissions: 60, kpis: 60 },
}));

let mockDb: any;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

import { warehouses, warehouseStock, stockTransfers, products } from "@db/schema";

let warehousesTable: any[] = [];
let warehouseStockTable: any[] = [];
let stockTransfersTable: any[] = [];
let productsTable: any[] = [];
let nextId = 400;

function resetTables() {
  warehousesTable = [
    { id: 1, tenantId: 1, name: "Main Warehouse", isDefault: true, status: "active", address: null, city: null, createdAt: new Date() },
    { id: 2, tenantId: 1, name: "Secondary", isDefault: false, status: "active", address: null, city: null, createdAt: new Date() },
  ];
  warehouseStockTable = [
    { id: 10, tenantId: 1, warehouseId: 1, productId: 1, currentStock: "100.00", reserved: "5.00", available: "95.00" },
    { id: 11, tenantId: 1, warehouseId: 1, productId: 2, currentStock: "50.00", reserved: "0.00", available: "50.00" },
    { id: 12, tenantId: 1, warehouseId: 2, productId: 1, currentStock: "30.00", reserved: "0.00", available: "30.00" },
  ];
  stockTransfersTable = [];
  productsTable = [
    { id: 1, name: "Tomato", code: "T001", tenantId: 1 },
    { id: 2, name: "Cucumber", code: "C001", tenantId: 1 },
  ];
  nextId = 400;
}

const colToField = new Map<unknown, string>();
function reg(table: Record<string, unknown>, name: string) { colToField.set(table[name], name); }
reg(warehouses, "id"); reg(warehouses, "tenantId"); reg(warehouses, "name");
reg(warehouses, "isDefault"); reg(warehouses, "status"); reg(warehouses, "address"); reg(warehouses, "city"); reg(warehouses, "createdAt");
reg(warehouseStock, "id"); reg(warehouseStock, "tenantId"); reg(warehouseStock, "warehouseId");
reg(warehouseStock, "productId"); reg(warehouseStock, "currentStock"); reg(warehouseStock, "reserved"); reg(warehouseStock, "available");
reg(stockTransfers, "id"); reg(stockTransfers, "tenantId"); reg(stockTransfers, "fromWarehouseId");
reg(stockTransfers, "toWarehouseId"); reg(stockTransfers, "productId"); reg(stockTransfers, "quantity");
reg(stockTransfers, "status"); reg(stockTransfers, "notes"); reg(stockTransfers, "createdBy");
reg(stockTransfers, "createdAt"); reg(stockTransfers, "completedAt");
reg(products, "id"); reg(products, "name"); reg(products, "code"); reg(products, "tenantId"); reg(products, "status");

function mapCol(col: unknown): string { return colToField.get(col) ?? (col as any)?.name ?? String(col); }

function evalCond(row: Record<string, unknown>, cond: unknown): boolean {
  if (!cond || typeof cond !== "object") return true;
  const c = cond as Record<string, unknown>;
  if (c.__kind === "and") return (c.conds as unknown[]).every((x: unknown) => evalCond(row, x));
  if (c.__kind === "eq") { const f = mapCol(c.col); return !(f in row) || row[f] === c.val || String(row[f]) === String(c.val); }
  return true;
}

function buildChain(rows: Record<string, unknown>[]) {
  const chain: any = Promise.resolve(rows);
  chain.limit = (n: number) => buildChain(rows.slice(0, n));
  chain.orderBy = () => chain;
  chain.where = (cond: unknown) => buildChain(rows.filter(r => evalCond(r, cond)));
  chain.leftJoin = () => chain;
  chain.innerJoin = () => chain;
  chain.groupBy = () => chain;
  chain.for = () => chain;
  return chain;
}

function useTable(col: unknown): Record<string, unknown>[] {
  if (col === warehouses) return warehousesTable;
  if (col === warehouseStock) return warehouseStockTable;
  if (col === stockTransfers) return stockTransfersTable;
  if (col === products) return productsTable;
  return [];
}

function makeMockDb() {
  const db: any = {};
  db.select = (fields?: any) => {
    const sel: any = {};
    sel.from = (table: any) => {
      const primaryRows = useTable(table);
      const joins: any[] = [];
      const from: any = {};
      from.leftJoin = (joinTable: any, joinCond: any) => {
        if (joinCond?.__kind === "eq") joins.push({ table: useTable(joinTable), primaryCol: mapCol(joinCond.col), joinCol: mapCol(joinCond.val) });
        return from;
      };
      from.innerJoin = from.leftJoin;
      from.where = (cond: unknown) => {
        let filtered = primaryRows.filter((r: any) => evalCond(r, cond));
        for (const join of joins) {
          const expanded: Record<string, unknown>[] = [];
          for (const row of filtered) {
            const matches = join.table.filter((jr: any) => String(jr[join.joinCol]) === String(row[join.primaryCol]));
            if (matches.length === 0) expanded.push({ ...row });
            else for (const m of matches) expanded.push({ ...row, ...m });
          }
          filtered = expanded;
        }
        return buildChain(filtered);
      };
      from.then = (resolve: any, reject: any) => {
        let rows = [...primaryRows];
        for (const join of joins) {
          const expanded: Record<string, unknown>[] = [];
          for (const row of rows) {
            const matches = join.table.filter((jr: any) => String(jr[join.joinCol]) === String(row[join.primaryCol]));
            if (matches.length === 0) expanded.push({ ...row });
            else for (const m of matches) expanded.push({ ...row, ...m });
          }
          rows = expanded;
        }
        if (fields && typeof fields === "object" && !Array.isArray(fields)) {
          return Promise.resolve(rows.map(row => {
            const out: Record<string, unknown> = {};
            for (const [alias, def] of Object.entries(fields)) {
              if (typeof def === "object" && def !== null && (def as any).__kind === "count") out[alias] = rows.length;
              else if (typeof def === "object" && def !== null && (def as any).__kind === "sum") {
                const f = mapCol((def as any).col);
                out[alias] = String(rows.reduce((s, r) => s + Number(r[f] ?? 0), 0));
              } else out[alias] = row[mapCol(def)] ?? null;
            }
            return out;
          })).then(resolve, reject);
        }
        return Promise.resolve(rows).then(resolve, reject);
      };
      from.limit = (n: number) => buildChain(primaryRows.slice(0, n));
      from.orderBy = () => from;
      from.groupBy = () => from;
      return from;
    };
    return sel;
  };
  db.insert = (table: any) => ({
    values: vi.fn((vals: any) => {
      const id = nextId++;
      if (table === warehouses) warehousesTable.push({ id, ...vals, createdAt: new Date() });
      else if (table === warehouseStock) warehouseStockTable.push({ id, ...vals });
      else if (table === stockTransfers) stockTransfersTable.push({ id, ...vals, createdAt: new Date() });
      return [{ insertId: id }];
    }),
  });
  db.update = (table: any) => ({
    set: (patch: Record<string, unknown>) => ({
      where: (cond: unknown) => {
        const tbl = table === warehouses ? warehousesTable : table === warehouseStock ? warehouseStockTable : table === stockTransfers ? stockTransfersTable : [];
        let affected = 0;
        for (const row of tbl) {
          if (!evalCond(row, cond)) continue;
          Object.assign(row, patch);
          affected++;
        }
        return Promise.resolve([{ affectedRows: affected }]);
      },
    }),
  });
  db.execute = (sqlObj: any) => {
    if (sqlObj?.__kind === "sql") {
      const fullSql = sqlObj.rawStrings.join("");
      if (fullSql.includes("warehouse_stock") && fullSql.includes("SUM")) {
        return Promise.resolve([{
          totalSKUs: "2",
          totalWeight: "0",
          lowStockCount: "0",
        }]);
      }
      if (fullSql.includes("warehouse_stock") && fullSql.includes("LEFT JOIN")) {
        return Promise.resolve([{
          id: 10, productId: 1, currentStock: "100.00", reserved: "5.00", available: "95.00",
          productName: "Tomato", productCode: "T001", category: null, unit: "kg",
          unitWeight: "1.00", unitPrice: "12000.00", costPrice: "8500.00", reorderPoint: "10",
        }]);
      }
      if (fullSql.includes("COUNT(*)") && fullSql.includes("products")) {
        return Promise.resolve([{ cnt: "1" }]);
      }
      if (fullSql.includes("INSERT INTO warehouse_stock")) {
        const vals = sqlObj.rawValues;
        warehouseStockTable.push({
          id: nextId++, tenantId: vals[0], warehouseId: vals[1], productId: vals[2],
          currentStock: vals[3], reserved: vals[4] ?? "0.00", available: vals[5] ?? vals[3],
        });
        return Promise.resolve([]);
      }
    }
    return Promise.resolve([]);
  };
  db.transaction = (fn: (tx: any) => Promise<any>) => fn(db);
  return db;
}

function buildCtx(overrides: Record<string, unknown> = {}) {
  return {
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    db: mockDb,
    tenant: { id: 1, slug: "test", name: "Test Org", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    user: { id: 10, tenantId: 1, role: "ceo" as const, status: "active" as const, name: "CEO", email: "ceo@test.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    ...overrides,
  };
}

function agentCtx() {
  return buildCtx({
    user: { id: 20, tenantId: 1, role: "agent" as const, status: "active" as const, name: "Agent", email: "agent@test.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
  });
}

beforeEach(() => {
  resetTables();
  mockDb = makeMockDb();
});

describe("warehouseMulti.list", () => {
  it("returns all warehouses for tenant", async () => {
    const { warehouseMultiRouter } = await import("../warehouse-multi-router");
    const caller = warehouseMultiRouter.createCaller(buildCtx());
    const result = await caller.list();
    expect(result.length).toBe(2);
    expect(result.every((w: any) => w.tenantId === 1)).toBe(true);
  });

  it("works for agent role", async () => {
    const { warehouseMultiRouter } = await import("../warehouse-multi-router");
    const caller = warehouseMultiRouter.createCaller(agentCtx());
    const result = await caller.list();
    expect(result.length).toBe(2);
  });
});

describe("warehouseMulti.create", () => {
  it("creates a new warehouse", async () => {
    const { warehouseMultiRouter } = await import("../warehouse-multi-router");
    const caller = warehouseMultiRouter.createCaller(buildCtx());
    const result = await caller.create({ name: "New Warehouse", city: "Tashkent" });
    expect(result.id).toBeDefined();
    expect(warehousesTable.some(w => w.name === "New Warehouse" && w.tenantId === 1)).toBe(true);
  });

  it("sets optional address", async () => {
    const { warehouseMultiRouter } = await import("../warehouse-multi-router");
    const caller = warehouseMultiRouter.createCaller(buildCtx());
    await caller.create({ name: "Addr WH", address: "123 Main St" });
    const wh = warehousesTable.find(w => w.name === "Addr WH");
    expect(wh?.address).toBe("123 Main St");
  });
});

describe("warehouseMulti.update", () => {
  it("updates warehouse name and city", async () => {
    const { warehouseMultiRouter } = await import("../warehouse-multi-router");
    const caller = warehouseMultiRouter.createCaller(buildCtx());
    const result = await caller.update({ id: 1, name: "Renamed", city: "Samarkand" });
    expect(result.success).toBe(true);
    expect(warehousesTable.find(w => w.id === 1)?.name).toBe("Renamed");
    expect(warehousesTable.find(w => w.id === 1)?.city).toBe("Samarkand");
  });

  it("can set warehouse inactive", async () => {
    const { warehouseMultiRouter } = await import("../warehouse-multi-router");
    const caller = warehouseMultiRouter.createCaller(buildCtx());
    await caller.update({ id: 2, status: "inactive" });
    expect(warehousesTable.find(w => w.id === 2)?.status).toBe("inactive");
  });
});

describe("warehouseMulti.setDefault", () => {
  it("sets target as default and resets others", async () => {
    const { warehouseMultiRouter } = await import("../warehouse-multi-router");
    const caller = warehouseMultiRouter.createCaller(buildCtx());
    const result = await caller.setDefault({ id: 2 });
    expect(result.success).toBe(true);
    expect(warehousesTable.find(w => w.id === 1)?.isDefault).toBe(false);
    expect(warehousesTable.find(w => w.id === 2)?.isDefault).toBe(true);
  });

  it("throws for nonexistent warehouse", async () => {
    const { warehouseMultiRouter } = await import("../warehouse-multi-router");
    const caller = warehouseMultiRouter.createCaller(buildCtx());
    await expect(caller.setDefault({ id: 999 })).rejects.toThrow();
  });
});

describe("warehouseMulti.getStock", () => {
  it("returns stock data with summary", async () => {
    const { warehouseMultiRouter } = await import("../warehouse-multi-router");
    const caller = warehouseMultiRouter.createCaller(buildCtx());
    const result = await caller.getStock({ page: 1, pageSize: 25 });
    expect(result.data).toBeDefined();
    expect(result.total).toBeDefined();
    expect(result.summary).toBeDefined();
  });

  it("works with search filter", async () => {
    const { warehouseMultiRouter } = await import("../warehouse-multi-router");
    const caller = warehouseMultiRouter.createCaller(buildCtx());
    const result = await caller.getStock({ search: "Tomato", page: 1, pageSize: 10 });
    expect(result.data).toBeDefined();
  });

  it("works without input", async () => {
    const { warehouseMultiRouter } = await import("../warehouse-multi-router");
    const caller = warehouseMultiRouter.createCaller(buildCtx());
    const result = await caller.getStock();
    expect(result.data).toBeDefined();
  });
});

describe("warehouseMulti.createTransfer", () => {
  it("creates a transfer between warehouses", async () => {
    const { warehouseMultiRouter } = await import("../warehouse-multi-router");
    const caller = warehouseMultiRouter.createCaller(buildCtx());
    const result = await caller.createTransfer({
      fromWarehouseId: 1, toWarehouseId: 2, productId: 1, quantity: 10,
    });
    expect(result.id).toBeDefined();
    expect(stockTransfersTable.length).toBe(1);
  });

  it("rejects transfer to same warehouse", async () => {
    const { warehouseMultiRouter } = await import("../warehouse-multi-router");
    const caller = warehouseMultiRouter.createCaller(buildCtx());
    await expect(caller.createTransfer({
      fromWarehouseId: 1, toWarehouseId: 1, productId: 1, quantity: 10,
    })).rejects.toThrow(/тот же склад/i);
  });

  it("rejects when insufficient available stock", async () => {
    const { warehouseMultiRouter } = await import("../warehouse-multi-router");
    const caller = warehouseMultiRouter.createCaller(buildCtx());
    await expect(caller.createTransfer({
      fromWarehouseId: 1, toWarehouseId: 2, productId: 1, quantity: 200,
    })).rejects.toThrow(/недостаточно/i);
  });

  it("rejects when source stock row does not exist", async () => {
    warehouseStockTable = [];
    const { warehouseMultiRouter } = await import("../warehouse-multi-router");
    const caller = warehouseMultiRouter.createCaller(buildCtx());
    await expect(caller.createTransfer({
      fromWarehouseId: 1, toWarehouseId: 2, productId: 1, quantity: 10,
    })).rejects.toThrow(/недостаточно/i);
  });
});

describe("warehouseMulti.completeTransfer", () => {
  it("completes a pending transfer", async () => {
    stockTransfersTable.push({
      id: 500, tenantId: 1, fromWarehouseId: 1, toWarehouseId: 2,
      productId: 1, quantity: "10.00", status: "pending", notes: null, createdBy: 10, createdAt: new Date(),
    });
    const { warehouseMultiRouter } = await import("../warehouse-multi-router");
    const caller = warehouseMultiRouter.createCaller(buildCtx());
    const result = await caller.completeTransfer({ transferId: 500 });
    expect(result.success).toBe(true);
    expect(stockTransfersTable.find(t => t.id === 500)?.status).toBe("completed");
  });

  it("rejects for nonexistent transfer", async () => {
    const { warehouseMultiRouter } = await import("../warehouse-multi-router");
    const caller = warehouseMultiRouter.createCaller(buildCtx());
    await expect(caller.completeTransfer({ transferId: 999 }))
      .rejects.toThrow(/не найдено/i);
  });

  it("rejects for already completed transfer", async () => {
    stockTransfersTable.push({
      id: 501, tenantId: 1, fromWarehouseId: 1, toWarehouseId: 2,
      productId: 1, quantity: "5.00", status: "completed", notes: null, createdBy: 10, createdAt: new Date(),
    });
    const { warehouseMultiRouter } = await import("../warehouse-multi-router");
    const caller = warehouseMultiRouter.createCaller(buildCtx());
    await expect(caller.completeTransfer({ transferId: 501 }))
      .rejects.toThrow(/не найдено/i);
  });
});

describe("warehouseMulti.listTransfers", () => {
  it("returns all transfers by default", async () => {
    stockTransfersTable.push(
      { id: 600, tenantId: 1, fromWarehouseId: 1, toWarehouseId: 2, productId: 1, quantity: "10", status: "pending", notes: null, createdAt: new Date("2025-06-01") },
      { id: 601, tenantId: 1, fromWarehouseId: 2, toWarehouseId: 1, productId: 2, quantity: "5", status: "completed", notes: null, createdAt: new Date("2025-06-02") },
    );
    const { warehouseMultiRouter } = await import("../warehouse-multi-router");
    const caller = warehouseMultiRouter.createCaller(buildCtx());
    const result = await caller.listTransfers();
    expect(result.length).toBe(2);
  });

  it("filters by status", async () => {
    stockTransfersTable.push(
      { id: 610, tenantId: 1, fromWarehouseId: 1, toWarehouseId: 2, productId: 1, quantity: "10", status: "pending", createdAt: new Date() },
      { id: 611, tenantId: 1, fromWarehouseId: 2, toWarehouseId: 1, productId: 2, quantity: "5", status: "completed", createdAt: new Date() },
    );
    const { warehouseMultiRouter } = await import("../warehouse-multi-router");
    const caller = warehouseMultiRouter.createCaller(buildCtx());
    const result = await caller.listTransfers({ status: "pending" });
    expect(result.every((t: any) => t.status === "pending")).toBe(true);
  });

  it("works for agent role", async () => {
    const { warehouseMultiRouter } = await import("../warehouse-multi-router");
    const caller = warehouseMultiRouter.createCaller(agentCtx());
    const result = await caller.listTransfers();
    expect(Array.isArray(result)).toBe(true);
  });
});
