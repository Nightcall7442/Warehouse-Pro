/* eslint-disable @typescript-eslint/no-explicit-any */
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

vi.mock("../lib/sanitize", () => ({
  sanitizeString: (s: string) => s.replace(/<[^>]*>/g, "").trim(),
}));

vi.mock("../lib/sse", () => ({
  sseBus: { emit: vi.fn() },
}));

import { arrivals, arrivalItems, warehouses, warehouseStock, stockMovements, products } from "@db/schema";

// ── Fake tables ──────────────────────────────────────────────────────────────
type FakeArrival = { id: number; tenantId: number; arrivalNumber: string; truckId: string | null; driverName: string | null; driverPhone: string | null; status: string; fuelCost: string; tollCost: string; otherCost: string; totalExpense: string; arrivalDate: Date; arrivalTime: string | null; unloadingTime: string | null; notes: string | null; createdAt: Date; };
type FakeArrivalItem = { id: number; arrivalId: number; productId: number; quantity: string; costPrice: string; sellingPrice: string; condition: string | null; notes: string | null; };
interface FakeWarehouse { id: number; tenantId: number; name: string; isDefault: boolean; status: string; }
interface FakeStock { id: number; productId: number; tenantId: number; warehouseId: number; currentStock: string; reserved: string; available: string; }
interface FakeStockMovement { id: number; tenantId: number; productId: number; type: string; quantity: string; referenceType: string | null; referenceId: number | null; notes: string | null; createdAt: Date; }
interface FakeProduct { id: number; tenantId: number; }

let arrivalsTable: FakeArrival[] = [];
let arrivalItemsTable: FakeArrivalItem[] = [];
let warehousesTable: FakeWarehouse[] = [];
let stockTable: FakeStock[] = [];
let movementsTable: FakeStockMovement[] = [];
let productsTable: FakeProduct[] = [];
let nextArrivalId = 10;
let nextItemId = 10;
let nextStockId = 10;
let nextMovementId = 1;

function resetTables() {
  arrivalsTable = [
    { id: 1, tenantId: 1, arrivalNumber: "ARR-000000000001", truckId: "T-123", driverName: "Иван", driverPhone: "+998901234567", status: "pending", fuelCost: "50.00", tollCost: "10.00", otherCost: "5.00", totalExpense: "65.00", arrivalDate: new Date("2025-01-15"), arrivalTime: null, unloadingTime: null, notes: null, createdAt: new Date() },
    { id: 2, tenantId: 1, arrivalNumber: "ARR-000000000002", truckId: null, driverName: "Петр", driverPhone: null, status: "completed", fuelCost: "0.00", tollCost: "0.00", otherCost: "0.00", totalExpense: "0.00", arrivalDate: new Date("2025-01-10"), arrivalTime: null, unloadingTime: null, notes: "已完成", createdAt: new Date() },
  ];
  arrivalItemsTable = [
    { id: 1, arrivalId: 1, productId: 1, quantity: "100", costPrice: "50.00", sellingPrice: "80.00", condition: "good", notes: null },
    { id: 2, arrivalId: 1, productId: 2, quantity: "50", costPrice: "25.00", sellingPrice: "45.00", condition: "good", notes: null },
    { id: 3, arrivalId: 2, productId: 1, quantity: "200", costPrice: "48.00", sellingPrice: "75.00", condition: "good", notes: null },
  ];
  warehousesTable = [
    { id: 1, tenantId: 1, name: "Main Warehouse", isDefault: true, status: "active" },
  ];
  stockTable = [
    { id: 1, productId: 1, tenantId: 1, warehouseId: 1, currentStock: "100.00", reserved: "0.00", available: "100.00" },
  ];
  movementsTable = [];
  productsTable = [
    { id: 1, tenantId: 1 },
    { id: 2, tenantId: 1 },
  ];
  nextArrivalId = 10;
  nextItemId = 10;
  nextStockId = 10;
  nextMovementId = 1;
}

