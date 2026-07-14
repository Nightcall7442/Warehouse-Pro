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

import { products, warehouseStock, orderItems, stockMovements, warehouses } from "@db/schema";

interface FakeProduct { id: number; tenantId: number; code: string; barcode: string; name: string; category: string; costPrice: string; unitPrice: string; unit: string; unitWeight: string; description: string | null; photoUrl: string | null; reorderPoint: string; status: string; createdAt: Date; }
interface FakeStock { id: number; productId: number; tenantId: number; warehouseId: number; currentStock: string; reserved: string; available: string; }
interface FakeOrderItem { id: number; orderId: number; productId: number; quantity: string; unitPrice: string; subtotal: string; createdAt: Date; }
interface FakeStockMovement { id: number; tenantId: number; productId: number; type: string; quantity: string; notes: string | null; createdAt: Date; }
interface FakeWarehouse { id: number; tenantId: number; name: string; address: string; city: string; isDefault: boolean; status: string; createdAt: Date; }

let productsTable: FakeProduct[] = [];
let stockTable: FakeStock[] = [];
let orderItemsTable: FakeOrderItem[] = [];
let movementsTable: FakeStockMovement[] = [];
let warehousesTable: FakeWarehouse[] = [];
let nextProductId = 10;
let nextStockId = 10;

function resetTables() {
  productsTable = [
    { id: 1, tenantId: 1, code: "WA-001", barcode: "BC001", name: "Widget A", category: "Widgets", costPrice: "50.00", unitPrice: "100.00", unit: "pcs", unitWeight: "0.500", description: "Test widget", photoUrl: null, reorderPoint: "20.00", status: "active", createdAt: new Date() },
    { id: 2, tenantId: 1, code: "WB-002", barcode: "BC002", name: "Widget B", category: "Widgets", costPrice: "25.00", unitPrice: "50.00", unit: "pcs", unitWeight: "0.300", description: null, photoUrl: null, reorderPoint: "10.00", status: "active", createdAt: new Date() },
  ];
  stockTable = [
    { id: 1, productId: 1, tenantId: 1, warehouseId: 1, currentStock: "100.00", reserved: "0.00", available: "100.00" },
    { id: 2, productId: 2, tenantId: 1, warehouseId: 1, currentStock: "50.00", reserved: "0.00", available: "50.00" },
  ];
  orderItemsTable = [];
  movementsTable = [];
  warehousesTable = [
    { id: 1, tenantId: 1, name: "Main Warehouse", address: "Test", city: "Test", isDefault: true, status: "active", createdAt: new Date() },
  ];
  nextProductId = 10;
  nextStockId = 10;
}

function tableOf(ref: unknown): string {
  if (ref === products) return "products";
  if (ref === warehouseStock) return "warehouseStock";
  if (ref === orderItems) return "orderItems";
  if (ref === stockMovements) return "stockMovements";
  if (ref === warehouses) return "warehouses";
  return "other";
}

function rowsFor(table: string): Record<string, unknown>[] {
  if (table === "products") return productsTable as unknown as Record<string, unknown>[];
  if (table === "warehouseStock") return stockTable as unknown as Record<string, unknown>[];
  if (table === "orderItems") return orderItemsTable as unknown as Record<string, unknown>[];
  if (table === "stockMovements") return movementsTable as unknown as Record<string, unknown>[];
  if (table === "warehouses") return warehousesTable as unknown as Record<string, unknown>[];
  return [];
}

const columnToFieldName = new Map<unknown, string>();
for (const [field, col] of Object.entries(products)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(warehouseStock)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(orderItems)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(stockMovements)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(warehouses)) columnToFieldName.set(col, field);

function evalCond(row: Record<string, unknown>, cond: Record<string, unknown>): boolean {
  if (!cond || typeof cond !== "object") return true;
  const c = cond;
  if (c.__kind === "and") return (c.conds as unknown[]).every((inner: unknown) => evalCond(row, inner as Record<string, unknown>));
  if (cond.__kind === "eq") {
    const fieldName = columnToFieldName.get(cond.col) ?? (cond.col as Record<string, unknown>)?.name ?? cond.col;
    // Handle cross-table column references (e.g., eq(warehouseStock.productId, product.id))
    if (cond.val && typeof cond.val === "object" && columnToFieldName.has(cond.val)) {
      const otherField = columnToFieldName.get(cond.val)!;
      if (!(fieldName as string in row) || !(otherField as string in row)) return true;
      return row[fieldName as string] === row[otherField] || String(row[fieldName as string]) === String(row[otherField]);
    }
    if (!(fieldName as string in row)) return true;
    return row[fieldName as string] === cond.val || String(row[fieldName as string]) === String(cond.val);
  }
  if (cond.__kind === "like") {
    const fieldName = columnToFieldName.get(cond.col) ?? (cond.col as Record<string, unknown>)?.name ?? cond.col;
    if (!(fieldName as string in row)) return true;
    const val = row[fieldName as string] ?? "";
    const pattern = String(cond.val).replace(/^%/, ".*").replace(/%$/, "");
    return new RegExp(pattern, "i").test(String(val));
  }
  return true;
}

