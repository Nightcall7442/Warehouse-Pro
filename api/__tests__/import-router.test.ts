/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TrpcContext } from "../context";
import { asTestContext } from "./helpers/test-context";

vi.mock("drizzle-orm", () => {
  const sqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values });
  return {
    eq: (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
    and: (...conds: unknown[]) => ({ __kind: "and", conds }),
    sql: sqlFn,
    relations: () => ({}),
  };
});

vi.mock("../lib/cache", () => ({
  withCache: async (_k: string, _t: number, produce: () => unknown) => produce(),
  cache: { get: () => undefined, set: () => {}, invalidate: () => {}, invalidatePrefix: vi.fn() },
  CacheKeys: { dashboardKpis: () => "", commissions: () => "" },
  CacheTTL: { commissions: 60 },
}));

vi.mock("../lib/env", () => ({
  env: { s3Bucket: "", s3AccessKey: "", s3SecretKey: "", s3Region: "" },
}));

vi.mock("../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

let mockDb: any;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

import { products, shops, warehouseStock, warehouses } from "@db/schema";
import { makeConditionEvaluator } from "./helpers/fake-conditions";

let productsTable: any[] = [];
let shopsTable: any[] = [];
let warehouseStockTable: any[] = [];
let warehousesTable: any[] = [];
let nextId = 500;

function resetTables() {
  productsTable = [];
  shopsTable = [];
  warehouseStockTable = [];
  warehousesTable = [
    { id: 1, tenantId: 1, name: "Main", isDefault: true, status: "active" },
  ];
  nextId = 500;
}

const colToField = new Map<unknown, string>();
// Takes a drizzle table, whose type is nothing like Record<string, unknown> —
// the narrower signature made every call site an error without catching
// anything, since the body only ever reads one property by name.
function reg(table: object, name: string) { colToField.set((table as Record<string, unknown>)[name], name); }
reg(products, "id"); reg(products, "tenantId"); reg(products, "name"); reg(products, "code");
reg(products, "barcode"); reg(products, "category"); reg(products, "costPrice");
reg(products, "unitPrice"); reg(products, "unit"); reg(products, "unitWeight");
reg(products, "reorderPoint"); reg(products, "description"); reg(products, "photoUrl"); reg(products, "status");
reg(shops, "id"); reg(shops, "tenantId"); reg(shops, "name"); reg(shops, "ownerName");
reg(shops, "phone"); reg(shops, "city"); reg(shops, "district"); reg(shops, "address");
reg(shops, "debt"); reg(shops, "gpsLat"); reg(shops, "gpsLng"); reg(shops, "notes"); reg(shops, "status");
reg(warehouses, "id"); reg(warehouses, "tenantId"); reg(warehouses, "isDefault");
reg(warehouseStock, "id"); reg(warehouseStock, "tenantId"); reg(warehouseStock, "warehouseId");
reg(warehouseStock, "productId"); reg(warehouseStock, "currentStock");

function mapCol(col: unknown): string { return colToField.get(col) ?? (col as any)?.name ?? String(col); }

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
  chain.where = (cond: unknown) => buildChain(rows.filter(r => evalCond(r, cond)));
  chain.orderBy = () => chain;
  chain.leftJoin = () => chain;
  chain.innerJoin = () => chain;
  chain.groupBy = () => chain;
  chain.for = () => chain;
  return chain;
}

function useTable(col: unknown): Record<string, unknown>[] {
  if (col === products) return productsTable;
  if (col === shops) return shopsTable;
  if (col === warehouses) return warehousesTable;
  if (col === warehouseStock) return warehouseStockTable;
  return [];
}

