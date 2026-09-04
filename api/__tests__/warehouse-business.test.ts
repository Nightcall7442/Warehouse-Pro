import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TrpcContext } from "../context";
import { asTestContext } from "./helpers/test-context";

vi.mock("drizzle-orm", () => {
  const sqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values });
  sqlFn.join = (chunks: unknown[], separator: unknown) => ({ __kind: "sql.join", chunks, separator });
  return {
    eq: (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
    and: (...conds: unknown[]) => ({ __kind: "and", conds }),
    like: (col: unknown, val: unknown) => ({ __kind: "like", col, val }),
    desc: (col: unknown) => ({ __kind: "desc", col }),
    sql: sqlFn,
    relations: () => ({}),
  };
});

vi.mock("../telegram-router", () => ({
  notifyAdmin: vi.fn(async () => {}),
  tgMessages: { newOrder: vi.fn(() => "mock") },
}));

vi.mock("../lib/sanitize", () => ({
  sanitizeString: (s: string) => s,
}));

vi.mock("../lib/sse", () => ({
  sseBus: { emit: vi.fn() },
}));

vi.mock("../lib/feature-gating", () => ({
  hasSubscriptionAccess: vi.fn(async () => true),
  checkSubscriptionAccess: vi.fn(async () => true),
  invalidateSubscriptionAccess: vi.fn(),
}));

vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());

const mockAdjust = vi.fn();
vi.mock("../services/stock", () => ({
  StockService: { adjust: mockAdjust },
}));

let mockDb: any;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

import { warehouseStock, products, warehouses, orders, orderItems } from "@db/schema";
import { makeConditionEvaluator } from "./helpers/fake-conditions";

interface FakeStock { id: number; productId: number; tenantId: number; warehouseId: number; currentStock: string; reserved: string; available: string; costPrice: string; }
interface FakeProduct { id: number; tenantId: number; name: string; unitPrice: string; costPrice: string; status: string; weight: string | null; reorderPoint: number | null; }
interface FakeWarehouse { id: number; tenantId: number; name: string; isDefault: boolean; status: string; }
interface FakeOrder { id: number; tenantId: number; agentId: number; shopId: number; status: string; createdAt: string; }
interface FakeOrderItem { id: number; orderId: number; productId: number; quantity: string; subtotal: string; }

let stockTable: FakeStock[] = [];
let productsTable: FakeProduct[] = [];
let warehousesTable: FakeWarehouse[] = [];
let ordersTable: FakeOrder[] = [];
let orderItemsTable: FakeOrderItem[] = [];
let nextId = 1;

function resetTables() {
  stockTable = [
    { id: 1, productId: 1, tenantId: 1, warehouseId: 1, currentStock: "100.00", reserved: "10.00", available: "90.00", costPrice: "80.00" },
    { id: 2, productId: 2, tenantId: 1, warehouseId: 1, currentStock: "5.00", reserved: "0.00", available: "5.00", costPrice: "40.00" },
    { id: 3, productId: 3, tenantId: 1, warehouseId: 1, currentStock: "200.00", reserved: "0.00", available: "200.00", costPrice: "10.00" },
  ];
  productsTable = [
    { id: 1, tenantId: 1, name: "Product A", unitPrice: "100.00", costPrice: "80.00", status: "active", weight: "1.5", reorderPoint: 20 },
    { id: 2, tenantId: 1, name: "Product B", unitPrice: "50.00", costPrice: "40.00", status: "active", weight: "0.5", reorderPoint: 10 },
    { id: 3, tenantId: 1, name: "Product C", unitPrice: "20.00", costPrice: "10.00", status: "active", weight: "2.0", reorderPoint: 50 },
  ];
  warehousesTable = [
    { id: 1, tenantId: 1, name: "Main", isDefault: true, status: "active" },
  ];
  ordersTable = [
    { id: 1, tenantId: 1, agentId: 10, shopId: 1, status: "completed", createdAt: "2025-06-01T10:00:00Z" },
  ];
  orderItemsTable = [
    { id: 1, orderId: 1, productId: 1, quantity: "5.00", subtotal: "500.00" },
  ];
  nextId = 10;
}

const columnToField = new Map<unknown, string>();
// Takes a drizzle table, whose type is nothing like Record<string, unknown> —
// the narrower signature made every call site an error without catching
// anything, since the body only ever reads one property by name.
function reg(table: object, name: string) {
  columnToField.set((table as Record<string, unknown>)[name], name);
}
reg(warehouseStock, "id"); reg(warehouseStock, "productId"); reg(warehouseStock, "tenantId");
reg(warehouseStock, "warehouseId"); reg(warehouseStock, "currentStock"); reg(warehouseStock, "reserved");
reg(warehouseStock, "available"); reg(warehouseStock, "costPrice");
reg(products, "id"); reg(products, "tenantId"); reg(products, "name");
reg(products, "unitPrice"); reg(products, "costPrice"); reg(products, "status");
reg(products, "weight"); reg(products, "reorderPoint");
reg(warehouses, "id"); reg(warehouses, "tenantId"); reg(warehouses, "name");
reg(warehouses, "isDefault"); reg(warehouses, "status");
reg(orders, "id"); reg(orders, "tenantId"); reg(orders, "status"); reg(orders, "createdAt");
reg(orderItems, "id"); reg(orderItems, "orderId"); reg(orderItems, "productId");
reg(orderItems, "quantity"); reg(orderItems, "subtotal");