function tableOf(ref: unknown): string {
  if (ref === arrivals) return "arrivals";
  if (ref === arrivalItems) return "arrivalItems";
  if (ref === warehouses) return "warehouses";
  if (ref === warehouseStock) return "warehouseStock";
  if (ref === stockMovements) return "stockMovements";
  if (ref === products) return "products";
  return "other";
}

function rowsFor(table: string): Record<string, unknown>[] {
  if (table === "arrivals") return arrivalsTable as unknown as Record<string, unknown>[];
  if (table === "arrivalItems") return arrivalItemsTable as unknown as Record<string, unknown>[];
  if (table === "warehouses") return warehousesTable as unknown as Record<string, unknown>[];
  if (table === "warehouseStock") return stockTable as unknown as Record<string, unknown>[];
  if (table === "stockMovements") return movementsTable as unknown as Record<string, unknown>[];
  if (table === "products") return productsTable as unknown as Record<string, unknown>[];
  return [];
}

const columnToFieldName = new Map<unknown, string>();
for (const [field, col] of Object.entries(arrivals)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(arrivalItems)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(warehouses)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(warehouseStock)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(stockMovements)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(products)) columnToFieldName.set(col, field);

function evalCond(row: Record<string, unknown>, cond: Record<string, unknown>): boolean {
  if (!cond || typeof cond !== "object") return true;
  if (cond.__kind === "and") return (cond.conds as unknown[]).every((inner: unknown) => evalCond(row, inner as Record<string, unknown>));
  if (cond.__kind === "eq") {
    const fieldName = columnToFieldName.get(cond.col) ?? (cond.col as Record<string, unknown>)?.name ?? cond.col;
    if (cond.val && typeof cond.val === "object" && columnToFieldName.has(cond.val)) {
      const otherField = columnToFieldName.get(cond.val)!;
      if (!(fieldName as string in row) || !(otherField as string in row)) return true;
      return row[fieldName as string] === row[otherField] || String(row[fieldName as string]) === String(row[otherField]);
    }
    if (!(fieldName as string in row)) return true;
    return row[fieldName as string] === cond.val || String(row[fieldName as string]) === String(cond.val);
  }
  return true;
}

function chainable(rows: Record<string, unknown>[]) {
  const p = Promise.resolve(rows) as Promise<Record<string, unknown>[]> & {
    limit?: (n: number) => ReturnType<typeof chainable>;
    offset?: (n: number) => ReturnType<typeof chainable>;
    orderBy?: (..._a: unknown[]) => ReturnType<typeof chainable>;
    for?: (..._a: unknown[]) => ReturnType<typeof chainable>;
  };
  p.limit = (n: number) => chainable(rows.slice(0, n));
  p.offset = (n: number) => chainable(rows.slice(n));
  p.orderBy = () => chainable(rows);
  // `.for("update")` is a real row lock against MySQL; this mock has no
  // concurrent transactions to serialize, so it's a pass-through that keeps
  // the same rows chainable into whatever comes next (.limit(), awaiting it
  // directly, etc.) — same as real drizzle's builder shape.
  p.for = () => chainable(rows);
  return p;
}

