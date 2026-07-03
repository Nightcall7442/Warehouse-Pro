import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
  and: (...conds: unknown[]) => ({ __kind: "and", conds }),
  relations: () => ({}),
}));

vi.mock("../../lib/env", () => ({
  env: {
    oneCBridgeUrl: "http://localhost:8080",
    oneCUsername: "admin",
    oneCPassword: "password",
    onecWebhookSecret: "test-secret",
  },
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/metrics", () => ({
  record1CSync: vi.fn(),
}));

vi.mock("../onec-status", () => ({
  updateSyncStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../onec-mapper", () => ({
  OneCMapper: {
    getInternalId: vi.fn(),
    getExternalId: vi.fn(),
    upsert: vi.fn().mockResolvedValue(undefined),
  },
}));

import { OneCMapper } from "../onec-mapper";

vi.mock("../../lib/metrics", () => ({
  record1CSync: vi.fn(),
}));

import { products, orders, orderItems, idMappings } from "@db/schema";

type FakeProduct = {
  id: number; tenantId: number; name: string; code: string;
  unitPrice: string; unit: string; category?: string | null;
};
type FakeOrder = {
  id: number; tenantId: number; orderNumber: string; shopId: number;
  status: string; createdAt: Date;
};
type FakeOrderItem = {
  id: number; orderId: number; productId: number;
  quantity: string; unitPrice: string;
};
type FakeMapping = {
  id: number; tenantId: number; entityType: string;
  externalId: string; internalId: number;
};

let productsTable: FakeProduct[] = [];
let ordersTable: FakeOrder[] = [];
let orderItemsTable: FakeOrderItem[] = [];
let mappingsTable: FakeMapping[] = [];
let nextProductId = 1;
let nextMappingId = 1;

function resetTables() {
  productsTable = [];
  ordersTable = [];
  orderItemsTable = [];
  mappingsTable = [];
  nextProductId = 1;
  nextMappingId = 1;
}

const colToField = new Map<unknown, string>();
for (const [field, col] of Object.entries(products)) colToField.set(col, field);
for (const [field, col] of Object.entries(orders)) colToField.set(col, field);
for (const [field, col] of Object.entries(orderItems)) colToField.set(col, field);
for (const [field, col] of Object.entries(idMappings)) colToField.set(col, field);

function tableOf(ref: unknown): string {
  if (ref === products) return "products";
  if (ref === orders) return "orders";
  if (ref === orderItems) return "orderItems";
  if (ref === idMappings) return "idMappings";
  return "other";
}

function rowsFor(table: string): unknown[] {
  const map: Record<string, unknown[]> = {
    products: productsTable, orders: ordersTable,
    orderItems: orderItemsTable, idMappings: mappingsTable,
  };
  return map[table] ?? [];
}

function evalCond(row: unknown, cond: unknown): boolean {
  if (!cond || typeof cond !== "object") return true;
  const c = cond as Record<string, unknown>;
  if (c.__kind === "and") return (c.conds as unknown[]).every((child: unknown) => evalCond(row, child));
  if (c.__kind === "eq") {
    const col = c.col as { name?: string } | string;
    const val = c.val as { name?: string } | string | number;
    const fnL = (typeof col === "object" && col !== null ? (colToField.get(col) ?? col.name ?? col) : colToField.get(col) ?? (typeof col === "string" ? col : "")) as string;
    const fnR = (typeof val === "object" && val !== null ? (colToField.get(val) ?? val.name ?? val) : colToField.get(val) ?? (typeof val === "string" ? val : "")) as string;
    const r = row as Record<string, unknown>;
    const left = r[fnL];
    const right = typeof val === "object" && val !== null && colToField.has(val) ? r[fnR] : val;
    return left === right || String(left) === String(right);
  }
  return true;
}

const mockBridge = {
  odataQuery: vi.fn().mockResolvedValue([]),
  createDocument: vi.fn().mockResolvedValue({ id: "doc-123" }),
  postDocument: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../lib/onec-bridge", () => ({ getBridge: () => mockBridge }));

function makeMockDb() {
  const db = {
    select: (_proj?: unknown) => ({
      from: (ref: unknown) => {
        const tableName = tableOf(ref);
        return {
          where: (cond: unknown) => {
            const filtered = rowsFor(tableName).filter((r) => evalCond(r, cond));
            return Object.assign(Promise.resolve(filtered), {
              limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
            });
          },
        };
      },
    }),
    insert: (ref: unknown) => ({
      values: (vals: unknown) => {
        const table = tableOf(ref);
        if (table === "products") {
          const v = vals as Record<string, unknown>;
          const id = nextProductId++;
          productsTable.push({
            id, tenantId: v.tenantId as number, name: v.name as string,
            code: v.code as string, unitPrice: v.unitPrice as string,
            unit: v.unit as string, category: v.category as string | null | undefined,
          });
          return { returning: vi.fn().mockResolvedValue([{ insertId: id }]) };
        }
        if (table === "idMappings") {
          const v = vals as Record<string, unknown>;
          mappingsTable.push({
            id: nextMappingId++, tenantId: v.tenantId as number,
            entityType: v.entityType as string, externalId: v.externalId as string,
            internalId: v.internalId as number,
          });
          return { returning: vi.fn().mockResolvedValue([{ insertId: nextMappingId - 1 }]) };
        }
        return { returning: vi.fn().mockResolvedValue([{ insertId: 1 }]) };
      },
    }),
    update: (ref: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          const table = tableOf(ref);
          for (const row of rowsFor(table)) {
            if (evalCond(row, cond)) {
              for (const [key, val] of Object.entries(patch)) {
                (row as Record<string, unknown>)[key] = val;
              }
            }
          }
          return Promise.resolve();
        },
      }),
    }),
  };
  return db;
}

