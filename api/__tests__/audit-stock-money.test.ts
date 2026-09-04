/**
 * Склад и деньги: находки аудита, направление «склад-и-деньги».
 *
 * Здесь проверяется ПОВЕДЕНИЕ, а не текст исходника: каждая проверка вызывает
 * настоящую функцию (OrderService.getById, StockService.adjust,
 * OrderService.create, courier.completeDelivery) на поддельной базе и смотрит,
 * что осталось в таблицах. На прежнем коде каждая из них падает.
 *
 * Разбирается семь находок:
 *   1. order.getById принимал роль вызывающего и игнорировал её (_opts).
 *   2. warehouse.adjustStock не проверял принадлежность товара организации.
 *   3. Ручное списание сверялось с current_stock, а не с available.
 *   4. Коллизия номера заказа не ретраилась, если передан ключ идемпотентности.
 *   5. partial_returned без списка позиций закрывал заказ, не трогая склад.
 *   6. Дата долга в свободном формате роняла завершение доставки.
 *   7. paidAmount «50,000» проводил доставку без платежа.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Заглушки модулей, которые к находкам отношения не имеют ─────────────────
vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  return drizzleMock();
});
vi.mock("../lib/rate-limit", async () => {
  const { rateLimitMock } = await import("./helpers/rate-limit-mock");
  return rateLimitMock();
});
vi.mock("../lib/sse", () => ({ sseBus: { emit: vi.fn() } }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/sanitize", () => ({
  sanitizeString: (s: string) => String(s).replace(/<[^>]*>/g, "").trim(),
  sanitizeSearch: (s: string) => String(s).replace(/['";\\]/g, "").trim(),
}));
vi.mock("../lib/feature-gating", () => ({
  hasSubscriptionAccess: vi.fn(async () => true),
  checkSubscriptionAccess: vi.fn(async () => true),
  invalidateSubscriptionAccess: vi.fn(),
}));
vi.mock("../telegram-router", () => ({
  notifyAdmin: vi.fn(async () => {}),
  tgMessages: { newOrder: vi.fn(() => "mock") },
}));
vi.mock("../services/audit-log", () => ({ recordAudit: vi.fn() }));
vi.mock("../services/stock-ledger", () => ({ recordStockMovement: vi.fn(async () => {}) }));
vi.mock("../services/shop-debt", () => ({ recalcShopDebt: vi.fn(async () => {}) }));
vi.mock("../services/push-service", () => ({
  sendPushToUser: vi.fn(async () => {}),
  sendPushToRole: vi.fn(async () => {}),
}));

import {
  orders, orderItems, products, shops, users, warehouses, warehouseStock,
  payments, notifications, debtReminders, territories, orderAdjustments,
} from "@db/schema";
import { makeConditionEvaluator } from "./helpers/fake-conditions";
import { createExecuteMock } from "./helpers/mock-execute";

// ── Поддельные таблицы ──────────────────────────────────────────────────────
type Row = Record<string, any>;

const tables = new Map<unknown, Row[]>();
function reg(ref: unknown, rows: Row[]) { tables.set(ref, rows); return rows; }
function rowsOf(ref: unknown): Row[] { return tables.get(ref) ?? []; }

let ordersT: Row[], orderItemsT: Row[], productsT: Row[], shopsT: Row[], usersT: Row[];
let warehousesT: Row[], stockT: Row[], paymentsT: Row[], debtRemindersT: Row[];

function resetTables() {
  tables.clear();
  ordersT = reg(orders, []);
  orderItemsT = reg(orderItems, []);
  productsT = reg(products, []);
  shopsT = reg(shops, []);
  usersT = reg(users, []);
  warehousesT = reg(warehouses, []);
  stockT = reg(warehouseStock, []);
  paymentsT = reg(payments, []);
  debtRemindersT = reg(debtReminders, []);
  // Таблицы, в которые проверяемый код только пишет: без них запись упала бы
  // на «неизвестная таблица», а держать для них отдельные переменные незачем.
  reg(notifications, []);
  reg(territories, []);
  reg(orderAdjustments, []);
}

// Карта «объект колонки → имя поля» строится из самой схемы: так поддельная
// строка и настоящий запрос говорят об одном и том же поле.
const columnToField = new Map<unknown, string>();
for (const table of [orders, orderItems, products, shops, users, warehouses, warehouseStock, payments, notifications, debtReminders, territories, orderAdjustments]) {
  for (const [field, col] of Object.entries(table as unknown as Record<string, unknown>)) columnToField.set(col, field);
}

/**
 * Сырой sql`` разбирается ровно там, где он несёт условие отбора, и нигде
 * больше. Всё непонятое — ошибка стенда: считать его выполненным значит
 * позволить тесту подтвердить что угодно.
 */
