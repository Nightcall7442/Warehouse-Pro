import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq:  (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
  and: (...conds: unknown[]) => ({ __kind: "and", conds }),
  // Поиск — по названию ИЛИ коду ИЛИ штрих-коду.
  or:  (...conds: unknown[]) => ({ __kind: "or", conds }),
  ne:  (col: unknown, val: unknown) => ({ __kind: "ne", col, val }),
  // Дополнительные штрих-коды читаются списком товаров страницы.
  inArray: (col: unknown, values: unknown[]) => ({ __kind: "inArray", col, values }),
  desc: (col: unknown) => ({ __kind: "desc", col }),
  like: (col: unknown, val: unknown) => ({ __kind: "like", col, val }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values }),
}));

vi.mock("../telegram-router", () => ({
  notifyAdmin: vi.fn(async () => {}),
  tgMessages: { newOrder: vi.fn(() => "mock message") },
}));

vi.mock("../lib/feature-gating", () => ({
  hasSubscriptionAccess: vi.fn(async () => true),
  checkSubscriptionAccess: vi.fn(async () => true),
  invalidateSubscriptionAccess: vi.fn(),
}));

vi.mock("../lib/sse", () => ({
  sseBus: { emit: vi.fn() },
}));

/*
  Предел тарифа по товарам — своей подстановкой.

  Настоящая checkPlanLimits идёт в базу за организацией и считает строки; в
  этом стенде организации нет, и она честно отвечает «0 из 0». Здесь проверяется
  не тариф, поэтому предел подставляется — и тем же рычагом проверяется отказ,
  когда он исчерпан.
*/
const { planLimits } = vi.hoisted(() => ({
  planLimits: vi.fn(async () => ({ allowed: true, current: 0, limit: null as number | null })),
}));
vi.mock("../lib/plan-limits", () => ({ checkPlanLimits: planLimits }));

vi.mock("../lib/sanitize", () => ({
  sanitizeString: (s: string) => s.replace(/<[^>]*>/g, "").trim(),
  sanitizeSearch: (s: string) => s.replace(/['";\\]/g, "").replace(/--/g, "").trim(),
}));

import { products, warehouseStock, orderItems, stockMovements, warehouses, productBarcodes, suppliers } from "@db/schema";
import { makeConditionEvaluator } from "./helpers/fake-conditions";

interface FakeProduct { id: number; tenantId: number; code: string; barcode: string; name: string; category: string; costPrice: string; unitPrice: string; unit: string; unitWeight: string; description: string | null; photoUrl: string | null; reorderPoint: string; reorderMax?: string | null; status: string; createdAt: Date; }
interface FakeStock { id: number; productId: number; tenantId: number; warehouseId: number; currentStock: string; reserved: string; available: string; }
interface FakeOrderItem { id: number; orderId: number; productId: number; quantity: string; unitPrice: string; subtotal: string; createdAt: Date; }
interface FakeStockMovement { id: number; tenantId: number; productId: number; type: string; quantity: string; notes: string | null; createdAt: Date; }
interface FakeWarehouse { id: number; tenantId: number; name: string; address: string; city: string; isDefault: boolean; status: string; createdAt: Date; }
interface FakeBarcode { id: number; tenantId: number; productId: number; barcode: string; }
interface FakeSupplier { id: number; tenantId: number; name: string; status: string; }

let productsTable: FakeProduct[] = [];
let stockTable: FakeStock[] = [];
let orderItemsTable: FakeOrderItem[] = [];
let movementsTable: FakeStockMovement[] = [];
let warehousesTable: FakeWarehouse[] = [];
let barcodesTable: FakeBarcode[] = [];
let suppliersTable: FakeSupplier[] = [];
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
  // Второй штрих-код у Widget A — этикетка другого поставщика; у соседней
  // организации тот же код ведёт к её товару.
  barcodesTable = [
    { id: 1, tenantId: 1, productId: 1, barcode: "EXTRA-A" },
    { id: 2, tenantId: 2, productId: 99, barcode: "EXTRA-B" },
  ];
  // Поставщики: свой действующий, свой выключенный и чужой.
  suppliersTable = [
    { id: 5, tenantId: 1, name: "Завод", status: "active" },
    { id: 6, tenantId: 1, name: "Старый завод", status: "inactive" },
    { id: 7, tenantId: 2, name: "Чужой завод", status: "active" },
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
  if (ref === productBarcodes) return "productBarcodes";
  if (ref === suppliers) return "suppliers";
  return "other";
}

function rowsFor(table: string): Record<string, unknown>[] {
  if (table === "products") return productsTable as unknown as Record<string, unknown>[];
  if (table === "warehouseStock") return stockTable as unknown as Record<string, unknown>[];
  if (table === "orderItems") return orderItemsTable as unknown as Record<string, unknown>[];
  if (table === "stockMovements") return movementsTable as unknown as Record<string, unknown>[];
  if (table === "warehouses") return warehousesTable as unknown as Record<string, unknown>[];
  if (table === "productBarcodes") return barcodesTable as unknown as Record<string, unknown>[];
  if (table === "suppliers") return suppliersTable as unknown as Record<string, unknown>[];
  return [];
}

const columnToFieldName = new Map<unknown, string>();
for (const [field, col] of Object.entries(products)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(warehouseStock)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(orderItems)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(stockMovements)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(warehouses)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(productBarcodes)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(suppliers)) columnToFieldName.set(col, field);

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
  fieldOf: col => columnToFieldName.get(col) ?? (col as { name?: string } | null)?.name,
  treatMissingColumnAsMatch: true,
  /*
    Один сырой sql`` стенд разбирает: «у товара есть дополнительный
    штрих-код» (services/product-barcodes.ts, hasExtraBarcode). Его
    подстановки — колонка товара, организация, код. Посчитай стенд его
    выполненным, как остальные, — поиск находил бы ВСЕ товары, и проверка
    «часть чужого штрих-кода — не находка» ниже потеряла бы смысл.
    Прочий сырой sql`` не воспроизводится и считается выполненным.
  */
  rawSql: (cond, row) => {
    const text = ((cond.strings as string[] | undefined) ?? []).join("?");
    if (!text.includes("product_barcodes")) return true;
    const [, tenantId, code] = cond.values as unknown[];
    return barcodesTable.some(b => b.productId === row.id && b.tenantId === tenantId && b.barcode.toLowerCase() === String(code).toLowerCase());
  },
});

