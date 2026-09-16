import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Обмен с 1С — против эмулятора OData (api/__tests__/helpers/fake-onec.ts) и
 * поддельной базы. Клиент, пресет имён и OneCMapper настоящие: что уходит в
 * 1С, проверяется по телу запроса, а не по вызову подменённой функции.
 */
vi.mock("drizzle-orm", async (orig) => ({
  ...(await orig<typeof import("drizzle-orm")>()),
  eq: (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
  and: (...conds: unknown[]) => ({ __kind: "and", conds }),
  inArray: (col: unknown, vals: unknown[]) => ({ __kind: "inArray", col, vals }),
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../lib/metrics", () => ({ record1CSync: vi.fn() }));

/*
  Предел тарифа по товарам — своей подстановкой.

  Настоящая checkPlanLimits идёт в базу за организацией и считает строки; в
  этом стенде организации нет, и она честно отвечает «0 из 0». Здесь проверяется
  не тариф, поэтому предел подставляется — и тем же рычагом проверяется отказ,
  когда он исчерпан.
*/
const { planLimits, fake } = vi.hoisted(() => ({
  planLimits: vi.fn(async () => ({ allowed: true, current: 0, limit: null as number | null })),
  fake: { current: null as null | { fetch: (u: string, i?: RequestInit) => Promise<Response> } },
}));
vi.mock("../../lib/plan-limits", () => ({ checkPlanLimits: planLimits }));
vi.mock("../onec-status", () => ({ updateSyncStatus: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../lib/safe-fetch", () => ({ safeFetch: (u: string, i?: RequestInit) => fake.current!.fetch(u, i) }));
vi.mock("../../lib/onec-bridge", async (orig) => {
  const m = await orig<typeof import("../../lib/onec-bridge")>();
  return { ...m, getBridgeForTenant: async () => new m.OneCBridge({ url: "http://onec.example.test/base", username: "odata", password: "secret", preset: "bp_uz" }) };
});

import { products, orders, orderItems, idMappings, warehouseStock, warehouses, onecConfig, payments } from "@db/schema";
import { FakeOneC } from "../../__tests__/helpers/fake-onec";
import { makeConditionEvaluator } from "../../__tests__/helpers/fake-conditions";
import { PRESETS } from "../../lib/onec-presets";

const N = PRESETS.bp_uz;

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let nextId = 1;
let executed = 0;

function resetTables() {
  for (const k of Object.keys(tables)) delete tables[k];
  Object.assign(tables, {
    products: [], orders: [], orderItems: [], idMappings: [], warehouseStock: [], payments: [],
    warehouses: [{ id: 1, tenantId: 1, name: "Main", isDefault: true, status: "active" }],
    onecConfig: [{ id: 1, tenantId: 1, priceTypeKey: "pt-opt", organizationKey: "org-1", warehouseKey: "wh-1", syncPayments: true, createdAt: new Date("2026-01-01") }],
  });
  nextId = 1;
  executed = 0;
}

const colToField = new Map<unknown, string>();
const refs: Array<[unknown, string]> = [[products, "products"], [orders, "orders"], [orderItems, "orderItems"], [idMappings, "idMappings"], [warehouses, "warehouses"], [warehouseStock, "warehouseStock"], [onecConfig, "onecConfig"], [payments, "payments"]];
for (const [ref] of refs) for (const [field, col] of Object.entries(ref as object)) colToField.set(col, field);
const tableOf = (ref: unknown) => refs.find(([r]) => r === ref)?.[1] ?? "other";
const rowsFor = (t: string) => tables[t] ?? [];

const evalCond = makeConditionEvaluator({
  fieldOf: col => colToField.get(col),
  treatMissingColumnAsMatch: true,
  rawSql: () => true,
});

function makeMockDb() {
  function selectBuilder() {
    let currentTable = "other";
    let joined = "";
    let onL = "", onR = "";
    const api: Record<string, unknown> = {
      from(ref: unknown) { currentTable = tableOf(ref); return api; },
      leftJoin(ref: unknown, onCond: unknown) {
        joined = tableOf(ref);
        const c = onCond as Row;
        const first = (c.__kind === "and" ? (c.conds as Row[])[0] : c) as Row;
        onL = colToField.get(first.col) ?? ""; onR = colToField.get(first.val) ?? "";
        return api;
      },
      where(cond: unknown) {
        let rows = rowsFor(currentTable).filter(r => evalCond(r, cond));
        if (joined) {
          const jrows = rowsFor(joined);
          rows = rows.map(r => ({ ...(jrows.find(j => j[onR] === r[onL]) ?? {}), ...r }));
          joined = "";
        }
        return Object.assign(Promise.resolve(rows), { limit: (n: number) => Promise.resolve(rows.slice(0, n)) });
      },
    };
    return api;
  }
  const db: Record<string, unknown> = {
    select: () => selectBuilder(),
    insert: (ref: unknown) => ({
      values: (vals: Row) => {
        const t = tableOf(ref);
        if (t === "products") {
          // Уникальный индекс uq_product_code_tenant — как в базе.
          const clash = rowsFor(t).find(p => p.tenantId === vals.tenantId && p.code === vals.code);
          if (clash) return Promise.reject(Object.assign(new Error(`Duplicate entry '${String(vals.code)}' for key 'products.uq_product_code_tenant'`), { code: "ER_DUP_ENTRY", errno: 1062, sqlMessage: `Duplicate entry '${String(vals.code)}' for key 'products.uq_product_code_tenant'` }));
        }
        const id = nextId++;
        rowsFor(t).push({ id, ...vals });
        return Promise.resolve([{ insertId: id }]);
      },
    }),
    update: (ref: unknown) => ({
      set: (patch: Row) => ({
        where: (cond: unknown) => { for (const r of rowsFor(tableOf(ref))) if (evalCond(r, cond)) Object.assign(r, patch); return Promise.resolve(); },
      }),
    }),
    delete: (ref: unknown) => ({
      where: (cond: unknown) => { const t = tableOf(ref); tables[t] = rowsFor(t).filter(r => !evalCond(r, cond)); return Promise.resolve(); },
    }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    // Дверь остатка пишет сырым SQL; здесь проверяется обмен, а не остаток.
    execute: async () => { executed++; return [[], []]; },
  };
  return db;
}

let mockDb: ReturnType<typeof makeMockDb>;
vi.mock("../../queries/connection", () => ({ getDb: () => mockDb }));

import { OneCSyncService } from "../onec-sync";
const syncService = new OneCSyncService();

let onec: FakeOneC;
const add = (set: string, row: Row) => onec.add(set, row);
const mapping = (entityType: string, externalId: string, internalId: number, lastSyncedAt: Date | null = null) =>
  tables.idMappings.push({ id: nextId++, tenantId: 1, entityType, externalId, internalId, lastSyncedAt });

/** Единица «шт» и товар в 1С с ценой опт 9500 (если не сказано иначе). */
function seedNomenclature(over: Row = {}, price: number | null = 9500) {
  const unit = add(N.units.set, { Description: "шт" });
  const item = add(N.nomenclature.set, { Description: "Средство универсальное", Code: "00000123", Артикул: "A61-14", ЕдиницаИзмерения_Key: unit.Ref_Key, ...over });
  if (price !== null) add(N.prices.set, { Номенклатура_Key: item.Ref_Key, ТипЦен_Key: "pt-opt", Цена: price });
  return item;
}

beforeEach(() => {
  resetTables();
  mockDb = makeMockDb();
  onec = new FakeOneC();
  fake.current = onec;
  planLimits.mockResolvedValue({ allowed: true, current: 0, limit: null });
});

describe("номенклатура из 1С", () => {
  it("товар без связи с 1С привязывается, а не заводится вторым", async () => {
    /*
      Ровно то, что случилось в боевой шестого сентября: товар в базе есть, а
      записи в id_mappings у него нет — обмен когда-то оборвался между вставкой
      и записью связи. Правильное поведение — привязать существующий товар.
    */
    tables.products.push({ id: 77, tenantId: 1, name: "Средство универсальное", code: "A61-14", unitPrice: "9500.00", unit: "pcs" });
    const item = seedNomenclature();

    const result = await syncService.syncProducts(1);

    expect(result.errors).toBe(0);
    expect(tables.products.filter(p => p.code === "A61-14")).toHaveLength(1);
    expect(tables.idMappings).toContainEqual(expect.objectContaining({ entityType: "product", externalId: item.Ref_Key, internalId: 77 }));
  });

  it("заводит товар: название, артикул, единица из справочника, цена выбранного типа", async () => {
    seedNomenclature();
    const kg = add(N.units.set, { Description: "кг" });
    const sugar = add(N.nomenclature.set, { Description: "Сахар", Code: "00000124", Артикул: "", ЕдиницаИзмерения_Key: kg.Ref_Key });
    add(N.prices.set, { Номенклатура_Key: sugar.Ref_Key, ТипЦен_Key: "pt-retail", Цена: 999 }); // другой тип цен — не наш

    const r = await syncService.syncProducts(1);

    expect(r).toEqual({ synced: 2, errors: 0, blockedByPlan: 0 });
    expect(tables.products).toEqual([
      expect.objectContaining({ name: "Средство универсальное", code: "A61-14", unit: "pcs", unitPrice: "9500.00" }),
      // Артикул пуст — берётся стандартный Code; цены нашего типа нет — 0.00
      expect.objectContaining({ name: "Сахар", code: "00000124", unit: "kg", unitPrice: "0.00" }),
    ]);
    // Остаток заведён через дверь остатка (сырым SQL) — для обоих товаров.
    expect(executed).toBeGreaterThanOrEqual(2);
    // Срез цен спрошен по нашему типу цен.
    expect(onec.requests.some(q => q.path.includes("SliceLast") && q.path.includes("pt-opt"))).toBe(true);
  });

  it("обновляет связанный товар; без цены в этом типе цен цену не трогает", async () => {
    tables.products.push({ id: 1, tenantId: 1, name: "Old Name", code: "001", unitPrice: "50.00", unit: "pcs" });
    const item = seedNomenclature({ Description: "Updated Name", Артикул: "001" }, null);
    mapping("product", String(item.Ref_Key), 1);

    const r = await syncService.syncProducts(1);
    expect(r.synced).toBe(1);
    expect(tables.products[0]).toMatchObject({ name: "Updated Name", unitPrice: "50.00" });
  });

  it("папки и помеченные на удаление не приезжают; пропавшее из 1С гаснет", async () => {
    seedNomenclature({ Description: "Папка «Бытовая химия»", IsFolder: true, Артикул: "F" });
    seedNomenclature({ Description: "Снятый", DeletionMark: true, Артикул: "D" });
    tables.products.push({ id: 5, tenantId: 1, name: "Был в 1С", code: "GONE", unitPrice: "1.00", unit: "pcs", status: "active" });
    mapping("product", "gone-key", 5);

    const r = await syncService.syncProducts(1);
    expect(r.synced).toBe(0);
    expect(tables.products.filter(p => p.code === "F" || p.code === "D")).toHaveLength(0);
    expect(tables.products[0].status).toBe("inactive");
  });

  it("предел тарифа: новые сверх места не заводятся, счётчик называет сколько", async () => {
    seedNomenclature({ Артикул: "A" });
    seedNomenclature({ Артикул: "B" });
    planLimits.mockResolvedValue({ allowed: true, current: 49, limit: 50 });

    const r = await syncService.syncProducts(1);
    expect(r).toEqual({ synced: 1, errors: 0, blockedByPlan: 1 });
    expect(tables.products).toHaveLength(1);
  });

  it("позиция без названия считается ошибкой, остальные проходят", async () => {
    seedNomenclature({ Description: "", Артикул: "X" });
    seedNomenclature({ Артикул: "Y" });
    const r = await syncService.syncProducts(1);
    expect(r).toMatchObject({ synced: 1, errors: 1 });
  });
});

/** Заказ с двумя позициями, магазин и товары сопоставлены. */
function seedOrder(over: Row = {}) {
  tables.orders.push({ id: 1, tenantId: 1, orderNumber: "ORD-001", shopId: 10, status: "delivered", subtotal: "1000.00", discount: "0.00", total: "1000.00", createdAt: new Date("2026-08-26T09:00:00Z"), deliveredAt: new Date("2026-08-27T10:00:00Z"), ...over });
  tables.orderItems.push({ id: 1, orderId: 1, productId: 5, quantity: "3.00", deliveredQuantity: null, unitPrice: "200.00" });
  tables.orderItems.push({ id: 2, orderId: 1, productId: 6, quantity: "2.00", deliveredQuantity: null, unitPrice: "200.00" });
  tables.products.push({ id: 5, tenantId: 1, code: "P5" }, { id: 6, tenantId: 1, code: "P6" });
  mapping("shop", "shop-uuid", 10);
  mapping("product", "prod-5", 5);
  mapping("product", "prod-6", 6);
}
const saleDocs = () => onec.rows(N.sale.set);

describe("реализация в 1С", () => {
  it("нет заказа — отказ", async () => {
    await expect(syncService.syncOrderTo1C(1, 999)).rejects.toThrow(/not found/);
  });

  it("магазин без контрагента — отказ до создания документа", async () => {
    seedOrder();
    tables.idMappings = tables.idMappings.filter(m => m.entityType !== "shop");
    await expect(syncService.syncOrderTo1C(1, 1)).rejects.toThrow(/not mapped/);
    expect(saleDocs()).toHaveLength(0);
  });

  it("без организации и склада в настройках — отказ словами, а не пустым документом", async () => {
    seedOrder();
    tables.onecConfig[0].organizationKey = null;
    await expect(syncService.syncOrderTo1C(1, 1)).rejects.toThrow(/не выбраны организация и склад/);
    expect(saleDocs()).toHaveLength(0);
  });

  it("собирает документ по именам пресета, находит договор, проводит и запоминает связь", async () => {
    seedOrder();
    const contract = add(N.contracts!.set, { Description: "Договор №1", Owner_Key: "shop-uuid", Организация_Key: "org-1" });

    await syncService.syncOrderTo1C(1, 1);

    const [doc] = saleDocs();
    expect(doc).toMatchObject({
      Организация_Key: "org-1", Контрагент_Key: "shop-uuid", Склад_Key: "wh-1",
      ДоговорКонтрагента_Key: contract.Ref_Key, ВидОперации: "РеализацияТоваров",
      Date: "2026-08-27T10:00:00.000", Комментарий: "Warehouse Pro: заказ ORD-001", Posted: true,
    });
    expect(doc.Товары).toEqual([
      { LineNumber: 1, Номенклатура_Key: "prod-5", Количество: 3, Цена: 200, Сумма: 600, СтавкаНДС: "НДС12", СуммаНДС: 64.29 },
      { LineNumber: 2, Номенклатура_Key: "prod-6", Количество: 2, Цена: 200, Сумма: 400, СтавкаНДС: "НДС12", СуммаНДС: 42.86 },
    ]);
    expect(onec.posted).toEqual([doc.Ref_Key]);
    expect(tables.idMappings).toContainEqual(expect.objectContaining({ entityType: "order", externalId: doc.Ref_Key, internalId: 1 }));
  });

  it("договора нет — заводится «Основной договор» с покупателем", async () => {
    seedOrder();
    await syncService.syncOrderTo1C(1, 1);
    const [contract] = onec.rows(N.contracts!.set);
    expect(contract).toMatchObject({ Description: "Основной договор", Owner_Key: "shop-uuid", Организация_Key: "org-1", ВидДоговора: "СПокупателем" });
    expect(saleDocs()[0].ДоговорКонтрагента_Key).toBe(contract.Ref_Key);
  });

  it("частичная доставка: в документ идёт довезённое, недовезённая строка выпадает", async () => {
    seedOrder();
    tables.orderItems[0].deliveredQuantity = "1.00";
    tables.orderItems[1].deliveredQuantity = "0.00";
    await syncService.syncOrderTo1C(1, 1);
    expect(saleDocs()[0].Товары).toEqual([expect.objectContaining({ Номенклатура_Key: "prod-5", Количество: 1, Сумма: 200 })]);
  });

  it("скидка заказа раскладывается по строкам: сумма документа равна сумме заказа", async () => {
    seedOrder({ subtotal: "1000.00", discount: "100.00", total: "900.00" });
    await syncService.syncOrderTo1C(1, 1);
    const lines = saleDocs()[0].Товары as Row[];
    expect(lines.map(l => l.Цена)).toEqual([180, 180]);
    expect(lines.reduce((s, l) => s + Number(l.Сумма), 0)).toBe(900);
  });

  it("товар без связи с 1С останавливает выгрузку — неполной накладной в 1С не появляется", async () => {
    seedOrder();
    tables.idMappings = tables.idMappings.filter(m => m.externalId !== "prod-6");
    await expect(syncService.syncOrderTo1C(1, 1)).rejects.toThrow(/не сопоставлен/);
    expect(saleDocs()).toHaveLength(0);
  });

  it("таймаут проведения: документ один, повтор только до-проводит", async () => {
    seedOrder();
    onec.intercept = (_m, p) => (p.endsWith("/Post") ? new Response("", { status: 504 }) : null);
    await expect(syncService.syncOrderTo1C(1, 1)).rejects.toThrow(/HTTP 504/);
    expect(saleDocs()).toHaveLength(1);
    // Связь записана ДО проведения — иначе повтор начнёт с создания.
    expect(tables.idMappings.find(m => m.entityType === "order")?.externalId).toBe(saleDocs()[0].Ref_Key);

    onec.intercept = null;
    await syncService.syncOrderTo1C(1, 1);
    expect(saleDocs()).toHaveLength(1);
    expect(onec.posted).toEqual([saleDocs()[0].Ref_Key]);
  });
});

describe("оплата в 1С", () => {
  it("платёж становится приходным кассовым ордером и проводится", async () => {
    mapping("shop", "shop-uuid", 10);
    tables.payments.push({ id: 3, tenantId: 1, shopId: 10, orderId: 1, amount: "450.50", type: "payment", paymentMethod: "cash", paidAt: new Date("2026-08-28T12:00:00Z"), createdAt: new Date("2026-08-28T12:00:00Z") });

    await syncService.syncPaymentTo1C(1, 3);

    const [pko] = onec.rows(N.cashIn!.set);
    expect(pko).toMatchObject({ Организация_Key: "org-1", Контрагент_Key: "shop-uuid", СуммаДокумента: 450.5, ВидОперации: "ОплатаПокупателя", Комментарий: "Warehouse Pro: оплата №3 по заказу 1", Posted: true });
    expect(tables.idMappings).toContainEqual(expect.objectContaining({ entityType: "payment", externalId: pko.Ref_Key, internalId: 3 }));
  });

  it("перевод и карта — не ПКО: безнал приходит в 1С из выписки, очередь ждёт решения", async () => {
    mapping("shop", "shop-uuid", 10);
    tables.payments.push({ id: 5, tenantId: 1, shopId: 10, amount: "100.00", type: "payment", paymentMethod: "transfer", createdAt: new Date() });
    await expect(syncService.syncPaymentTo1C(1, 5)).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("из выписки банка") });
    expect(onec.rows(N.cashIn!.set)).toHaveLength(0);
  });

  it("запись долга — не оплата, ПКО не создаётся", async () => {
    tables.payments.push({ id: 4, tenantId: 1, shopId: 10, amount: "100.00", type: "debt", createdAt: new Date() });
    await expect(syncService.syncPaymentTo1C(1, 4)).rejects.toThrow(/не оплата/);
    expect(onec.rows(N.cashIn!.set)).toHaveLength(0);
  });
});