function chainable(rows: Record<string, unknown>[]) {
  const p = Promise.resolve(rows) as Promise<Record<string, unknown>[]> & {
    limit?: (n: number) => ReturnType<typeof chainable>;
    offset?: (n: number) => ReturnType<typeof chainable>;
    orderBy?: (..._a: unknown[]) => ReturnType<typeof chainable>;
    for?: (_mode: string) => ReturnType<typeof chainable>;
  };
  p.limit = (n: number) => chainable(rows.slice(0, n));
  p.offset = (n: number) => chainable(rows.slice(n));
  p.orderBy = () => chainable(rows);
  p.for = () => chainable(rows);
  return p;
}

function makeMockDb() {
  let joinedTable = "";
  let joinedRows: Record<string, unknown>[] = [];

  function selectBuilder(proj?: unknown) {
    let currentTable = "other";
    const isCountQuery = proj && typeof proj === "object" && "count" in (proj as Record<string, unknown>);
    const api: Record<string, unknown> & {
      from: (ref: unknown) => typeof api;
      leftJoin: (ref: unknown, _cond: unknown) => typeof api;
      innerJoin: (ref: unknown, _cond: unknown) => typeof api;
      where: (cond: unknown) => unknown;
      limit: (n: number) => unknown;
      offset: (n: number) => unknown;
      orderBy: (..._args: unknown[]) => unknown;
    } = {
      from(ref: unknown) { currentTable = tableOf(ref); return api; },
      leftJoin(ref: unknown) { joinedTable = tableOf(ref); joinedRows = rowsFor(joinedTable); return api; },
      innerJoin(ref: unknown) { joinedTable = tableOf(ref); joinedRows = rowsFor(joinedTable); return api; },
      where(cond: unknown) {
        const filtered = rowsFor(currentTable).filter((r) => evalCond(r, cond as Record<string, unknown>));
        if (joinedTable && joinedTable !== "other") {
          const enriched = filtered.map((row) => {
            const joinRow = joinedRows.find((jr) => jr.productId === row.id) ?? null;
            return { ...row, ...(joinRow ?? {}) };
          });
          joinedTable = "";
          joinedRows = [];
          if (isCountQuery) return chainable([{ count: enriched.length }]);
          return chainable(enriched);
        }
        if (isCountQuery) return chainable([{ count: filtered.length }]);
        return chainable(filtered);
      },
      limit(n: number) { return chainable(rowsFor(currentTable).slice(0, n)); },
      offset(n: number) { return chainable(rowsFor(currentTable).slice(n)); },
      orderBy() { return chainable(rowsFor(currentTable)); },
    };
    return api;
  }

  const db: any = {
    select: (proj?: unknown) => selectBuilder(proj),
    insert: (ref: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const table = tableOf(ref);
        if (table === "products") {
          const id = nextProductId++;
          productsTable.push({
            id, tenantId: vals.tenantId as number, code: vals.code as string, barcode: (vals.barcode as string) ?? "",
            name: vals.name as string, category: (vals.category as string) ?? "", costPrice: (vals.costPrice as string) ?? "0.00",
            unitPrice: (vals.unitPrice as string) ?? "0.00", unit: (vals.unit as string) ?? "pcs",
            unitWeight: (vals.unitWeight as string) ?? "0.000", description: (vals.description as string) ?? null,
            photoUrl: (vals.photoUrl as string) ?? null, reorderPoint: (vals.reorderPoint as string) ?? "10.00",
            status: (vals.status as string) ?? "active", createdAt: new Date(),
          });
          return Promise.resolve([{ insertId: id }]);
        }
        if (table === "warehouseStock") {
          const id = nextStockId++;
          stockTable.push({
            id, tenantId: vals.tenantId as number, productId: vals.productId as number,
            currentStock: String(vals.currentStock ?? "0.00"),
            reserved: String(vals.reserved ?? "0.00"),
            available: String(vals.available ?? "0.00"),
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
      where: (cond: Record<string, unknown>) => {
        const table = tableOf(ref);
        const keep = rowsFor(table).filter((r) => !evalCond(r, cond));
        if (table === "products") productsTable = keep as unknown as FakeProduct[];
        if (table === "warehouseStock") stockTable = keep as unknown as FakeStock[];
        if (table === "orderItems") orderItemsTable = keep as unknown as FakeOrderItem[];
        return Promise.resolve();
      },
    }),
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

describe("product.list", () => {
  it("returns products with stock info, scoped by tenant", async () => {
    const { productRouter } = await import("../product-router");
    const caller = productRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    const result = (await caller.list()) as any;
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.data[0].name).toBe("Widget A");
    expect(result.data[1].name).toBe("Widget B");
  });

  it("filters by search and category", async () => {
    const { productRouter } = await import("../product-router");
    const caller = productRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    const result = (await caller.list({ search: "Widget B" })) as any;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe("Widget B");
    expect(result.total).toBe(1);
    const catResult = (await caller.list({ category: "Widgets" })) as any;
    expect(catResult.data).toHaveLength(2);
    expect(catResult.total).toBe(2);
  });
});

describe("product.getById", () => {
  it("returns product with stock and movements", async () => {
    movementsTable.push({ id: 1, tenantId: 1, productId: 1, type: "in", quantity: "50.00", notes: "Restock", createdAt: new Date() });
    const { productRouter } = await import("../product-router");
    const caller = productRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    const result = await caller.getById({ id: 1 });
    expect(result).not.toBeNull();
    expect(result!.id).toBe(1);
    expect(result!.name).toBe("Widget A");
    expect(result!.stock).toBeDefined();
    expect((result!.stock as any).currentStock).toBe("100.00");
    expect(result!.movements).toHaveLength(1);
    expect(result!.movements[0].type).toBe("in");
  });

  it("returns null for non-existent", async () => {
    const { productRouter } = await import("../product-router");
    const caller = productRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    const result = await caller.getById({ id: 999 });
    expect(result).toBeNull();
  });
});

describe("product.create", () => {
  it("creates product + stock row (0 stock), returns id", async () => {
    const { productRouter } = await import("../product-router");
    const caller = productRouter.createCaller({ ...makeCtx(1, 1), db: mockDb });
    const result = await caller.create({
      code: "NEW-001", name: "New Item", unitPrice: "75.00",
    });
    expect(result.id).toBe(10);
    const created = productsTable.find((p) => p.id === result.id)!;
    expect(created.name).toBe("New Item");
    expect(created.code).toBe("NEW-001");
    expect(created.status).toBe("active");
    const stock = stockTable.find((s) => s.productId === result.id)!;
    expect(stock.currentStock).toBe("0.00");
    expect(stock.reserved).toBe("0.00");
    expect(stock.available).toBe("0.00");
  });
});

describe("product.update", () => {
  it("updates product fields with sanitization", async () => {
    const { productRouter } = await import("../product-router");
    const caller = productRouter.createCaller({ ...makeCtx(1, 1), db: mockDb });
    const result = await caller.update({ id: 1, name: "Updated <b>Widget</b>", unitPrice: "120.00" });
    expect(result.success).toBe(true);
    const updated = productsTable.find((p) => p.id === 1)!;
    expect(updated.name).toBe("Updated Widget");
    expect(updated.unitPrice).toBe("120.00");
  });
});

describe("product.delete", () => {
  it("soft-deletes product even when it has orderItems", async () => {
    orderItemsTable.push({ id: 1, orderId: 1, productId: 1, quantity: "5", unitPrice: "100.00", subtotal: "500.00", createdAt: new Date() });
    const { productRouter } = await import("../product-router");
    const caller = productRouter.createCaller({ ...makeCtx(1, 1), db: mockDb });
    const result = await caller.delete({ id: 1 });
    expect(result.success).toBe(true);
    expect(productsTable.find((p) => p.id === 1)!.status).toBe("inactive");
    expect(stockTable.find((s) => s.productId === 1)).toBeUndefined();
  });

  it("soft-deletes product and removes stock record", async () => {
    const { productRouter } = await import("../product-router");
    const caller = productRouter.createCaller({ ...makeCtx(1, 1), db: mockDb });
    const result = await caller.delete({ id: 1 });
    expect(result.success).toBe(true);
    expect(productsTable.find((p) => p.id === 1)!.status).toBe("inactive");
    expect(stockTable.find((s) => s.productId === 1)).toBeUndefined();
  });

  it("succeeds for zero-stock product with no orders", async () => {
    stockTable.find((s) => s.productId === 2)!.currentStock = "0.00";
    const { productRouter } = await import("../product-router");
    const caller = productRouter.createCaller({ ...makeCtx(1, 1), db: mockDb });
    const result = await caller.delete({ id: 2 });
    expect(result.success).toBe(true);
    expect(productsTable.find((p) => p.id === 2)!.status).toBe("inactive");
    expect(stockTable.find((s) => s.productId === 2)).toBeUndefined();
  });
});

describe("product.findByBarcode", () => {
  it("returns product with stock", async () => {
    const { productRouter } = await import("../product-router");
    const caller = productRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    const result = await caller.findByBarcode({ barcode: "BC001" });
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Widget A");
    expect(result!.available).toBe("100.00");
  });
});