function chainable(rows: Record<string, unknown>[]) {
  const p = Promise.resolve(rows) as Promise<Record<string, unknown>[]> & {
    limit?: (n: number) => ReturnType<typeof chainable>;
    offset?: (n: number) => ReturnType<typeof chainable>;
    orderBy?: (..._a: unknown[]) => ReturnType<typeof chainable>;
    groupBy?: (..._a: unknown[]) => ReturnType<typeof chainable>;
    for?: (_mode: string) => ReturnType<typeof chainable>;
  };
  p.limit = (n: number) => chainable(rows.slice(0, n));
  p.offset = (n: number) => chainable(rows.slice(n));
  p.orderBy = () => chainable(rows);
  /*
    Группировка сводит строки к неповторяющимся — как это делает база.

    Стенд её не знал, и проверка падала не на своей сути, а на «groupBy is
    not a function»: код читает принятые написания категорий запросом с
    GROUP BY, ровно как это делает product.categories рядом.

    Схлопываем по всем полям проекции: этого хватает и для одного столбца
    (категории), и для нескольких.
  */
  p.groupBy = () => {
    const seen = new Set<string>();
    const unique = rows.filter(r => {
      const key = JSON.stringify(r);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return chainable(unique);
  };
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
            reorderMax: (vals.reorderMax as string | null | undefined) ?? null,
            status: (vals.status as string) ?? "active", createdAt: new Date(),
          });
          return Promise.resolve([{ insertId: id }]);
        }
        if (table === "warehouseStock") {
          const id = nextStockId++;
          stockTable.push({
            id, tenantId: vals.tenantId as number, productId: vals.productId as number,
            warehouseId: Number(vals.warehouseId ?? 1),
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
        // Always simulate FK constraint error for products table (production DB always has FKs)
        if (table === "products") {
          return Promise.reject({ cause: { code: "ER_ROW_IS_REFERENCED", message: "Cannot delete or update a parent row: a foreign key constraint fails" } });
        }
        const keep = rowsFor(table).filter((r) => !evalCond(r, cond));
        if (table === "warehouseStock") stockTable = keep as unknown as FakeStock[];
        if (table === "orderItems") orderItemsTable = keep as unknown as FakeOrderItem[];
        return Promise.resolve();
      },
    }),
    transaction: async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn(db),
    // Simulate raw SQL execution for INSERT INTO warehouse_stock
    execute: (query: { values?: unknown[]; strings?: string[] }) => {
      const vals = query.values ?? [];
      // The sql template tag only captures interpolated ${...} values, not literal strings.
      // INSERT INTO warehouse_stock (...) VALUES (${tenantId}, ${warehouseId}, ${productId}, '0.00', '0.00', '0.00')
      // → values = [tenantId, warehouseId, productId]
      if (vals.length >= 3) {
        const tenantId = Number(vals[0]);
        const warehouseId = vals[1] !== undefined ? Number(vals[1]) : 1;
        const productId = Number(vals[2]);
        // Check if a stock row already exists for this product+warehouse
        const existing = stockTable.find((s) => s.productId === productId && s.warehouseId === warehouseId);
        if (existing) {
          existing.currentStock = "0.00";
          existing.reserved = "0.00";
          existing.available = "0.00";
        } else {
          const id = nextStockId++;
          stockTable.push({
            id, tenantId, productId, warehouseId,
            currentStock: "0.00", reserved: "0.00", available: "0.00",
          });
        }
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

  it("находит по коду и по штрих-коду целиком — скан со страницы «Штрих-коды» отвечает товаром", async () => {
    // Искалось только по названию: скан «BC002» отвечал «Товар не найден».
    const { productRouter } = await import("../product-router");
    const caller = productRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    expect(((await caller.list({ search: "BC002" })) as any).data.map((p: any) => p.id)).toEqual([2]);
    expect(((await caller.list({ search: "WA-001" })) as any).data.map((p: any) => p.id)).toEqual([1]);
    // часть чужого штрих-кода — не находка
    expect(((await caller.list({ search: "C00" })) as any).data).toHaveLength(0);
  });

  it("находит по дополнительному штрих-коду и отдаёт их списком; чужой организации — не находка", async () => {
    // Скан второй этикетки того же товара отвечал «ничего»: искали только
    // основной штрих-код.
    const { productRouter } = await import("../product-router");
    const caller = productRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    const hit = (await caller.list({ search: "extra-a" })) as any;
    expect(hit.data.map((p: any) => p.id)).toEqual([1]);
    expect(hit.data[0].barcodes).toEqual(["EXTRA-A"]);
    // Код соседней организации ведёт к её товару, а не к нашему.
    expect(((await caller.list({ search: "EXTRA-B" })) as any).data).toHaveLength(0);
    // Часть дополнительного кода — тоже не находка.
    expect(((await caller.list({ search: "EXTRA" })) as any).data).toHaveLength(0);
    // У товара без дополнительных — пустой список, а не отсутствие поля.
    const all = (await caller.list()) as any;
    expect(all.data.find((p: any) => p.id === 2).barcodes).toEqual([]);
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
    expect(result!.barcodes).toEqual(["EXTRA-A"]);
  });

  it("returns null for non-existent", async () => {
    const { productRouter } = await import("../product-router");
    const caller = productRouter.createCaller({ ...makeCtx(1, 10), db: mockDb });
    const result = await caller.getById({ id: 999 });
    expect(result).toBeNull();
  });
});