function makeMockDb() {
  const db: any = {
    select: (proj?: unknown) => {
      const isCountQuery = proj && typeof proj === "object" && "count" in (proj as Record<string, unknown>);
      let currentTable = "other";
      const api: Record<string, any> = {
        from(ref: unknown) { currentTable = tableOf(ref); return api; },
        where(cond: unknown) {
          const filtered = rowsFor(currentTable).filter((r) => evalCond(r, cond as Record<string, unknown>));
          if (isCountQuery) return chainable([{ count: filtered.length }]);
          return chainable(filtered);
        },
        limit(n: number) { return chainable(rowsFor(currentTable).slice(0, n)); },
        offset(n: number) { return chainable(rowsFor(currentTable).slice(n)); },
        orderBy() { return chainable(rowsFor(currentTable)); },
      };
      return api;
    },
    insert: (ref: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const table = tableOf(ref);
        if (table === "arrivals") {
          const id = nextArrivalId++;
          arrivalsTable.push({
            id, tenantId: vals.tenantId as number, arrivalNumber: vals.arrivalNumber as string,
            truckId: (vals.truckId as string) ?? null, driverName: (vals.driverName as string) ?? null,
            driverPhone: (vals.driverPhone as string) ?? null, status: (vals.status as string) ?? "pending",
            fuelCost: String(vals.fuelCost ?? "0.00"), tollCost: String(vals.tollCost ?? "0.00"),
            otherCost: String(vals.otherCost ?? "0.00"), totalExpense: String(vals.totalExpense ?? "0.00"),
            arrivalDate: (vals.arrivalDate as Date) ?? new Date(), arrivalTime: (vals.arrivalTime as string) ?? null,
            unloadingTime: (vals.unloadingTime as string) ?? null, notes: (vals.notes as string) ?? null,
            createdAt: new Date(),
          });
          return Promise.resolve([{ insertId: id }]);
        }
        if (table === "arrivalItems") {
          const id = nextItemId++;
          arrivalItemsTable.push({
            id, arrivalId: vals.arrivalId as number, productId: vals.productId as number,
            quantity: String(vals.quantity ?? "0"), costPrice: String(vals.costPrice ?? "0.00"),
            sellingPrice: String(vals.sellingPrice ?? "0.00"), condition: (vals.condition as string) ?? null,
            notes: (vals.notes as string) ?? null,
          });
          return Promise.resolve([{ insertId: id }]);
        }
        if (table === "stockMovements") {
          const id = nextMovementId++;
          movementsTable.push({
            id, tenantId: vals.tenantId as number, productId: vals.productId as number,
            type: vals.type as string, quantity: String(vals.quantity ?? "0"),
            referenceType: (vals.referenceType as string) ?? null,
            referenceId: (vals.referenceId as number) ?? null,
            notes: (vals.notes as string) ?? null, createdAt: new Date(),
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
            let matched = 0;
            for (const row of rowsFor(tableOf(ref))) {
              if (!evalCond(row as Record<string, unknown>, cond as Record<string, unknown>)) continue;
              matched++;
              for (const [key, val] of Object.entries(patch)) {
                if (val !== undefined) row[key] = val;
              }
            }
            return Promise.resolve([{ affectedRows: matched }]);
          },
        };
      },
    }),
    delete: (ref: unknown) => ({
      where: (cond: Record<string, unknown>) => {
        const table = tableOf(ref);
        if (table === "arrivalItems") {
          arrivalItemsTable = arrivalItemsTable.filter((r) => !evalCond(r, cond));
        }
        if (table === "arrivals") {
          arrivalsTable = arrivalsTable.filter((r) => !evalCond(r, cond));
        }
        return Promise.resolve();
      },
    }),
    transaction: async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn(db),
    execute: (query: { values?: unknown[]; strings?: string[] }) => {
      const vals = query.values ?? [];
      const rawSql = (query.strings ?? []).join("?");

      // SELECT FROM arrival_items
      if (rawSql.includes("SELECT") && rawSql.includes("arrival_items")) {
        const arrivalId = vals.find((v) => typeof v === "number" && arrivalsTable.some((a) => a.id === v)) as number | undefined;
        if (arrivalId !== undefined) {
          const items = arrivalItemsTable.filter((i) => i.arrivalId === arrivalId);
          return Promise.resolve([items.map((i) => ({ ...i }))]);
        }
        return Promise.resolve([[]]);
      }

      // DELETE FROM arrival_items
      if (rawSql.includes("DELETE") && rawSql.includes("arrival_items")) {
        const arrivalId = vals[0] as number;
        arrivalItemsTable = arrivalItemsTable.filter((i) => i.arrivalId !== arrivalId);
        return Promise.resolve();
      }

      // SELECT FROM warehouse_stock (FOR UPDATE lock)
      // mysql2 format: [rows, fields]
      if (rawSql.includes("SELECT") && rawSql.includes("warehouse_stock")) {
        const tenantId = Number(vals[0]);
        const warehouseId = Number(vals[1]);
        const productId = Number(vals[2]);
        const existing = stockTable.filter(
          (s) => s.tenantId === tenantId && s.warehouseId === warehouseId && s.productId === productId,
        );
        return Promise.resolve([existing.map((s) => ({ id: s.id })), []]);
      }

      // UPDATE warehouse_stock
      if (rawSql.includes("UPDATE") && rawSql.includes("warehouse_stock")) {
        // SET current_stock = current_stock + qty, available = available + qty
        // WHERE tenant_id = ? AND warehouse_id = ? AND product_id = ?
        const qty = Number(vals[0]);
        const tenantId = Number(vals[2]);
        const warehouseId = Number(vals[3]);
        const productId = Number(vals[4]);
        const existing = stockTable.find(
          (s) => s.tenantId === tenantId && s.warehouseId === warehouseId && s.productId === productId,
        );
        if (existing) {
          existing.currentStock = String(Number(existing.currentStock) + qty);
          existing.available = String(Number(existing.available) + qty);
        }
        return Promise.resolve();
      }

      // INSERT INTO warehouse_stock
      if (rawSql.includes("INSERT") && rawSql.includes("warehouse_stock")) {
        if (vals.length >= 3) {
          const tenantId = Number(vals[0]);
          const warehouseId = Number(vals[1]);
          const productId = Number(vals[2]);
          const qty = Number(vals[3] ?? 0);
          const existing = stockTable.find((s) => s.productId === productId && s.warehouseId === warehouseId && s.tenantId === tenantId);
          if (existing) {
            const cur = Number(existing.currentStock);
            existing.currentStock = String(cur + qty);
            existing.available = String(cur + qty);
          } else {
            stockTable.push({
              id: nextStockId++, tenantId, productId, warehouseId,
              currentStock: String(qty), reserved: "0.00", available: String(qty),
            });
          }
        }
        return Promise.resolve();
      }

      return Promise.resolve();
    },
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("arrival.list", () => {
  it("returns arrivals with pagination", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    const result = await caller.list({ page: 1, pageSize: 10 });
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.data.map((a) => a.arrivalNumber)).toContain("ARR-000000000001");
    expect(result.data.map((a) => a.arrivalNumber)).toContain("ARR-000000000002");
  });

  it("filters by status", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    const result = await caller.list({ page: 1, pageSize: 10, status: "pending" });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].status).toBe("pending");
  });

  it("returns empty for non-matching status", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    const result = await caller.list({ page: 1, pageSize: 10, status: "unloading" });
    expect(result.data).toHaveLength(0);
  });
});