function makeMockDb() {
  const db: any = {};
  db.select = () => {
    const sel: any = {};
    sel.from = (table: any) => {
      const primaryRows = useTable(table);
      const from: any = {};
      from.where = (cond: unknown) => buildChain(primaryRows.filter((r: any) => evalCond(r, cond)));
      from.then = (resolve: any, reject: any) => Promise.resolve(primaryRows).then(resolve, reject);
      from.limit = (n: number) => buildChain(primaryRows.slice(0, n));
      from.orderBy = () => from;
      from.groupBy = () => from;
      from.leftJoin = () => from;
      from.innerJoin = () => from;
      return from;
    };
    return sel;
  };
  db.insert = (table: any) => ({
    values: vi.fn((vals: any) => {
      const list = Array.isArray(vals) ? vals : [vals];
      const firstId = nextId;
      for (const v of list) {
        const id = nextId++;
        if (table === products) productsTable.push({ id, ...v, createdAt: new Date() });
        else if (table === shops) shopsTable.push({ id, ...v, createdAt: new Date() });
        else if (table === warehouses) warehousesTable.push({ id, ...v });
      }
      return [{ insertId: firstId }];
    }),
  });
  db.execute = (sqlObj: any) => {
    if (sqlObj?.__kind === "sql") {
      const strs = sqlObj.strings ?? sqlObj.rawStrings;
      const vals = sqlObj.values ?? sqlObj.rawValues;
      const fullSql = strs.join("");
      if (fullSql.includes("INSERT INTO warehouse_stock")) {
        const v = vals;
        warehouseStockTable.push({
          id: nextId++, tenantId: v[0], warehouseId: v.length > 4 ? v[1] : undefined,
          productId: v.length > 4 ? v[2] : v[1],
          currentStock: v.length > 4 ? v[3] : v[2],
          reserved: "0.00",
          available: v.length > 4 ? v[5] ?? v[3] : v[2],
        });
        return Promise.resolve([]);
      }
      if (fullSql.includes("MAX(CAST(code AS UNSIGNED))")) {
        // Форма ответа здесь принципиальна. Настоящий mysql2 отдаёт кортеж
        // [rows, fields], то есть строка лежит в [0][0]. Мок, возвращавший
        // просто [], подтверждал бы «максимум не найден» одинаково и для
        // верного кода, и для кода, читающего maxCode прямо с массива строк, —
        // а именно этой ошибкой второй импорт и падал по дубликату ключа.
        const numeric = productsTable
          .map(pr => String(pr.code ?? ""))
          .filter(c => /^[0-9]+$/.test(c))
          .map(Number);
        const maxCode = numeric.length ? String(Math.max(...numeric)) : null;
        return Promise.resolve([[{ maxCode }], []]);
      }
    }
    return Promise.resolve([]);
  };
  db.transaction = (fn: (tx: any) => Promise<any>) => fn(db);
  return db;
}