function mapCol(col: unknown): string {
  return columnToField.get(col) ?? (col as any)?.name ?? String(col);
}

/**
 * Разбор условий отдан общему строгому разборщику.
 *
 * Местная копия считала выполненным всё, чего не понимала: из операторов она
 * знала не более двух-трёх, а остальные — включая `isNull` и `inArray` —
 * молча проходили. Убери кто-нибудь такой фильтр из продакшена, тест остался
 * бы зелёным.
 *
 * treatMissingColumnAsMatch оставлен намеренно: строки этого стенда описаны
 * частично, и без послабления упали бы проверки, к самому продукту отношения
 * не имеющие. Флаг виден здесь при чтении и снимается отдельно, вместе с
 * доописыванием строк.
 */
const evalCond = makeConditionEvaluator({
  fieldOf: mapCol,
  treatMissingColumnAsMatch: true,
  // Сырой sql`` этот стенд не воспроизводит; условие считается выполненным.
  // Решение записано здесь, а не спрятано в умолчании разборщика.
  rawSql: () => true,
});

function buildChain(rows: Record<string, unknown>[]) {
  const chain: any = Promise.resolve(rows);
  chain.limit = (n: number) => buildChain(rows.slice(0, n));
  chain.offset = (n: number) => buildChain(rows.slice(n));
  chain.orderBy = () => chain;
  chain.groupBy = () => chain;
  chain.leftJoin = () => chain;
  chain.innerJoin = () => chain;
  chain.for = () => chain;
  return chain;
}

function useTable(col: unknown): Record<string, unknown>[] {
  if (col === warehouseStock) return stockTable as any;
  if (col === products) return productsTable as any;
  if (col === warehouses) return warehousesTable as any;
  if (col === orders) return ordersTable as any;
  if (col === orderItems) return orderItemsTable as any;
  return [];
}

function makeMockDb() {
  const db: any = {};
  db.select = (fields?: any) => {
    const sel: any = {};
    sel.from = (table: any) => {
      const tbl = useTable(table);
      const from: any = {};
      from.leftJoin = () => from;
      from.innerJoin = () => from;
      from.for = () => from;
      from.where = (cond: unknown) => {
        const filtered = tbl.filter((r: any) => evalCond(r, cond as Record<string, unknown>));
        if (fields && typeof fields === "object" && !Array.isArray(fields)) {
          const mapped = filtered.map((r: any) => {
            const out: Record<string, unknown> = {};
            for (const [alias, def] of Object.entries(fields)) {
              if (typeof def === "object" && def !== null) {
                if ((def as any).__kind === "sql") {
                  const sqlStr = String((def as any).strings?.join?.("") ?? "");
                  if (/COUNT\s*\(\s*\*/i.test(sqlStr)) {
                    out[alias] = filtered.length;
                  } else if (/SUM/i.test(sqlStr)) {
                    const field = mapCol((def as any).values?.[0] ?? "");
                    out[alias] = String(filtered.reduce((s: number, r: any) => s + Number(r[field] ?? 0), 0));
                  } else if (/COALESCE/i.test(sqlStr)) {
                    const field = mapCol((def as any).values?.[0] ?? "");
                    out[alias] = String(filtered.reduce((s: number, r: any) => s + Number(r[field] ?? 0), 0));
                  } else {
                    out[alias] = r[mapCol(def)] ?? "0";
                  }
                } else {
                  out[alias] = r[mapCol(def)];
                }
              }
            }
            return out;
          });
          return buildChain(mapped);
        }
        return buildChain(filtered);
      };
      from.limit = (n: number) => buildChain(tbl.slice(0, n));
      from.orderBy = () => from;
      from.groupBy = () => from;
      return from;
    };
    return sel;
  };
  db.insert = () => ({
    values: vi.fn(() => [{ insertId: nextId++ }]),
  });
  db.update = () => ({
    set: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve({ affectedRows: 1 })),
    })),
  });
  db.delete = () => ({
    where: vi.fn(() => Promise.resolve({ affectedRows: 1 })),
  });
  db.execute = vi.fn(async (rawSql: unknown) => {
    if (rawSql && typeof rawSql === "object" && (rawSql as any).__kind === "sql") {
      const sqlStr = String((rawSql as any).strings?.join?.("") ?? "");
      if (sqlStr.includes("UPDATE") && sqlStr.includes("warehouse_stock")) {
        const vals = (rawSql as any).values ?? [];
        for (const v of vals) {
          if (v && typeof v === "object" && v.__kind === "sql.join" && Array.isArray(v.chunks)) {
            for (const chunk of v.chunks) {
              if (chunk && typeof chunk === "object" && chunk.__kind === "sql") {
                const productId = Number(chunk.values?.[0]);
                const amount = Number(chunk.values?.[1]);
                const stock = stockTable.find(s => s.productId === productId && s.tenantId === 1);
                if (stock) {
                  stock.currentStock = String(Number(stock.currentStock) + amount);
                  stock.available = String(Number(stock.available) + amount);
                }
              }
            }
          }
        }
      }
    }
    return { affectedRows: 1 };
  });
  db.transaction = (fn: (tx: any) => Promise<any>) => fn(db);
  return db;
}