describe("arrival.getById", () => {
  it("returns arrival with items", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    const result = await caller.getById({ id: 1 });
    expect(result).not.toBeNull();
    expect(result!.id).toBe(1);
    expect(result!.arrivalNumber).toBe("ARR-000000000001");
    expect(result!.items).toHaveLength(2);
    expect(result!.items[0].productName).toBeDefined();
  });

  it("returns null for non-existent", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    const result = await caller.getById({ id: 999 });
    expect(result).toBeNull();
  });

  it("returns correct costPrice and sellingPrice", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    const result = await caller.getById({ id: 1 });
    expect(result!.items[0].costPrice).toBe("50.00");
    expect(result!.items[0].sellingPrice).toBe("80.00");
  });
});

describe("arrival.create", () => {
  it("creates arrival with items and calculates totalExpense", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 1));
    const result = await caller.create({
      arrivalDate: "2025-02-01",
      truckId: "T-999",
      driverName: "Тест",
      fuelCost: "100.00",
      tollCost: "20.00",
      otherCost: "30.00",
      items: [
        { productId: 1, quantity: "50", costPrice: "40.00", sellingPrice: "70.00" },
        { productId: 2, quantity: "30", costPrice: "20.00", sellingPrice: "35.00" },
      ],
    });
    expect(result.id).toBe(10);
    expect(result.arrivalNumber).toMatch(/^ARR-/);

    const created = arrivalsTable.find((a) => a.id === result.id)!;
    expect(created.status).toBe("pending");
    expect(created.totalExpense).toBe("150.00");
    expect(created.truckId).toBe("T-999");

    const items = arrivalItemsTable.filter((i) => i.arrivalId === result.id);
    expect(items).toHaveLength(2);
    expect(items[0].costPrice).toBe("40.00");
    expect(items[0].sellingPrice).toBe("70.00");
  });

  it("creates arrival without items", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 1));
    const result = await caller.create({ arrivalDate: "2025-02-01" });
    expect(result.id).toBe(10);
    const items = arrivalItemsTable.filter((i) => i.arrivalId === result.id);
    expect(items).toHaveLength(0);
  });
});