function buildCtx(overrides: Record<string, unknown> = {}): TrpcContext {
  return asTestContext({
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    db: mockDb,
    tenant: { id: 1, slug: "test", name: "Test Org", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    user: { id: 10, tenantId: 1, role: "ceo" as const, status: "active" as const, name: "CEO", email: "ceo@test.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    ...overrides,
  });
}

/** Create a minimal CSV as base64 */
function csvBase64(headers: string[], rows: string[][]): string {
  const lines = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  return Buffer.from("\uFEFF" + lines, "utf-8").toString("base64");
}

beforeEach(() => {
  resetTables();
  mockDb = makeMockDb();
});

describe("import.downloadTemplate", () => {
  it("returns base64 xlsx for products template", async () => {
    const { importRouter } = await import("../import-router");
    const caller = importRouter.createCaller(buildCtx());
    const result = await caller.downloadTemplate({ type: "products" });
    expect(result.base64).toBeDefined();
    expect(result.base64.length).toBeGreaterThan(100);
    expect(result.filename).toBe("template-products.xlsx");
  });

  it("returns base64 xlsx for shops template", async () => {
    const { importRouter } = await import("../import-router");
    const caller = importRouter.createCaller(buildCtx());
    const result = await caller.downloadTemplate({ type: "shops" });
    expect(result.filename).toBe("template-shops.xlsx");
  });
});

describe("import.previewImport", () => {
  it("preview products CSV", async () => {
    const base64 = csvBase64(
      ["Название", "Код", "Цена продажи", "Себестоимость", "Ед. измерения"],
      [["Tomato", "T001", "12000", "8000", "kg"]],
    );
    const { importRouter } = await import("../import-router");
    const caller = importRouter.createCaller(buildCtx());
    const result = await caller.previewImport({ type: "products", base64, filename: "test.csv" });
    expect(result.headers.length).toBe(5);
    expect(result.preview.length).toBe(1);
    expect(result.preview[0].name).toBe("Tomato");
    expect(result.totalRows).toBe(1);
  });

  it("preview shops CSV", async () => {
    const base64 = csvBase64(
      ["Название", "Владелец", "Телефон", "Город"],
      [["Shop One", "John", "+998901234567", "Tashkent"]],
    );
    const { importRouter } = await import("../import-router");
    const caller = importRouter.createCaller(buildCtx());
    const result = await caller.previewImport({ type: "shops", base64, filename: "shops.csv" });
    expect(result.preview.length).toBe(1);
    expect(result.preview[0].name).toBe("Shop One");
  });

  it("limits preview to 5 rows", async () => {
    const base64 = csvBase64(
      ["Название"],
      Array.from({ length: 10 }, (_, i) => [`Product ${i + 1}`]),
    );
    const { importRouter } = await import("../import-router");
    const caller = importRouter.createCaller(buildCtx());
    const result = await caller.previewImport({ type: "products", base64, filename: "big.csv" });
    expect(result.preview.length).toBe(5);
    expect(result.totalRows).toBe(10);
  });

  it("throws on empty CSV", async () => {
    const base64 = Buffer.from("", "utf-8").toString("base64");
    const { importRouter } = await import("../import-router");
    const caller = importRouter.createCaller(buildCtx());
    await expect(caller.previewImport({ type: "products", base64, filename: "empty.csv" }))
      .rejects.toThrow();
  });
});

describe("import.executeImport", () => {
  it("imports products from CSV", async () => {
    const base64 = csvBase64(
      ["Название", "Код", "Цена продажи", "Себестоимость", "Ед. измерения", "Остаток на складе"],
      [
        ["Tomato", "T001", "12000", "8000", "kg", "50"],
        ["Cucumber", "C001", "9000", "6000", "kg", "30"],
      ],
    );
    const { importRouter } = await import("../import-router");
    const caller = importRouter.createCaller(buildCtx());
    const result = await caller.executeImport({ type: "products", base64, filename: "import.csv" });
    expect(result.success).toBe(2);
    expect(result.errors.length).toBe(0);
    expect(productsTable.length).toBe(2);
    expect(productsTable[0].name).toBe("Tomato");
    expect(productsTable[0].unit).toBe("kg");
  });

  it("автокоды продолжают нумерацию, а не начинаются с 000001 заново", async () => {
    // Товар с числовым кодом уже есть — значит следующий автокод обязан быть 43.
    productsTable.push({ id: 500, tenantId: 1, name: "Существующий", code: "000042", status: "active" });

    const base64 = csvBase64(
      ["Название", "Цена продажи", "Себестоимость", "Ед. измерения"],
      [["Без кода", "1000", "800", "kg"]],
    );
    const { importRouter } = await import("../import-router");
    const caller = importRouter.createCaller(buildCtx());
    await caller.executeImport({ type: "products", base64, filename: "import.csv" });

    const imported = productsTable.find(pr => pr.name === "Без кода");
    expect(imported?.code).toBe("000043");
  });

  it("второй импорт без кодов не повторяет коды первого", async () => {
    // Ровно тот отказ, что видел пользователь: на products стоит уникальный
    // индекс по (code, tenant_id), поэтому повтор кода — не косметика, а
    // падение импорта по дубликату ключа.
    const { importRouter } = await import("../import-router");
    const caller = importRouter.createCaller(buildCtx());
    const csv = () => csvBase64(
      ["Название", "Цена продажи", "Себестоимость", "Ед. измерения"],
      [["Первый", "1000", "800", "kg"], ["Второй", "2000", "1500", "kg"]],
    );

    await caller.executeImport({ type: "products", base64: csv(), filename: "a.csv" });
    await caller.executeImport({ type: "products", base64: csv(), filename: "b.csv" });

    const codes = productsTable.map(pr => pr.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("imports shops from CSV", async () => {
    const base64 = csvBase64(
      ["Название", "Владелец", "Телефон", "Город"],
      [
        ["Shop A", "Owner A", "+998901111111", "Tashkent"],
        ["Shop B", "Owner B", "+998902222222", "Samarkand"],
      ],
    );
    const { importRouter } = await import("../import-router");
    const caller = importRouter.createCaller(buildCtx());
    const result = await caller.executeImport({ type: "shops", base64, filename: "shops.csv" });
    expect(result.success).toBe(2);
    expect(shopsTable.length).toBe(2);
    expect(shopsTable[0].name).toBe("Shop A");
  });

  it("skips products with missing names", async () => {
    const base64 = csvBase64(
      ["Название", "Код"],
      [["", "X001"], ["Valid", "V001"]],
    );
    const { importRouter } = await import("../import-router");
    const caller = importRouter.createCaller(buildCtx());
    const result = await caller.executeImport({ type: "products", base64, filename: "test.csv" });
    expect(result.success).toBe(1);
    expect(result.errors.some((e: string) => e.includes("нет названия"))).toBe(true);
  });

  it("skips shops with missing names", async () => {
    const base64 = csvBase64(
      ["Название"],
      [[""], ["Valid Shop"]],
    );
    const { importRouter } = await import("../import-router");
    const caller = importRouter.createCaller(buildCtx());
    const result = await caller.executeImport({ type: "shops", base64, filename: "test.csv" });
    expect(result.success).toBe(1);
  });

  it("creates default warehouse if none exists for products", async () => {
    warehousesTable = [];
    const base64 = csvBase64(
      ["Название", "Код"],
      [["Test Product", "TP001"]],
    );
    const { importRouter } = await import("../import-router");
    const caller = importRouter.createCaller(buildCtx());
    await caller.executeImport({ type: "products", base64, filename: "test.csv" });
    expect(warehousesTable.some(w => w.name === "Основной склад")).toBe(true);
  });

  it("uses existing default warehouse for stock records", async () => {
    const base64 = csvBase64(
      ["Название", "Код", "Остаток на складе"],
      [["Stock Item", "SI001", "100"]],
    );
    const { importRouter } = await import("../import-router");
    const caller = importRouter.createCaller(buildCtx());
    await caller.executeImport({ type: "products", base64, filename: "test.csv" });
    expect(warehouseStockTable.length).toBeGreaterThanOrEqual(1);
  });

  it("translates unit names (кг → kg)", async () => {
    const base64 = csvBase64(
      ["Название", "Код", "Ед. измерения"],
      [["Milk", "M001", "кг"]],
    );
    const { importRouter } = await import("../import-router");
    const caller = importRouter.createCaller(buildCtx());
    await caller.executeImport({ type: "products", base64, filename: "test.csv" });
    expect(productsTable[0].unit).toBe("kg");
  });

  it("defaults unit to pcs for unknown values", async () => {
    const base64 = csvBase64(
      ["Название", "Код", "Ед. измерения"],
      [["Item", "I001", "дюжина"]],
    );
    const { importRouter } = await import("../import-router");
    const caller = importRouter.createCaller(buildCtx());
    await caller.executeImport({ type: "products", base64, filename: "test.csv" });
    expect(productsTable[0].unit).toBe("pcs");
  });

  it("returns zero success for empty file", async () => {
    const base64 = Buffer.from("Название\n", "utf-8").toString("base64");
    const { importRouter } = await import("../import-router");
    const caller = importRouter.createCaller(buildCtx());
    const result = await caller.executeImport({ type: "products", base64, filename: "empty.csv" });
    expect(result.success).toBe(0);
    expect(result.total).toBe(0);
  });
});