function buildCtx(overrides: Record<string, unknown> = {}): TrpcContext {
  return asTestContext({
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    db: mockDb,
    tenant: { id: 1, slug: "test", name: "Test Co", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    user: { id: 1, tenantId: 1, role: "operator" as const, status: "active" as const, name: "Test", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTables();
  mockDb = makeMockDb();
  mockAdjust.mockReset();
});

describe("warehouse.list — summary", () => {
  it("returns summary with totalSKUs", async () => {
    const { warehouseRouter } = await import("../warehouse-router");
    const caller = warehouseRouter.createCaller(buildCtx());
    const result = await caller.list({});
    expect(result.summary).toBeDefined();
    expect(result.summary.totalSKUs).toBe(3);
  });

  it("returns zero summary when no stock exists", async () => {
    stockTable = [];
    const { warehouseRouter } = await import("../warehouse-router");
    const caller = warehouseRouter.createCaller(buildCtx());
    const result = await caller.list({});
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

describe("warehouse.valuation", () => {
  it("calculates total cost and retail value", async () => {
    const { warehouseRouter } = await import("../warehouse-router");
    const caller = warehouseRouter.createCaller(buildCtx());
    const result = await caller.valuation();
    expect(result).toBeDefined();
    expect(Number(result.totalCostValue)).toBeGreaterThan(0);
    expect(Number(result.totalRetailValue)).toBeGreaterThan(0);
    expect(Number(result.totalUnits)).toBe(305);
  });

  it("returns zeros when no stock", async () => {
    stockTable = [];
    const { warehouseRouter } = await import("../warehouse-router");
    const caller = warehouseRouter.createCaller(buildCtx());
    const result = await caller.valuation();
    expect(Number(result.totalCostValue)).toBe(0);
    expect(Number(result.totalUnits)).toBe(0);
  });
});

describe("warehouse.adjustStock", () => {
  it("delegates to StockService.adjust for 'in' type", async () => {
    mockAdjust.mockResolvedValue({ success: true });
    const { warehouseRouter } = await import("../warehouse-router");
    const caller = warehouseRouter.createCaller(buildCtx());
    const result = await caller.adjustStock({
      productId: 1,
      quantity: "10.00",
      type: "in",
      notes: "Restocking",
    });
    expect(mockAdjust).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("delegates to StockService.adjust for 'out' type", async () => {
    mockAdjust.mockResolvedValue({ success: true });
    const { warehouseRouter } = await import("../warehouse-router");
    const caller = warehouseRouter.createCaller(buildCtx());
    const result = await caller.adjustStock({
      productId: 1,
      quantity: "5.00",
      type: "out",
      notes: "Manual removal",
    });
    expect(mockAdjust).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("delegates to StockService.adjust for 'adjustment' type", async () => {
    mockAdjust.mockResolvedValue({ success: true });
    const { warehouseRouter } = await import("../warehouse-router");
    const caller = warehouseRouter.createCaller(buildCtx());
    const result = await caller.adjustStock({
      productId: 1,
      quantity: "50.00",
      type: "adjustment",
      notes: "Inventory count correction",
    });
    expect(mockAdjust).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});

describe("warehouse.list — search", () => {
  it("handles search parameter without crashing", async () => {
    const { warehouseRouter } = await import("../warehouse-router");
    const caller = warehouseRouter.createCaller(buildCtx());
    const result = await caller.list({ search: "Product A" });
    expect(result).toHaveProperty("data");
    expect(Array.isArray(result.data)).toBe(true);
  });

  it("returns all stock when search is empty", async () => {
    const { warehouseRouter } = await import("../warehouse-router");
    const caller = warehouseRouter.createCaller(buildCtx());
    const result = await caller.list({ search: "" });
    expect(result.data.length).toBeGreaterThanOrEqual(1);
  });
});

describe("warehouse.movements", () => {
  it("returns movements for a product", async () => {
    const { warehouseRouter } = await import("../warehouse-router");
    const caller = warehouseRouter.createCaller(buildCtx());
    const result = await caller.movements({ productId: 1 });
    expect(Array.isArray(result)).toBe(true);
  });
});