describe("arrival.update", () => {
  it("changes status from pending to unloading", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    const result = await caller.update({ id: 1, status: "unloading" });
    expect(result.success).toBe(true);
    expect(arrivalsTable.find((a) => a.id === 1)!.status).toBe("unloading");
  });

  it("blocks status change from completed to pending", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    await expect(caller.update({ id: 2, status: "pending" })).rejects.toThrow("Нельзя изменить статус завершённого прихода");
  });

  it("blocks status change from completed to unloading", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    await expect(caller.update({ id: 2, status: "unloading" })).rejects.toThrow("Нельзя изменить статус завершённого прихода");
  });

  it("completing arrival updates warehouse_stock", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    const result = await caller.update({ id: 1, status: "completed" });
    expect(result.success).toBe(true);
    expect(arrivalsTable.find((a) => a.id === 1)!.status).toBe("completed");

    // Stock should be updated: product 1 had 100, arrival adds 100 → 200
    const stock1 = stockTable.find((s) => s.productId === 1 && s.warehouseId === 1);
    expect(stock1).toBeDefined();
    expect(Number(stock1!.currentStock)).toBe(200);

    // Product 2 had no stock, arrival adds 50 → 50
    const stock2 = stockTable.find((s) => s.productId === 2 && s.warehouseId === 1);
    expect(stock2).toBeDefined();
    expect(Number(stock2!.currentStock)).toBe(50);
  });

  it("completing arrival creates stock movement records", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    await caller.update({ id: 1, status: "completed" });

    expect(movementsTable).toHaveLength(2);
    expect(movementsTable[0].type).toBe("in");
    expect(movementsTable[0].referenceType).toBe("arrival");
    expect(movementsTable[0].referenceId).toBe(1);
    expect(movementsTable[0].notes).toContain("ARR-000000000001");
  });

  it("completing arrival emits SSE event", async () => {
    const { sseBus } = await import("../lib/sse");
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    await caller.update({ id: 1, status: "completed" });
    expect(sseBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: "notification.new",
      data: expect.objectContaining({ type: "arrival.completed", arrivalId: 1 }),
    }));
  });

  it("updates fuelCost and recalculates totalExpense", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    await caller.update({ id: 1, fuelCost: "200.00", tollCost: "50.00", otherCost: "25.00" });
    const updated = arrivalsTable.find((a) => a.id === 1)!;
    expect(updated.fuelCost).toBe("200.00");
    expect(updated.totalExpense).toBe("275.00");
  });
});