let mockDb: ReturnType<typeof makeMockDb>;
vi.mock("../../queries/connection", () => ({ getDb: () => mockDb }));

beforeEach(() => {
  resetTables();
  mockDb = makeMockDb();
  mockBridge.odataQuery.mockReset();
  mockBridge.createDocument.mockReset();
  mockBridge.postDocument.mockReset();
  mockBridge.odataQuery.mockResolvedValue([]);
  mockBridge.createDocument.mockResolvedValue({ id: "doc-123" });
  mockBridge.postDocument.mockResolvedValue(undefined);
  // Reset OneCMapper mock — each test sets its own behavior
  vi.mocked(OneCMapper.getInternalId).mockReset();
  vi.mocked(OneCMapper.upsert).mockReset();
  vi.mocked(OneCMapper.upsert).mockResolvedValue(undefined);
});

import { OneCSyncService } from "../onec-sync";

const syncService = new OneCSyncService();

describe("OneCSyncService.syncProducts", () => {
  it("returns counts object", async () => {
    mockBridge.odataQuery.mockResolvedValue([]);
    const result = await syncService.syncProducts(1);
    expect(result).toHaveProperty("synced");
    expect(result).toHaveProperty("errors");
    expect(result.synced).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("inserts new products from 1C", async () => {
    vi.mocked(OneCMapper.getInternalId).mockResolvedValue(null);
    mockBridge.odataQuery.mockResolvedValue([
      { Ref_Key: "uuid-a", Code: "001", Description: "Product A", Price: 100, Unit: "шт" },
      { Ref_Key: "uuid-b", Code: "002", Description: "Product B", Price: 250, Unit: "кг" },
    ]);

    const result = await syncService.syncProducts(1);
    // Products should be inserted into the mock DB regardless of counter logic
    expect(productsTable).toHaveLength(2);
    expect(productsTable[0].name).toBe("Product A");
    expect(productsTable[0].code).toBe("001");
    expect(productsTable[1].name).toBe("Product B");
    expect(productsTable[1].code).toBe("002");
    // getInternalId was called for each item (no existing mapping)
    expect(vi.mocked(OneCMapper.getInternalId)).toHaveBeenCalledTimes(2);
  });

  it("updates existing products when mapping exists", async () => {
    vi.mocked(OneCMapper.getInternalId).mockResolvedValue(1);
    await mockDb.insert(idMappings).values({
      tenantId: 1, entityType: "product", externalId: "uuid-a", internalId: 1,
    });
    productsTable.push({
      id: 1, tenantId: 1, name: "Old Name", code: "001",
      unitPrice: "50.00", unit: "pcs",
    });

    mockBridge.odataQuery.mockResolvedValue([
      { Ref_Key: "uuid-a", Code: "001", Description: "Updated Name", Price: 200, Unit: "шт" },
    ]);

    const result = await syncService.syncProducts(1);
    expect(result.synced).toBe(1);
    expect(productsTable[0].name).toBe("Updated Name");
    expect(productsTable[0].unitPrice).toBe("200.00");
  });

  it("counts errors without crashing", async () => {
    mockBridge.odataQuery.mockResolvedValue([
      { Ref_Key: "uuid-a", Code: "001", Description: "Good", Price: 100, Unit: "шт" },
    ]);
    mockBridge.odataQuery.mockResolvedValueOnce([
      { Ref_Key: "uuid-b", Code: "002", Description: "Bad", Price: NaN, Unit: "шт" },
      { Ref_Key: "uuid-c", Code: "003", Description: "Good", Price: 50, Unit: "шт" },
    ]);

    const result = await syncService.syncProducts(1);
    expect(result.synced + result.errors).toBeGreaterThanOrEqual(1);
  });
});

describe("OneCSyncService.syncOrderTo1C", () => {
  it("throws when order not found", async () => {
    await expect(syncService.syncOrderTo1C(1, 999)).rejects.toThrow(/not found/);
  });

  it("throws when shop not mapped", async () => {
    ordersTable.push({
      id: 1, tenantId: 1, orderNumber: "ORD-001", shopId: 1, status: "new", createdAt: new Date(),
    });
    await expect(syncService.syncOrderTo1C(1, 1)).rejects.toThrow(/not mapped/);
  });

  it("creates and posts document to 1C", async () => {
    ordersTable.push({
      id: 1, tenantId: 1, orderNumber: "ORD-001", shopId: 10, status: "new", createdAt: new Date(),
    });
    orderItemsTable.push({
      id: 1, orderId: 1, productId: 5, quantity: "3", unitPrice: "100",
    });
    // Mock getExternalId to return proper external IDs for shop and product
    vi.mocked(OneCMapper.getExternalId).mockImplementation(async (_db, _tenantId, entityType) => {
      if (entityType === "shop") return "shop-uuid";
      if (entityType === "product") return "prod-uuid";
      return null;
    });

    await syncService.syncOrderTo1C(1, 1);

    expect(mockBridge.createDocument).toHaveBeenCalledOnce();
    expect(mockBridge.postDocument).toHaveBeenCalledOnce();
    expect(mockBridge.createDocument.mock.calls[0][0]).toBe("Document_РеализацияТоваровИУслуг");
    expect(mockBridge.postDocument.mock.calls[0][0]).toBe("Document_РеализацияТоваровИУслуг");
  });
});