const evalCond = makeConditionEvaluator({
  fieldOf: col => columnToField.get(col) ?? (col as { name?: string } | null)?.name,
  treatMissingColumnAsMatch: false,
  rawSql: (cond: Row, row: Row) => {
    const text = ((cond.strings as string[]) ?? []).join("?");
    const values = ((cond.values as any[]) ?? []);
    // Единственная форма сырого sql в условиях проверяемого кода — членство:
    // `${колонка} IN (...)`, где список либо перечислен литералами
    // ('assigned', 'out_for_delivery'), либо собран sql.join из id.
    if (text.includes(" IN (")) {
      const field = columnToField.get(values[0]);
      if (!field) throw new Error(`Стенд не узнал колонку в sql: ${text}`);
      const literals = [...text.matchAll(/'([^']*)'/g)].map(m => m[1]);
      if (literals.length > 0) return literals.includes(String(row[field]));
      const ids = new Set<string>();
      for (const v of values) {
        if (v && v.__kind === "sql_join" && Array.isArray(v.chunks)) {
          for (const c of v.chunks) if (c && c.__kind === "sql") ids.add(String(c.values[0]));
        }
      }
      if (ids.size === 0) throw new Error(`Стенд не собрал список для sql: ${text}`);
      return ids.has(String(row[field]));
    }
    throw new Error(`Стенд не разбирает sql: ${text}`);
  },
});

/** Присваивание из drizzle `.set()`: обычное значение либо sql`col ± число`. */
function applySet(row: Row, patch: Row) {
  for (const [key, val] of Object.entries(patch)) {
    if (val === undefined) continue;
    if (val && typeof val === "object" && (val as any).__kind === "sql") {
      const strings = (val as any).strings as string[];
      const values = (val as any).values as any[];
      const op = strings.join("").includes("-") ? -1 : 1;
      const amount = Number(values[values.length - 1]);
      row[key] = (Number(row[key] ?? 0) + op * amount).toFixed(2);
      continue;
    }
    row[key] = val;
  }
}

function chainable(rows: Row[]): any {
  const p: any = Promise.resolve(rows);
  p.limit = (n: number) => chainable(rows.slice(0, n));
  p.offset = (n: number) => chainable(rows.slice(n));
  p.orderBy = () => chainable(rows);
  p.groupBy = () => chainable(rows);
  p.for = () => chainable(rows);
  return p;
}

/** Перехват вставки: так стенд воспроизводит гонку за номер и за ключ. */
let insertHooks = new Map<unknown, (vals: Row) => void>();
let nextId = 1000;

