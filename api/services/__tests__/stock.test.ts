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
    inArray: (col: unknown, values: unknown[]) => ({ __kind: "inArray", col, values }),
    sql: sqlFn,
  };
});

vi.mock("../../lib/sse", () => ({
  sseBus: { emit: vi.fn() },
}));

import { warehouseStock, stockMovements, products, warehouses } from "@db/schema";
import { sseBus } from "../../lib/sse";

type FakeStock = {
  id: number; productId: number; tenantId: number;
  currentStock: string; reserved: string; available: string;
};
type FakeMovement = {
  id: number; tenantId: number; productId: number;
  type: string; quantity: string; notes?: string; createdAt: Date;
};
type FakeProduct = {
  id: number; name: string; reorderPoint: string;
};

let stockTable: FakeStock[] = [];
let movementsTable: FakeMovement[] = [];
let productsTable: FakeProduct[] = [];
let warehousesTable: { id: number; tenantId: number; name: string; isDefault: boolean; status: string }[] = [];
let nextMovementId = 1;

function resetTables() {
  stockTable = [
    { id: 1, productId: 1, tenantId: 1, warehouseId: 1, currentStock: "100.00", reserved: "0.00", available: "100.00" },
    { id: 2, productId: 2, tenantId: 1, warehouseId: 1, currentStock: "50.00", reserved: "10.00", available: "40.00" },
  ];
  movementsTable = [];
  productsTable = [
    { id: 1, name: "Product A", reorderPoint: "10.00" },
    { id: 2, name: "Product B", reorderPoint: "20.00" },
  ];
  warehousesTable = [
    { id: 1, tenantId: 1, name: "Main", isDefault: true, status: "active" },
  ];
  nextMovementId = 1;
}

function tableOf(ref: unknown): string {
  if (ref === warehouseStock) return "warehouseStock";
  if (ref === stockMovements) return "stockMovements";
  if (ref === products) return "products";
  if (ref === warehouses) return "warehouses";
  return "other";
}

function rowsFor(table: string): unknown[] {
  const map: Record<string, unknown[]> = {
    warehouseStock: stockTable,
    stockMovements: movementsTable,
    products: productsTable,
  };
  if (table === "warehouses") return warehousesTable;
  return map[table] ?? [];
}

const colToField = new Map<unknown, string>();
for (const [f, c] of Object.entries(warehouseStock)) colToField.set(c, f);
for (const [f, c] of Object.entries(stockMovements)) colToField.set(c, f);
for (const [f, c] of Object.entries(products)) colToField.set(c, f);
for (const [f, c] of Object.entries(warehouses)) colToField.set(c, f);

function evalCond(row: unknown, cond: unknown): boolean {
  if (!cond || typeof cond !== "object") return true;
  const c = cond as Record<string, unknown>;
  if (c.__kind === "and") return (c.conds as unknown[]).every((child: unknown) => evalCond(row, child));
  if (c.__kind === "eq") {
    const col = c.col as { name?: string } | string;
    const val = c.val as { name?: string } | string | number;
    const fn = (typeof col === "object" && col !== null ? (colToField.get(col) ?? col.name ?? col) : colToField.get(col) ?? (typeof col === "string" ? col : "")) as string;
    const r = row as Record<string, unknown>;
    return r[fn] === val || String(r[fn]) === String(val);
  }
  return true;
}

function evalSqlDelta(row: unknown, fieldName: string, expr: unknown): string {
  if (!expr || typeof expr !== "object") return (row as Record<string, string>)[fieldName];
  const e = expr as Record<string, unknown>;
  if (e.__kind !== "sql") return (row as Record<string, string>)[fieldName];
  const opStr = (e.strings as string[]).find((s: string) => s.includes("+") || s.includes("-")) ?? "";
  const op = opStr.includes("+") ? "+" : "-";
  const amount = Number((e.values as unknown[])[(e.values as unknown[]).length - 1]);
  const current = Number((row as Record<string, string>)[fieldName]);
  return (op === "+" ? current + amount : current - amount).toFixed(2);
}

