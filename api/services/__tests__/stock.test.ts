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
  id: number; productId: number; tenantId: number; warehouseId: number;
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
  fieldOf: col => colToField.get(col),
  treatMissingColumnAsMatch: true,
  // Сырой sql`` этот стенд не воспроизводит; условие считается выполненным.
  // Решение записано здесь, а не спрятано в умолчании разборщика.
  rawSql: () => true,
});

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
    // Корректировка идёт через дверь остатка — арифметику считает общая
    // подделка (helpers/mock-execute), а не свой разбор текста запроса.
    execute: createExecuteMock(stockTable as never),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return db;
}

let mockDb: ReturnType<typeof makeMockDb>;
vi.mock("../../queries/connection", () => ({ getDb: () => mockDb }));

beforeEach(() => {
  resetTables();
  mockDb = makeMockDb();
});

import { StockService } from "../stock";
import { makeConditionEvaluator } from "../../../api/__tests__/helpers/fake-conditions";
import { createExecuteMock } from "../../../api/__tests__/helpers/mock-execute";

/*
  Здесь были наборы для StockService.reserve, .release и .deduct.

  Они проходили годами — и проверяли код, который не вызывал НИКТО: остаток
  каждый путь менял сам, сырым SQL. Зелёные тесты на мёртвом коде вреднее
  отсутствующих: по ним кажется, что операция работает и ей пользуются.

  Сами операции переехали в api/services/stock-ledger.ts, и там их проверяют
  два набора: stock-door-shape (форма запроса, без базы) и real-db/stock-door*
  (арифметика на настоящей базе). Adjust остался — он один и вызывался.
*/
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
    // Written with the scale the decimal(12,2) column stores it at.
    expect(movementsTable[0].quantity).toBe("25.00");
    expect(movementsTable[0].notes).toBe("New shipment");
  });

  it("adjustment type sets currentStock to exact quantity", async () => {
    await StockService.adjust(mockDb as any, 1, 1, 75, "adjustment");

    const stock = stockTable.find((s) => s.productId === 1)!;
    expect(stock.currentStock).toBe("75.00");
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