describe("product.create", () => {
  it("предел тарифа не даёт завести позицию сверх", async () => {
    /*
      Ради этого всё и делалось: до правки checkPlanLimits для товаров не звал
      никто, и число SKU на странице тарифов было обещанием, а не правилом.
      Отказ называет числа — «50 из 50» говорит, что делать дальше.
    */
    planLimits.mockResolvedValueOnce({ allowed: false, current: 50, limit: 50 });
    const { productRouter } = await import("../product-router");
    const caller = productRouter.createCaller({ ...makeCtx(1, 1), db: mockDb });
    const before = productsTable.length;
    await expect(caller.create({ code: "OVER-001", name: "Сверх предела", unitPrice: "10.00" }))
      .rejects.toThrow("50 из 50");
    expect(productsTable.length, "товар всё-таки завёлся").toBe(before);
  });

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

describe("product: поставщик по умолчанию", () => {
  /*
    Его подставит заказ поставщику. Номер приходит с клиента — значит,
    проверяется организация (чужой — «не найден», а не «нет доступа») и то,
    что поставщик не выключен: заказывать у него никто не станет.
  */
  it("свой действующий — записывается, null — снимается", async () => {
    const { productRouter } = await import("../product-router");
    const caller = productRouter.createCaller({ ...makeCtx(1, 1), db: mockDb });
    await caller.update({ id: 1, defaultSupplierId: 5 });
    expect((productsTable.find(p => p.id === 1) as unknown as { defaultSupplierId: number }).defaultSupplierId).toBe(5);
    await caller.update({ id: 1, defaultSupplierId: null });
    expect((productsTable.find(p => p.id === 1) as unknown as { defaultSupplierId: number | null }).defaultSupplierId).toBeNull();
  });

  it("чужой — «не найден», выключенный — отказ с именем; товар не тронут", async () => {
    const { productRouter } = await import("../product-router");
    const caller = productRouter.createCaller({ ...makeCtx(1, 1), db: mockDb });
    await expect(caller.update({ id: 1, defaultSupplierId: 7, name: "Новое" })).rejects.toMatchObject({ code: "NOT_FOUND", message: "Поставщик не найден" });
    await expect(caller.update({ id: 1, defaultSupplierId: 6 })).rejects.toThrow(/«Старый завод» выключен/);
    expect(productsTable.find(p => p.id === 1)!.name).toBe("Widget A");
    const before = productsTable.length;
    await expect(caller.create({ code: "N-1", name: "Новый", unitPrice: "10", defaultSupplierId: 7 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(productsTable.length).toBe(before);
  });

  it("карточка отдаёт его оператору, но не агенту — как и себестоимость", async () => {
    (productsTable[0] as unknown as { defaultSupplierId: number }).defaultSupplierId = 5;
    const { productRouter } = await import("../product-router");
    const asOperator = await productRouter.createCaller({ ...makeCtx(1, 1), db: mockDb }).getById({ id: 1 });
    expect(asOperator?.defaultSupplierId).toBe(5);
    const asAgent = await productRouter.createCaller({ ...makeCtx(1, 1, "agent"), db: mockDb }).getById({ id: 1 });
    expect(asAgent?.defaultSupplierId).toBeUndefined();
  });
});

describe("product: максимум запаса", () => {
  /*
    До скольких дозаказывать, когда остаток дошёл до точки. Пусто — вдвое
    больше точки (как «Дозаказ» считал до этого поля). Ниже точки — отказ:
    товар «заканчивается» на точке, и дозаказ должен поднять его выше, а не
    оставить там же. Проверяется то, что останется после правки.
  */
  const max = (id: number) => productsTable.find(p => p.id === id)!.reorderMax;

  it("записывается, снимается пустым полем; карточка его отдаёт", async () => {
    const { productRouter } = await import("../product-router");
    const caller = productRouter.createCaller({ ...makeCtx(1, 1), db: mockDb });
    await caller.update({ id: 1, reorderMax: "60" });
    expect(max(1)).toBe("60");
    expect((await caller.getById({ id: 1 }))?.reorderMax).toBe("60");
    await caller.update({ id: 1, reorderMax: "" });
    expect(max(1)).toBeNull();
  });

  it("ниже точки — отказ; новая точка выше прежнего максимума — тоже; товар не тронут", async () => {
    const { productRouter } = await import("../product-router");
    const caller = productRouter.createCaller({ ...makeCtx(1, 1), db: mockDb });
    // У товара точка 20.
    await expect(caller.update({ id: 1, reorderMax: "10" })).rejects.toThrow("Максимум запаса меньше точки заказа");
    expect(max(1) ?? null).toBeNull();

    await caller.update({ id: 1, reorderMax: "60" });
    await expect(caller.update({ id: 1, reorderPoint: "70.00", name: "Новое" })).rejects.toThrow("Максимум запаса меньше точки заказа");
    expect(productsTable.find(p => p.id === 1)!.reorderPoint).toBe("20.00");
    expect(productsTable.find(p => p.id === 1)!.name).toBe("Widget A");
    // Точку подняли вместе с максимумом — можно.
    await caller.update({ id: 1, reorderPoint: "70.00", reorderMax: "100" });
    expect(max(1)).toBe("100");

    const before = productsTable.length;
    await expect(caller.create({ code: "N-2", name: "Новый", unitPrice: "10", reorderPoint: "10.00", reorderMax: "5" }))
      .rejects.toThrow("Максимум запаса меньше точки заказа");
    expect(productsTable.length).toBe(before);
    const ok = await caller.create({ code: "N-3", name: "Новый", unitPrice: "10", reorderPoint: "10.00", reorderMax: "40" });
    expect(max(ok.id)).toBe("40");
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