function makeDb() {
  const db: any = {
    select: (fields?: Row) => {
      let table: unknown = null;
      const api: any = {
        from(ref: unknown) { table = ref; return api; },
        leftJoin() { return api; },
        innerJoin() { return api; },
        where(cond: unknown) {
          const rows = rowsOf(table).filter(r => evalCond(r, cond as Row));
          // nextOrderNumber считает агрегаты одним запросом; поддельная база
          // отвечает на него посчитанными значениями, иначе номер всегда №1.
          if (fields && "maxNumbered" in fields) {
            const maxNumbered = rows.reduce((m, r) => Math.max(m, Number(String(r.orderNumber ?? "").replace("№", "")) || 0), 0);
            return chainable([{ total: rows.length, maxNumbered }]);
          }
          return chainable(rows);
        },
        limit(n: number) { return chainable(rowsOf(table).slice(0, n)); },
        orderBy() { return chainable(rowsOf(table)); },
        groupBy() { return chainable(rowsOf(table)); },
        for() { return chainable(rowsOf(table)); },
      };
      return api;
    },
    insert: (ref: unknown) => ({
      values(vals: Row | Row[]) {
        const list = Array.isArray(vals) ? vals : [vals];
        const hook = insertHooks.get(ref);
        if (hook) hook(list[0]);
        let lastId = 0;
        for (const v of list) {
          lastId = nextId++;
          rowsOf(ref).push({ id: lastId, ...v });
        }
        return Promise.resolve([{ insertId: lastId }]);
      },
    }),
    update: (ref: unknown) => ({
      set(patch: Row) {
        return {
          where(cond: unknown) {
            let matched = 0;
            for (const row of rowsOf(ref)) {
              if (!evalCond(row, cond as Row)) continue;
              matched++;
              applySet(row, patch);
            }
            return Promise.resolve([{ affectedRows: matched }]);
          },
        };
      },
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    transaction: async (fn: (tx: any) => Promise<unknown>) => fn(db),
    execute: (query: any) => {
      const text = ((query?.strings as string[]) ?? []).join("?");
      if (text.includes("UPDATE warehouse_stock") && text.includes("CASE")) {
        return createExecuteMock(stockT as any)(query);
      }
      return Promise.resolve();
    },
  };
  return db;
}

let mockDb: any;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

beforeEach(() => {
  resetTables();
  insertHooks = new Map();
  nextId = 1000;
  mockDb = makeDb();
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. order.getById и роль вызывающего
// ═══════════════════════════════════════════════════════════════════════════
describe("order.getById: чужой заказ не отдаётся полевой роли", () => {
  beforeEach(() => {
    shopsT.push({ id: 1, tenantId: 1, name: "Лавка", address: "ул. 1", city: "Ташкент", phone: "+998901112233", debt: "4200000.00", ownerName: "Каримов А.", territoryId: null });
    usersT.push({ id: 10, tenantId: 1, name: "Агент Свой", role: "agent" });
    usersT.push({ id: 11, tenantId: 1, name: "Агент Чужой", role: "agent" });
    ordersT.push({ id: 1, tenantId: 1, orderNumber: "№1", status: "new", total: "100.00", subtotal: "100.00", discount: "0.00", notes: null, createdAt: new Date(), updatedAt: new Date(), shopId: 1, agentId: 10, courierId: null, deliveryStatus: "none", deliveredAt: null, deletedAt: null, paymentMethod: "cash", invoicePrintedAt: null });
    ordersT.push({ id: 2, tenantId: 1, orderNumber: "№2", status: "new", total: "9900000.00", subtotal: "9900000.00", discount: "0.00", notes: null, createdAt: new Date(), updatedAt: new Date(), shopId: 1, agentId: 11, courierId: null, deliveryStatus: "none", deliveredAt: null, deletedAt: null, paymentMethod: "debt", invoicePrintedAt: null });
  });

  it("агент видит свой заказ", async () => {
    const { OrderService } = await import("../services/order");
    const got = await OrderService.getById(mockDb, 1, 1, { userId: 10, userRole: "agent" });
    expect(got?.id).toBe(1);
  });

  it("агент не получает заказ другого агента своей же организации", async () => {
    const { OrderService } = await import("../services/order");
    // Раньше здесь возвращался чужой заказ целиком: сумма, состав с ценами и
    // блок shop с телефоном, владельцем и долгом магазина.
    const got = await OrderService.getById(mockDb, 1, 2, { userId: 10, userRole: "agent" });
    expect(got).toBeNull();
  });

  it("мерчендайзер не получает вообще ничего — своих заказов у него нет", async () => {
    const { OrderService } = await import("../services/order");
    for (const id of [1, 2]) {
      expect(await OrderService.getById(mockDb, 1, id, { userId: 77, userRole: "merchandiser" })).toBeNull();
    }
  });

  it("оператору, руководителю и супервайзеру доступен любой заказ организации", async () => {
    const { OrderService } = await import("../services/order");
    for (const role of ["operator", "ceo", "supervisor", "superadmin"]) {
      const got = await OrderService.getById(mockDb, 1, 2, { userId: 5, userRole: role });
      expect(got?.id, `роль ${role} должна видеть чужой заказ`).toBe(2);
      expect(got?.shop?.debt).toBe("4200000.00");
    }
  });

  it("без opts (внутренний вызов) поведение прежнее — заказ отдаётся", async () => {
    const { OrderService } = await import("../services/order");
    expect((await OrderService.getById(mockDb, 1, 2))?.id).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 и 3. StockService.adjust
// ═══════════════════════════════════════════════════════════════════════════
describe("StockService.adjust: чужой товар и остаток в минус", () => {
  beforeEach(() => {
    warehousesT.push({ id: 1, tenantId: 1, name: "Основной", isDefault: true });
    warehousesT.push({ id: 2, tenantId: 2, name: "Чужой", isDefault: true });
    // Товар 1 — наш, товар 900 — организации 2.
    productsT.push({ id: 1, tenantId: 1, name: "Сахар", reorderPoint: "10.000", costPrice: "9000.00", unitPrice: "12000.00" });
    productsT.push({ id: 900, tenantId: 2, name: "Чужой товар", reorderPoint: "5.000", costPrice: "111111.00", unitPrice: "222222.00" });
  });

  const stockRow = (over: Row = {}) => {
    const row = { id: 1, tenantId: 1, warehouseId: 1, productId: 1, currentStock: "100.00", reserved: "100.00", available: "0.00", ...over };
    stockT.push(row);
    return row;
  };

  it("товар чужой организации отвергается и строки остатка не создаёт", async () => {
    const { StockService } = await import("../services/stock");
    await expect(StockService.adjust(mockDb, 1, 900, 1, "in")).rejects.toThrow(/не найден в вашей организации/);
    // Главное последствие прежнего кода: строка warehouse_stock с tenant_id=1 и
    // чужим product_id, через которую warehouse.list отдавал чужую себестоимость.
    expect(stockT).toHaveLength(0);
    // И названия чужого товара в тексте ошибки быть не должно.
    await expect(StockService.adjust(mockDb, 1, 900, 1, "in")).rejects.not.toThrow(/Чужой товар/);
  });

  it("явно переданный чужой склад отвергается", async () => {
    const { StockService } = await import("../services/stock");
    await expect(StockService.adjust(mockDb, 1, 1, 5, "in", undefined, undefined, 2))
      .rejects.toThrow(/Склад не найден в вашей организации/);
    expect(stockT).toHaveLength(0);
  });

  it("списание боя при полностью зарезервированном остатке отвергается", async () => {
    const row = stockRow(); // 100 на складе, 100 в резерве, 0 свободно
    const { StockService } = await import("../services/stock");
    await expect(StockService.adjust(mockDb, 1, 1, 20, "out", "бой"))
      .rejects.toThrow(/зарезервировано под заказы/);
    // Прежний код проверял current_stock: 100 >= 20 — списание проходило и
    // загоняло available в −20, а падало это потом в OrderService.create.
    expect(row.available).toBe("0.00");
    expect(row.currentStock).toBe("100.00");
  });

  it("в тексте отказа названы и остаток, и резерв — иначе отказ непонятен", async () => {
    stockRow({ currentStock: "100.00", reserved: "100.00", available: "0.00" });
    const { StockService } = await import("../services/stock");
    await expect(StockService.adjust(mockDb, 1, 1, 20, "out")).rejects.toThrow(/100/);
    await expect(StockService.adjust(mockDb, 1, 1, 20, "out")).rejects.toThrow(/свободно: 0/);
  });

  it("списание в пределах свободного остатка проходит и сохраняет инвариант", async () => {
    const row = stockRow({ currentStock: "100.00", reserved: "40.00", available: "60.00" });
    const { StockService } = await import("../services/stock");
    await StockService.adjust(mockDb, 1, 1, 20, "out", "бой");
    expect(row.currentStock).toBe("80.00");
    expect(row.available).toBe("40.00");
    expect(Number(row.currentStock)).toBe(Number(row.available) + Number(row.reserved));
  });

  it("инвентаризация ниже резерва отвергается", async () => {
    const row = stockRow({ currentStock: "100.00", reserved: "100.00", available: "0.00" });
    const { StockService } = await import("../services/stock");
    await expect(StockService.adjust(mockDb, 1, 1, 80, "adjustment", "пересчёт"))
      .rejects.toThrow(/меньше зарезервированного/);
    expect(row.currentStock).toBe("100.00");
    expect(row.available).toBe("0.00");
  });

  it("инвентаризация выше резерва проходит и сохраняет инвариант", async () => {
    const row = stockRow({ currentStock: "100.00", reserved: "100.00", available: "0.00" });
    const { StockService } = await import("../services/stock");
    await StockService.adjust(mockDb, 1, 1, 120, "adjustment", "пересчёт");
    expect(row.currentStock).toBe("120");
    expect(row.available).toBe("20.00");
    expect(Number(row.currentStock)).toBe(Number(row.available) + Number(row.reserved));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Коллизия номера заказа при переданном ключе идемпотентности
// ═══════════════════════════════════════════════════════════════════════════
describe("order.create: коллизия номера ретраится даже с ключом идемпотентности", () => {
  function dupError(indexName: string) {
    return Object.assign(new Error(`Duplicate entry for key '${indexName}'`), {
      code: "ER_DUP_ENTRY",
      errno: 1062,
      sqlState: "23000",
      sqlMessage: `Duplicate entry 'x' for key 'orders.${indexName}'`,
    });
  }

  beforeEach(() => {
    shopsT.push({ id: 1, tenantId: 1, name: "Лавка", status: "active" });
    warehousesT.push({ id: 1, tenantId: 1, name: "Основной", isDefault: true });
    productsT.push({ id: 1, tenantId: 1, name: "Сахар", status: "active", unitPrice: "12000.00", costPrice: "9000.00" });
    stockT.push({ id: 1, tenantId: 1, warehouseId: 1, productId: 1, currentStock: "100.00", reserved: "0.00", available: "100.00" });
    usersT.push({ id: 5, tenantId: 1, name: "CEO", role: "ceo", status: "active" });
    // 149 уже оформленных заказов: следующий номер — №150.
    for (let i = 1; i <= 149; i++) {
      ordersT.push({ id: i, tenantId: 1, orderNumber: `№${i}`, status: "new", shopId: 1, agentId: 10, idempotencyKey: null, deletedAt: null, total: "0.00", subtotal: "0.00", discount: "0.00" });
    }
  });

  it("занятый номер берётся следующий, заказ из офлайн-очереди уходит с первой попытки", async () => {
    let attempts = 0;
    insertHooks.set(orders, (vals) => {
      attempts++;
      if (vals.orderNumber === "№150") {
        // Соседний заказ той же пачки успел закоммитить №150.
        ordersT.push({ id: 500, tenantId: 1, orderNumber: "№150", status: "new", shopId: 1, agentId: 10, idempotencyKey: "other-key", deletedAt: null, total: "0.00", subtotal: "0.00", discount: "0.00" });
        throw dupError("uq_order_number_tenant");
      }
    });

    const { OrderService } = await import("../services/order");
    const created = await OrderService.create(mockDb, 1, 10, {
      shopId: 1,
      items: [{ productId: 1, quantity: "2" }],
      idempotencyKey: "queued-order-3",
    });

    // Прежний код отключал ретрай, раз ключ передан: агент получал 500, мобилка
    // помечала запись retryable:false, и очередь вставала до ручного «Повторить».
    expect(attempts).toBe(2);
    expect(created.orderNumber).toBe("№151");
    const saved = ordersT.find(o => o.orderNumber === "№151");
    expect(saved?.idempotencyKey).toBe("queued-order-3");
  });

  it("дубликат по ключу идемпотентности отдаёт уже созданный заказ, а не новый", async () => {
    let attempts = 0;
    insertHooks.set(orders, (vals) => {
      attempts++;
      // Параллельный повтор того же запроса успел вставить заказ по тому же ключу.
      ordersT.push({ id: 700, tenantId: 1, orderNumber: "№150", status: "new", shopId: 1, agentId: 10, idempotencyKey: vals.idempotencyKey, deletedAt: null, total: "0.00", subtotal: "0.00", discount: "0.00" });
      throw dupError("uq_orders_idempotency");
    });

    const { OrderService } = await import("../services/order");
    const created = await OrderService.create(mockDb, 1, 10, {
      shopId: 1,
      items: [{ productId: 1, quantity: "2" }],
      idempotencyKey: "queued-order-3",
    });

    expect(created).toMatchObject({ id: 700, orderNumber: "№150", idempotent: true });
    // По ключу второй заказ не создаётся — и номер не перебирается впустую.
    expect(attempts).toBe(1);
  });

  it("имя индекса читается из sqlMessage, а не из наличия ключа", async () => {
    const { isIdempotencyDuplicate } = await import("../services/order");
    expect(isIdempotencyDuplicate(dupError("uq_orders_idempotency"))).toBe(true);
    expect(isIdempotencyDuplicate(dupError("uq_order_number_tenant"))).toBe(false);
    // Драйвер без имени индекса: считаем коллизией номера — тогда вставка
    // повторится, а если дело было в ключе, внешний обработчик вернёт заказ.
    expect(isIdempotencyDuplicate({ code: "ER_DUP_ENTRY" })).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5, 6, 7. courier.completeDelivery
// ═══════════════════════════════════════════════════════════════════════════
describe("courier.completeDelivery: возврат без позиций, дата долга, сумма оплаты", () => {
  const COURIER = 100;

  beforeEach(() => {
    shopsT.push({ id: 1, tenantId: 1, name: "Лавка", debt: "0.00", status: "active" });
    usersT.push({ id: COURIER, tenantId: 1, name: "Курьер", role: "courier", status: "active" });
    usersT.push({ id: 10, tenantId: 1, name: "Агент", role: "agent", status: "active" });
    usersT.push({ id: 5, tenantId: 1, name: "CEO", role: "ceo", status: "active" });
    warehousesT.push({ id: 1, tenantId: 1, name: "Основной", isDefault: true });
    ordersT.push({
      id: 1, tenantId: 1, orderNumber: "№150", shopId: 1, status: "processing",
      deliveryStatus: "assigned", total: "500000.00", subtotal: "500000.00", discount: "0.00",
      paymentMethod: "debt", agentId: 10, courierId: COURIER, deliveredAt: null,
      deliveryResult: null, deliveryNotes: null, deletedAt: null,
    });
    orderItemsT.push({ id: 1, orderId: 1, productId: 1, quantity: "10.000", unitPrice: "50000.00", deliveredQuantity: null, returnReason: null });
    stockT.push({ id: 1, tenantId: 1, warehouseId: 1, productId: 1, currentStock: "100.00", reserved: "10.00", available: "90.00" });
  });

  function ctx(role = "courier", userId = COURIER): any {
    return {
      req: new Request("http://localhost/"),
      resHeaders: new Headers(),
      user: { id: userId, tenantId: 1, role, status: "active", name: "Курьер", email: "c@t.uz" },
      tenant: { id: 1, slug: "t", name: "Test", plan: "trial", status: "active" },
      db: mockDb,
    };
  }

  async function caller() {
    const { courierRouter } = await import("../courier-router");
    return courierRouter.createCaller(ctx());
  }

  it("частичный возврат без списка позиций отвергается, заказ не закрывается", async () => {
    const c = await caller();
    await expect(c.completeDelivery({ orderId: 1, result: "partial_returned" }))
      .rejects.toThrow();

    // Прежний код проваливался мимо всех трёх веток: склад не трогался, но
    // заказ всё равно становился delivered, а резерв оставался занят навсегда.
    const order = ordersT.find(o => o.id === 1)!;
    expect(order.status).toBe("processing");
    expect(order.deliveryStatus).toBe("assigned");
    const stock = stockT[0];
    expect(stock.reserved).toBe("10.00");
    expect(Number(stock.currentStock)).toBe(Number(stock.available) + Number(stock.reserved));
  });

  it("пустой список позиций — то же самое", async () => {
    const c = await caller();
    await expect(c.completeDelivery({ orderId: 1, result: "partial_returned", returnedItems: [] }))
      .rejects.toThrow();
    expect(ordersT.find(o => o.id === 1)!.status).toBe("processing");
  });

  it("дата долга в свободном формате отвергается, доставка не проводится", async () => {
    const c = await caller();
    for (const bad of ["15.09.2026", "15/09/26", "завтра", "2026-9-5"]) {
      await expect(
        c.completeDelivery({ orderId: 1, result: "partial_paid", paidAmount: "300000", debtDueDate: bad }),
        `дата «${bad}» должна быть отвергнута`,
      ).rejects.toThrow();
    }
    // Раньше такая дата давала Invalid Date, драйвер писал NULL в NOT NULL
    // колонку due_date и откатывал всю транзакцию: курьер не мог закрыть
    // доставку и видел непонятную ошибку драйвера.
    expect(ordersT.find(o => o.id === 1)!.status).toBe("processing");
    expect(paymentsT).toHaveLength(0);
    expect(debtRemindersT).toHaveLength(0);
  });

  it("несуществующий календарный день отвергается отдельно от формата", async () => {
    const c = await caller();
    await expect(c.completeDelivery({ orderId: 1, result: "partial_paid", paidAmount: "300000", debtDueDate: "2026-02-30" }))
      .rejects.toThrow(/Такой даты не существует/);
    expect(ordersT.find(o => o.id === 1)!.status).toBe("processing");
  });

  it("правильная дата проходит и попадает в напоминание о долге", async () => {
    const c = await caller();
    await c.completeDelivery({ orderId: 1, result: "partial_paid", paidAmount: "300000", debtDueDate: "2026-09-15" });
    expect(ordersT.find(o => o.id === 1)!.status).toBe("delivered");
    expect(paymentsT).toHaveLength(1);
    expect(Number(paymentsT[0].paidAmount)).toBe(300000);
    expect(Number(paymentsT[0].debtAmount)).toBe(200000);
    expect(debtRemindersT).toHaveLength(1);
    const due = debtRemindersT[0].dueDate as Date;
    expect(Number.isNaN(due.getTime())).toBe(false);
    expect(due.getFullYear()).toBe(2026);
    expect(due.getMonth()).toBe(8);
    expect(due.getDate()).toBe(15);
  });

  it("сумма оплаты с запятой отвергается, а не проводит доставку без платежа", async () => {
    const c = await caller();
    await expect(c.completeDelivery({ orderId: 1, result: "paid", paidAmount: "50,000" }))
      .rejects.toThrow();

    // Раньше Number("50,000") давал NaN: платёж не записывался (NaN > 0 — ложь),
    // а заказ всё равно закрывался как доставленный, и долг магазина
    // пересчитывался так, будто денег не приносили.
    const order = ordersT.find(o => o.id === 1)!;
    expect(order.status).toBe("processing");
    expect(paymentsT).toHaveLength(0);
  });

  it("оплата, заметно превышающая сумму заказа, отвергается", async () => {
    const c = await caller();
    await expect(c.completeDelivery({ orderId: 1, result: "paid", paidAmount: "5000000" }))
      .rejects.toThrow(/превышает сумму заказа/);
    expect(ordersT.find(o => o.id === 1)!.status).toBe("processing");
    expect(paymentsT).toHaveLength(0);
  });

  it("обычная полная оплата по-прежнему проходит", async () => {
    const c = await caller();
    await c.completeDelivery({ orderId: 1, result: "paid", paidAmount: "500000.00" });
    const order = ordersT.find(o => o.id === 1)!;
    expect(order.status).toBe("delivered");
    expect(paymentsT).toHaveLength(1);
    expect(paymentsT[0].status).toBe("paid");
    expect(Number(paymentsT[0].debtAmount)).toBe(0);
  });

  it("частичный возврат со списком позиций проходит и уменьшает сумму заказа", async () => {
    const c = await caller();
    await c.completeDelivery({
      orderId: 1, result: "partial_returned",
      returnedItems: [{ itemId: 1, returnedQty: 4 }],
      returnReason: "магазин отказался",
    });
    const order = ordersT.find(o => o.id === 1)!;
    expect(order.status).toBe("delivered");
    // 10 заказано, 4 вернулось → 6 × 50 000 = 300 000.
    expect(Number(order.total)).toBe(300000);
    expect(orderItemsT[0].deliveredQuantity).toBe("6");
  });
});