describe("arrival.delete", () => {
  it("deletes pending arrival and its items", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    const result = await caller.delete({ id: 1 });
    expect(result.success).toBe(true);
    expect(arrivalsTable.find((a) => a.id === 1)).toBeUndefined();
    expect(arrivalItemsTable.filter((i) => i.arrivalId === 1)).toHaveLength(0);
  });

  it("prevents deleting completed arrival", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    await expect(caller.delete({ id: 2 })).rejects.toThrow("Нельзя удалить завершённый приход");
  });

  it("throws for non-existent arrival", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    await expect(caller.delete({ id: 999 })).rejects.toThrow("Приход не найден");
  });
});

describe("arrival — tenant isolation", () => {
  it("does not return arrivals from other tenants", async () => {
    arrivalsTable.push({
      id: 99, tenantId: 999, arrivalNumber: "ARR-OTHER", truckId: null, driverName: null,
      driverPhone: null, status: "pending", fuelCost: "0", tollCost: "0", otherCost: "0",
      totalExpense: "0", arrivalDate: new Date(), arrivalTime: null, unloadingTime: null,
      notes: null, createdAt: new Date(),
    });
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    const result = await caller.list();
    expect(result.data.every((a) => a.id !== 99)).toBe(true);
  });
});

describe("arrival.create — edge cases", () => {
  it("creates arrival with empty items array", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 1));
    const result = await caller.create({ arrivalDate: "2025-03-01", items: [] });
    expect(result.id).toBe(10);
    expect(arrivalItemsTable.filter((i) => i.arrivalId === result.id)).toHaveLength(0);
  });

  it("creates arrival with all optional fields", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 1));
    const result = await caller.create({
      arrivalDate: "2025-03-01",
      truckId: "T-500",
      driverName: "Али",
      driverPhone: "+998901112233",
      fuelCost: "75.00",
      tollCost: "15.00",
      otherCost: "10.00",
      notes: "Test arrival",
      items: [{ productId: 1, quantity: "25", costPrice: "45.00", sellingPrice: "70.00", condition: "good" }],
    });
    const created = arrivalsTable.find((a) => a.id === result.id)!;
    expect(created.totalExpense).toBe("100.00");
    expect(created.driverName).toBe("Али");
    expect(created.driverPhone).toBe("+998901112233");
    expect(created.notes).toBe("Test arrival");
    expect(arrivalItemsTable.filter((i) => i.arrivalId === result.id)).toHaveLength(1);
  });

  it("generates unique arrival numbers", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 1));
    const r1 = await caller.create({ arrivalDate: "2025-03-01" });
    const r2 = await caller.create({ arrivalDate: "2025-03-02" });
    expect(r1.arrivalNumber).not.toBe(r2.arrivalNumber);
  });
});

describe("arrival.update — edge cases", () => {
  it("updates notes on an arrival", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    await caller.update({ id: 1, notes: "Updated notes" });
    expect(arrivalsTable.find((a) => a.id === 1)!.notes).toBe("Updated notes");
  });

  it("updates driverName and driverPhone", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    await caller.update({ id: 1, driverName: "New Driver", driverPhone: "+998909998877" });
    const updated = arrivalsTable.find((a) => a.id === 1)!;
    expect(updated.driverName).toBe("New Driver");
    expect(updated.driverPhone).toBe("+998909998877");
  });

  it("transitions from pending to unloading", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    await caller.update({ id: 1, status: "unloading" });
    expect(arrivalsTable.find((a) => a.id === 1)!.status).toBe("unloading");
  });
});

describe("arrival.delete — edge cases", () => {
  it("deletes unloading arrival", async () => {
    arrivalsTable[0].status = "unloading";
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    const result = await caller.delete({ id: 1 });
    expect(result.success).toBe(true);
    expect(arrivalsTable.find((a) => a.id === 1)).toBeUndefined();
  });

  it("does not affect other arrivals when deleting", async () => {
    const { arrivalRouter } = await import("../arrival-router");
    const caller = arrivalRouter.createCaller(makeCtx(1, 10));
    await caller.delete({ id: 1 });
    expect(arrivalsTable.find((a) => a.id === 2)).toBeDefined();
  });
});