function makeMockDb() {
  const selectBuilder = () => {
    let tbl = "";
    const wrap = (arr: unknown[]) => Object.assign(Promise.resolve(arr), {
      limit: (n: number) => wrap(arr.slice(0, n)),
      orderBy: () => wrap(arr),
      for: () => wrap(arr),
    });
    const api: Record<string, unknown> = {
      from(ref: unknown) { tbl = tableOf(ref); return api; },
      where(cond: unknown) {
        const filtered = rowsFor(tbl).filter((r) => evalCond(r, cond));
        return wrap(filtered);
      },
      limit(n: number) { return wrap(rowsFor(tbl).slice(0, n)); },
    };
    return api;
  };

  const updateBuilder = (tbl: string) => ({
    set(patch: Record<string, unknown>) {
      return {
        where(cond: unknown) {
          for (const row of rowsFor(tbl)) {
            if (!evalCond(row, cond)) continue;
            const r = row as Record<string, unknown>;
            for (const [key, val] of Object.entries(patch)) {
              r[key] = val && typeof val === "object" && (val as Record<string, unknown>).__kind === "sql"
                ? evalSqlDelta(row, key, val) : val;
            }
          }
          return Promise.resolve();
        },
      };
    },
  });

  const db = {
    select: () => selectBuilder(),
    insert: (ref: unknown) => ({
      values: (vals: unknown) => {
        const tbl = tableOf(ref);
        if (tbl === "stockMovements") {
          const list = Array.isArray(vals) ? (vals as Record<string, unknown>[]) : [vals as Record<string, unknown>];
          for (const v of list) {
            movementsTable.push({
              id: nextMovementId++, tenantId: v.tenantId as number, productId: v.productId as number,
              type: v.type as string, quantity: String(v.quantity), notes: v.notes as string | undefined,
              createdAt: new Date(),
            });
          }
          return Promise.resolve([{ insertId: nextMovementId }]);
        }
        return Promise.resolve([{ insertId: 1 }]);
      },
    }),
    update: (ref: unknown) => updateBuilder(tableOf(ref)),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
    execute: (sqlObj: unknown) => {
      if (!sqlObj || typeof sqlObj !== "object" || (sqlObj as Record<string, unknown>).__kind !== "sql") return Promise.resolve();
      const s = sqlObj as { strings: string[]; values: unknown[] };
      const fullSql = s.strings.join("");
      if (!fullSql.includes("UPDATE warehouse_stock")) return Promise.resolve();

      const updates: Array<{ productId: number; field: string; op: string; amount: number }> = [];
      const isCreatePattern = fullSql.includes("reserved = reserved +") || fullSql.includes("available = available -");
      const isDeductPattern = fullSql.includes("current_stock = current_stock -") && fullSql.includes("reserved = reserved -");

      let caseIndex = 0;
      for (const val of s.values) {
        if (!val || typeof val !== "object") continue;
        const obj = val as Record<string, unknown>;
        if (obj.__kind === "sql_join" && Array.isArray(obj.chunks)) {
          if (caseIndex < 2) {
            const field = isDeductPattern ? (caseIndex === 0 ? "currentStock" : "reserved") : (caseIndex === 0 ? "reserved" : "available");
            const op = isCreatePattern ? (caseIndex === 0 ? "+" : "-") : (isDeductPattern ? "-" : (caseIndex === 0 ? "-" : "+"));
            for (const chunk of obj.chunks) {
              if (!chunk || typeof chunk !== "object") continue;
              const c = chunk as { __kind: string; strings: string[]; values: unknown[] };
              if (c.__kind !== "sql") continue;
              updates.push({ productId: Number(c.values[0]), field, op, amount: Number(c.values[1]) });
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

beforeEach(() => {
  resetTables();
  mockDb = makeMockDb();
});

import { StockService } from "../stock";
import { isDomainError, type DomainError } from "../../lib/domain-error";

/** Run `fn` and return the DomainError it rejected with. */
async function rejection(fn: () => Promise<unknown>): Promise<DomainError> {
  try {
    await fn();
  } catch (err) {
    if (isDomainError(err)) return err;
    throw new Error(`expected a DomainError, got ${String(err)}`);
  }
  throw new Error("expected a rejection");
}

describe("StockService.reserve", () => {
  it("deducts available and increases reserved", async () => {
    await StockService.reserve(mockDb as any, 1, [{ productId: 1, quantity: 20 }]);

    const stock = stockTable.find((s) => s.productId === 1)!;
    expect(stock.available).toBe("80.00");
    expect(stock.reserved).toBe("20.00");
    expect(stock.currentStock).toBe("100.00");
  });

  it("reserves multiple products atomically", async () => {
    await StockService.reserve(mockDb as any, 1, [
      { productId: 1, quantity: 10 },
      { productId: 2, quantity: 5 },
    ]);

    expect(stockTable.find((s) => s.productId === 1)!.available).toBe("90.00");
    expect(stockTable.find((s) => s.productId === 2)!.available).toBe("35.00");
  });

  it("throws when available stock is insufficient", async () => {
    await expect(
      StockService.reserve(mockDb as any, 1, [{ productId: 1, quantity: 200 }]),
    ).rejects.toThrow(/Недостаточно товара/);

    expect(stockTable.find((s) => s.productId === 1)!.reserved).toBe("0.00");
  });

  it("throws when stock row does not exist for product", async () => {
    await expect(
      StockService.reserve(mockDb as any, 1, [{ productId: 999, quantity: 1 }]),
    ).rejects.toThrow(/Недостаточно товара/);
  });
});

describe("StockService.release", () => {
  it("restores available and decreases reserved", async () => {
    await StockService.release(mockDb as any, 1, [{ productId: 2, quantity: 10 }]);

    const stock = stockTable.find((s) => s.productId === 2)!;
    expect(stock.reserved).toBe("0.00");
    expect(stock.available).toBe("50.00");
  });

  it("releases multiple items", async () => {
    await StockService.reserve(mockDb as any, 1, [{ productId: 1, quantity: 30 }]);
    await StockService.release(mockDb as any, 1, [{ productId: 1, quantity: 30 }]);

    const stock = stockTable.find((s) => s.productId === 1)!;
    expect(stock.reserved).toBe("0.00");
    expect(stock.available).toBe("100.00");
  });
});

describe("StockService.deduct", () => {
  it("reduces currentStock and reserved on completion", async () => {
    await StockService.reserve(mockDb as any, 1, [{ productId: 1, quantity: 10 }]);
    await StockService.deduct(mockDb as any, 1, [{ productId: 1, quantity: 10 }]);

    const stock = stockTable.find((s) => s.productId === 1)!;
    expect(stock.currentStock).toBe("90.00");
    expect(stock.reserved).toBe("0.00");
  });

  it("deducts from multiple products", async () => {
    await StockService.deduct(mockDb as any, 1, [
      { productId: 1, quantity: 5 },
      { productId: 2, quantity: 10 },
    ]);

    expect(stockTable.find((s) => s.productId === 1)!.currentStock).toBe("95.00");
    expect(stockTable.find((s) => s.productId === 2)!.currentStock).toBe("40.00");
  });
});

describe("StockService.adjust", () => {
  it("positive adjustment (in) increases currentStock and available", async () => {
    const result = await StockService.adjust(mockDb as any, 1, 1, 50, "in", "Restocked");

    expect(result.success).toBe(true);
    const stock = stockTable.find((s) => s.productId === 1)!;
    expect(stock.currentStock).toBe("150.00");
    expect(stock.available).toBe("150.00");
  });

  it("negative adjustment (out) decreases currentStock and available", async () => {
    await StockService.adjust(mockDb as any, 1, 1, 20, "out");

    const stock = stockTable.find((s) => s.productId === 1)!;
    expect(stock.currentStock).toBe("80.00");
    expect(stock.available).toBe("80.00");
  });

  it("records a stock movement entry", async () => {
    await StockService.adjust(mockDb as any, 1, 1, 25, "in", "New shipment");

    expect(movementsTable).toHaveLength(1);
    expect(movementsTable[0].type).toBe("in");
    expect(movementsTable[0].quantity).toBe("25");
    expect(movementsTable[0].notes).toBe("New shipment");
  });

  it("adjustment type sets currentStock to exact quantity", async () => {
    await StockService.adjust(mockDb as any, 1, 1, 75, "adjustment");

    const stock = stockTable.find((s) => s.productId === 1)!;
    expect(stock.currentStock).toBe("75");
  });

  it("emits stock.low event when out adjustment drops below reorder point", async () => {
    await StockService.adjust(mockDb as any, 1, 1, 95, "out");

    expect(sseBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "stock.low",
        tenantId: 1,
        data: expect.objectContaining({ productId: 1, productName: "Product A" }),
      }),
    );
  });
});

/**
 * Running out of stock is the warehouse telling the caller "no", not the server
 * falling over — before `DomainError` every one of these arrived at the client as
 * `500 INTERNAL_SERVER_ERROR` with a stack trace and a Sentry event. StockService
 * is also driven from the 1C sync and the public REST API, so the category has to
 * be carried by the error itself.
 */
describe("StockService domain error categories", () => {
  it("reports insufficient available stock on reserve as CONFLICT", async () => {
    const err = await rejection(() =>
      StockService.reserve(mockDb as any, 1, [{ productId: 1, quantity: 200 }]));
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toBe("Недостаточно товара на складе (доступно: 100, запрошено: 200)");
  });

  it("reports over-releasing a reservation as CONFLICT", async () => {
    const err = await rejection(() =>
      StockService.release(mockDb as any, 1, [{ productId: 2, quantity: 999 }]));
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toBe("Недостаточно зарезервированного товара (зарезервировано: 10, запрошено: 999)");
  });

  it("reports insufficient stock on deduct as CONFLICT", async () => {
    const err = await rejection(() =>
      StockService.deduct(mockDb as any, 1, [{ productId: 1, quantity: 500 }]));
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toBe("Недостаточно товара на складе (на складе: 100, запрошено: 500)");
  });

  it("reports an out-adjustment below zero as CONFLICT", async () => {
    const err = await rejection(() => StockService.adjust(mockDb as any, 1, 1, 500, "out"));
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toBe("Недостаточно товара на складе (на складе: 100, запрошено: 500)");
  });

  it("reports a non-positive quantity as BAD_REQUEST", async () => {
    expect((await rejection(() => StockService.adjust(mockDb as any, 1, 1, 0, "in"))).code)
      .toBe("BAD_REQUEST");
    const err = await rejection(() => StockService.adjust(mockDb as any, 1, 1, -5, "in"));
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe("Количество должно быть положительным числом");
  });

  /**
   * A tenant with no default warehouse is a setup mistake the operator can fix,
   * which is how the order domain already treats it (order/stock-manager.ts).
   */
  it("reports a missing default warehouse as CONFLICT, not a 500", async () => {
    warehousesTable.length = 0;
    const err = await rejection(() =>
      StockService.reserve(mockDb as any, 1, [{ productId: 1, quantity: 1 }]));
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toBe("Склад по умолчанию не найден");
  });
});
