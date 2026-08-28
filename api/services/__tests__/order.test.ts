import { describe, it, expect, beforeEach, vi } from "vitest";

// Операторы drizzle — из общего помощника.
//
// Здесь стоял свой список из пяти имён, и на нём весь путь уведомлений о новом
// заказе не работал: notifyNewOrder подгружает push-service, тот тянет
// db/relations.ts, а `relations` в списке не было. Продукт эту ошибку ловит и
// пишет предупреждение в лог — набор оставался зелёным, а уведомления в нём
// просто не создавались. Тридцать таких строк в выводе полного прогона шли
// отсюда.
//
// Разметка значений у общего помощника та же (__kind), включая sql.raw и
// sql.join, которые читает helpers/mock-execute.ts.
vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("../../__tests__/helpers/drizzle-mock");
  return drizzleMock();
});

import { orders, orderItems, warehouseStock, shops, users, products, warehouses, notifications } from "@db/schema";
import { createExecuteMock } from "../../__tests__/helpers/mock-execute";

type FakeOrder = {
  id: number; tenantId: number; orderNumber: string; shopId: number;
  agentId: number; status: string; subtotal: string; discount: string;
  total: string; notes?: string; idempotencyKey?: string; createdAt: Date;
  deletedAt?: Date | null;
};
type FakeOrderItem = {
  id: number; orderId: number; productId: number; quantity: string;
  unitPrice: string; costPrice: string; subtotal: string; createdAt: Date;
};
type FakeStock = {
  productId: number; tenantId: number; warehouseId: number; currentStock: string;
  reserved: string; available: string;
};
type FakeShop = { id: number; tenantId: number; name: string };
type FakeUser = { id: number; tenantId: number; name: string };
type FakeNotification = { id: number; tenantId: number; userId: number; title: string; message: string };
type FakeProduct = { id: number; tenantId: number; name: string; unitPrice: string; costPrice: string; status: string };

let ordersTable: FakeOrder[] = [];
let orderItemsTable: FakeOrderItem[] = [];
let stockTable: FakeStock[] = [];
let shopsTable: FakeShop[] = [];
let usersTable: FakeUser[] = [];
let productsTable: FakeProduct[] = [];
let notificationsTable: FakeNotification[] = [];
let nextNotificationId = 1;
let warehousesTable: { id: number; tenantId: number; name: string; isDefault: boolean; status: string }[] = [];
let nextOrderId = 1;
let nextItemId = 1;

function resetTables() {
  ordersTable = [];
  orderItemsTable = [];
  stockTable = [
    { productId: 1, tenantId: 1, warehouseId: 1, currentStock: "100.00", reserved: "0.00", available: "100.00" },
    { productId: 2, tenantId: 1, warehouseId: 1, currentStock: "50.00", reserved: "0.00", available: "50.00" },
  ];
  shopsTable = [{ id: 1, tenantId: 1, name: "Shop Alpha" }];
  usersTable = [
    { id: 10, tenantId: 1, name: "Agent One" },
    { id: 11, tenantId: 1, name: "Operator One" },
    // Руководитель соседней организации. Про заказы этой он знать не должен.
    { id: 20, tenantId: 2, name: "Чужой директор" },
  ];
  notificationsTable = [];
  nextNotificationId = 1;
  productsTable = [
    { id: 1, tenantId: 1, name: "Product 1", unitPrice: "100.00", costPrice: "60.00", status: "active" },
    { id: 2, tenantId: 1, name: "Product 2", unitPrice: "200.00", costPrice: "120.00", status: "active" },
  ];
  warehousesTable = [
    { id: 1, tenantId: 1, name: "Main", isDefault: true, status: "active" },
  ];
  nextOrderId = 1;
  nextItemId = 1;
}

function tableOf(ref: unknown): string {
  if (ref === orders) return "orders";
  if (ref === orderItems) return "orderItems";
  if (ref === warehouseStock) return "warehouseStock";
  if (ref === shops) return "shops";
  if (ref === users) return "users";
  if (ref === products) return "products";
  if (ref === notifications) return "notifications";
  if (ref === warehouses) return "warehouses";
  return "other";
}

function rowsFor(table: string): unknown[] {
  const map: Record<string, unknown[]> = {
    orders: ordersTable, orderItems: orderItemsTable,
    warehouseStock: stockTable, shops: shopsTable, users: usersTable,
    products: productsTable, notifications: notificationsTable,
  };
  if (table === "warehouses") return warehousesTable;
  return map[table] ?? [];
}

const colToField = new Map<unknown, string>();
for (const [field, col] of Object.entries(orders)) colToField.set(col, field);
for (const [field, col] of Object.entries(orderItems)) colToField.set(col, field);
for (const [field, col] of Object.entries(warehouseStock)) colToField.set(col, field);
for (const [field, col] of Object.entries(shops)) colToField.set(col, field);
for (const [field, col] of Object.entries(users)) colToField.set(col, field);
for (const [field, col] of Object.entries(products)) colToField.set(col, field);
for (const [field, col] of Object.entries(warehouses)) colToField.set(col, field);

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

  /**
   * Справа от равенства может стоять не значение, а другая колонка — так
   * записывается условие соединения таблиц. Общий разборщик сравнивает
   * значение с литералом, и для него объект колонки — просто объект: без
   * этого правила соединение не находило бы ничего, и связанные поля
   * (название магазина, имя агента) приходили бы пустыми.
   */
  equals: (_field, rowValue, condValue, row) => {
    const other = colToField.get(condValue as object);
    if (other === undefined) return undefined;
    const right = (row as Record<string, unknown>)[other];
    return rowValue === right || String(rowValue) === String(right);
  },
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
  function selectBuilder(proj?: unknown) {
    let tableName = "";
    const allJoins: { table: string; cond: unknown }[] = [];
    const isCountQuery = proj && typeof proj === "object" && !Array.isArray(proj) && (proj as Record<string, unknown>).count && ((proj as Record<string, unknown>).count as Record<string, unknown>).__kind === "sql";
    const api: Record<string, unknown> = {
      from(ref: unknown) { tableName = tableOf(ref); return api; },
      leftJoin(ref: unknown, cond: unknown) { allJoins.push({ table: tableOf(ref), cond }); return api; },
      where(cond: unknown) {
        let filtered = rowsFor(tableName).filter((r) => evalCond(r, cond));
        if (isCountQuery) {
          return Promise.resolve([{ count: filtered.length }]);
        }
        if (allJoins.length) {
          filtered = filtered.map((row) => {
            const patched = { ...(row as Record<string, unknown>) } as Record<string, unknown>;
            for (const j of allJoins) {
              const jRows = rowsFor(j.table);
              const match = jRows.find((jr) => evalCond({ ...(row as Record<string, unknown>), ...(jr as Record<string, unknown>) }, j.cond)) as Record<string, unknown> | undefined;
              if (j.table === "shops") patched.shopName = match?.name ?? null;
              if (j.table === "users") patched.agentName = match?.name ?? null;
            }
            return patched;
          });
        }
        const wrap = (arr: unknown[]): any => Object.assign(Promise.resolve(arr), {
          limit: (n: number) => {
            const sliced = arr.slice(0, n);
            return wrap(sliced);
          },
          offset: (o: number) => wrap(arr.slice(o)),
          orderBy: () => wrap(arr),
          for: () => wrap(arr),
        });
        return wrap(filtered);
      },
      limit(n: number) { return Promise.resolve(rowsFor(tableName).slice(0, n)); },
    };
    return api;
  }

  function updateBuilder(table: ReturnType<typeof tableOf>) {
    return {
      set(patch: Record<string, unknown>) {
        return {
          where(cond: unknown) {
            let matched = 0;
            for (const row of rowsFor(table)) {
              if (!evalCond(row, cond)) continue;
              matched++;
              const r = row as Record<string, unknown>;
              for (const [key, val] of Object.entries(patch)) {
                r[key] = val && typeof val === "object" && (val as Record<string, unknown>).__kind === "sql"
                  ? evalSqlDelta(row, key, val)
                  : val;
              }
            }
            return Promise.resolve([{ affectedRows: matched }]);
          },
        };
      },
    };
  }

  const db = {
    select: (proj?: unknown) => selectBuilder(proj),
    execute: createExecuteMock(stockTable),
    insert: (ref: unknown) => ({
      values: (vals: unknown) => {
        const table = tableOf(ref);
        if (table === "orders") {
          const id = nextOrderId++;
          const v = vals as Record<string, unknown>;
          ordersTable.push({
            id, tenantId: v.tenantId as number, orderNumber: v.orderNumber as string,
            shopId: v.shopId as number, agentId: v.agentId as number, status: v.status as string,
            subtotal: v.subtotal as string, discount: v.discount as string, total: v.total as string,
            notes: v.notes as string | undefined, idempotencyKey: v.idempotencyKey as string | undefined,
            createdAt: new Date(),
          });
          return Promise.resolve([{ insertId: id }]);
        }
        if (table === "notifications") {
          // Уведомления кладутся пачкой — по одному на получателя.
          const list = Array.isArray(vals) ? (vals as Record<string, unknown>[]) : [vals as Record<string, unknown>];
          for (const v of list) {
            notificationsTable.push({
              id: nextNotificationId++, tenantId: v.tenantId as number, userId: v.userId as number,
              title: String(v.title ?? ""), message: String(v.message ?? ""),
            });
          }
          return Promise.resolve([{ insertId: nextNotificationId }]);
        }
        if (table === "orderItems") {
          const list = Array.isArray(vals) ? (vals as Record<string, unknown>[]) : [vals as Record<string, unknown>];
          for (const v of list) {
            orderItemsTable.push({
              id: nextItemId++, orderId: v.orderId as number, productId: v.productId as number,
              quantity: String(v.quantity), unitPrice: String(v.unitPrice),
              costPrice: String(v.costPrice ?? "0.00"),
              subtotal: String(Number(v.unitPrice) * Number(v.quantity)),
              createdAt: new Date(),
            });
          }
          return Promise.resolve([{ insertId: nextItemId }]);
        }
        return Promise.resolve([{ insertId: 1 }]);
      },
    }),
    update: (ref: unknown) => updateBuilder(tableOf(ref)),
    delete: (ref: unknown) => ({
      where: (cond: unknown) => {
        const table = tableOf(ref);
        const rows = rowsFor(table);
        const keep = rows.filter((r) => !evalCond(r, cond));
        if (table === "orders") ordersTable = keep as FakeOrder[];
        if (table === "orderItems") orderItemsTable = keep as FakeOrderItem[];
        return Promise.resolve();
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return db;
}

let mockDb: ReturnType<typeof makeMockDb>;

/**
 * Подмена соединения с базой.
 *
 * Путь был "../queries/connection" — и это ничего не подменяло: vi.mock
 * считает путь от файла теста, то есть от api/services/__tests__, и указывал
 * он на api/services/queries/connection, которого нет. Мок выглядел защитой
 * от настоящей базы, но был пустой строкой.
 *
 * Набор при этом проходил: сам OrderService соединение не запрашивает, ему
 * передают db аргументом. А вот push-service запрашивает — и получал
 * настоящий getDb() с адресом-заглушкой из окружения, отчего путь уведомлений
 * падал с «TypeError: Invalid URL». Продукт эту ошибку ловит и пишет в лог,
 * поэтому набор оставался зелёным.
 *
 * Ловушка на будущее: появись в OrderService первый вызов getDb(), тест
 * молча пошёл бы в настоящий слой соединения.
 */
vi.mock("../../queries/connection", () => ({ getDb: () => mockDb }));

// Отправка пуш-уведомлений ходит в сеть, к Expo. Модульному тесту заказа там
// делать нечего — важно, что путь уведомлений отрабатывает целиком, а не что
// Expo ответил.
vi.mock("../push-service", () => ({
  sendPushToUser: vi.fn(async () => {}),
  sendPushToRole: vi.fn(async () => {}),
}));

beforeEach(() => {
  resetTables();
  mockDb = makeMockDb();
});

import { OrderService } from "../order";
import { makeConditionEvaluator } from "../../../api/__tests__/helpers/fake-conditions";

describe("OrderService.create", () => {
  it("reserves stock and creates order atomically", async () => {
    const result = await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "20"}],
    });

    expect(result.id).toBe(1);
    // Номер стал порядковым: №1 в пустом стенде, №149 и далее на живой базе.
    // Прежний ORD- + кусок UUID не читался и ничего не говорил о порядке;
    // старые заказы свои номера сохранили, менялась только выдача новых.
    expect(result.orderNumber).toMatch(/^№\d+$/);
    expect(ordersTable).toHaveLength(1);
    expect(orderItemsTable).toHaveLength(1);

    const stock = stockTable.find((s) => s.productId === 1)!;
    expect(stock.reserved).toBe("20.00");
    expect(stock.available).toBe("80.00");
  });

  /**
   * Уведомление о новом заказе.
   *
   * Раньше этот путь в тестах не выполнялся вовсе: он подгружает push-service,
   * тот запрашивал соединение с базой, соединение в стенде подменено не было —
   * и всё падало на «Invalid URL». Продукт эту ошибку ловит и пишет в лог,
   * поэтому набор оставался зелёным, а уведомления в нём не создавались ни
   * разу. Тридцать строк «Order notification failed» в полном прогоне шли
   * отсюда.
   *
   * Чего здесь намеренно НЕ проверяется: отбор получателей по роли. В
   * продакшене это сырой `sql`role IN (…)``, а разборщик стенда такие условия
   * считает выполненными не глядя. Ожидание про роли прошло бы при любом коде
   * — то есть было бы ещё одним тестом, который не может упасть.
   *
   * Граница организации проверяется по-настоящему: это обычный eq по колонке,
   * которая в строках стенда есть.
   */
  it("уведомляет своих и не трогает соседнюю организацию", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "20" }],
    });

    expect(notificationsTable.length).toBeGreaterThan(0);
    expect(notificationsTable.every(n => n.tenantId === 1)).toBe(true);
    expect(notificationsTable.map(n => n.userId)).not.toContain(20);

    // В тексте — номер заказа и магазин: по уведомлению должно быть понятно,
    // о чём оно, без перехода в карточку.
    const [first] = notificationsTable;
    expect(first.title).toMatch(/№\d+/);
    expect(first.message).toContain("Shop Alpha");
  });

  it("rejects when stock is insufficient", async () => {
    await expect(
      OrderService.create(mockDb as any, 1, 10, {
        shopId: 1, items: [{ productId: 1, quantity: "200"}],
      }),
    ).rejects.toThrow(/Недостаточно товара/);

    expect(ordersTable).toHaveLength(0);
    expect(stockTable.find((s) => s.productId === 1)!.reserved).toBe("0.00");
  });

  it("creates order with multiple items", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1,
      items: [
        { productId: 1, quantity: "5"},
        { productId: 2, quantity: "3"},
      ],
    });

    expect(ordersTable).toHaveLength(1);
    expect(orderItemsTable).toHaveLength(2);
    expect(stockTable.find((s) => s.productId === 1)!.reserved).toBe("5.00");
    expect(stockTable.find((s) => s.productId === 2)!.reserved).toBe("3.00");
  });

  it("calculates total with a percentage discount", async () => {
    // discount is a percentage (0-100); 50% of a 1000 subtotal is 500 off.
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1,
      items: [{ productId: 1, quantity: "10"}],
      discount: "50",
    });

    const order = ordersTable[0];
    expect(order.subtotal).toBe("1000.00");
    expect(order.discount).toBe("500.00");
    expect(order.total).toBe("500.00");
  });
});

describe("OrderService.cancel", () => {
  it("restores stock and marks order cancelled", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "15"}],
    });

    const result = await OrderService.cancel(mockDb as any, 1, 1, { userId: 10, userRole: "agent" });
    expect(result.success).toBe(true);

    const stock = stockTable.find((s) => s.productId === 1)!;
    expect(stock.reserved).toBe("0.00");
    expect(stock.available).toBe("100.00");
    expect(ordersTable[0].status).toBe("cancelled");
  });

  it("throws when order not found", async () => {
    await expect(
      OrderService.cancel(mockDb as any, 1, 999, { userId: 10, userRole: "agent" }),
    ).rejects.toThrow(/Заказ не найден/);
  });

  it("throws when order is not in 'new' status", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "5"}],
    });
    await OrderService.cancel(mockDb as any, 1, 1, { userId: 10, userRole: "agent" });

    await expect(
      OrderService.cancel(mockDb as any, 1, 1, { userId: 10, userRole: "agent" }),
    ).rejects.toThrow(/Можно отменить только новые заказы/);
  });

  it("agent cannot cancel another agent's order", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "5"}],
    });

    await expect(
      OrderService.cancel(mockDb as any, 1, 1, { userId: 99, userRole: "agent" }),
    ).rejects.toThrow(/Заказ не найден/);
  });
});

describe("OrderService.updateStatus", () => {
  it("transitions new -> processing", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "10"}],
    });

    await OrderService.updateStatus(mockDb as any, 1, 1, "processing");
    expect(ordersTable[0].status).toBe("processing");
  });

  it("transitions new -> delivered and deducts stock", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "10"}],
    });

    await OrderService.updateStatus(mockDb as any, 1, 1, "delivered");

    const stock = stockTable.find((s) => s.productId === 1)!;
    expect(stock.currentStock).toBe("90.00");
    expect(stock.reserved).toBe("0.00");
    expect(ordersTable[0].status).toBe("delivered");
  });

  it("transitions new -> cancelled and restores available stock", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "10"}],
    });

    await OrderService.updateStatus(mockDb as any, 1, 1, "cancelled");

    const stock = stockTable.find((s) => s.productId === 1)!;
    expect(stock.available).toBe("100.00");
    expect(stock.reserved).toBe("0.00");
  });

  it("re-setting the same status is a no-op", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "10"}],
    });
    const before = { ...stockTable[0] };

    await OrderService.updateStatus(mockDb as any, 1, 1, "new");

    expect(ordersTable[0].status).toBe("new");
    expect(stockTable[0]).toEqual(before);
  });

  it("throws when order not found", async () => {
    await expect(OrderService.updateStatus(mockDb as any, 1, 999, "delivered")).rejects.toThrow(/Заказ не найден/);
  });

  it("allows correcting a delivered order back to cancelled, returning the goods", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "10"}],
    });
    const beforeCreate = Number(stockTable[0].currentStock);
    await OrderService.updateStatus(mockDb as any, 1, 1, "delivered");

    await OrderService.updateStatus(mockDb as any, 1, 1, "cancelled");

    expect(ordersTable[0].status).toBe("cancelled");
    expect(Number(stockTable[0].currentStock)).toBe(beforeCreate);
    expect(Number(stockTable[0].reserved)).toBe(0);
  });
});

describe("OrderService.delete", () => {
  it("restores stock for new orders and soft deletes order", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "25"}],
    });

    await OrderService.delete(mockDb as any, 1, 1);

    const stock = stockTable.find((s) => s.productId === 1)!;
    expect(stock.reserved).toBe("0.00");
    expect(stock.available).toBe("100.00");
    // Soft delete: order still exists but deletedAt is set
    expect(ordersTable).toHaveLength(1);
    expect(ordersTable[0].deletedAt).toBeDefined();
  });

  it("restores stock for processing orders", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "10"}],
    });
    await OrderService.updateStatus(mockDb as any, 1, 1, "processing");

    await OrderService.delete(mockDb as any, 1, 1);

    const stock = stockTable.find((s) => s.productId === 1)!;
    expect(stock.reserved).toBe("0.00");
    expect(stock.available).toBe("100.00");
  });

  it("does not restore stock for delivered orders", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "10"}],
    });
    await OrderService.updateStatus(mockDb as any, 1, 1, "delivered");

    const before = { ...stockTable.find((s) => s.productId === 1)! };
    await OrderService.delete(mockDb as any, 1, 1);
    const after = stockTable.find((s) => s.productId === 1)!;

    expect(after.currentStock).toBe(before.currentStock);
    expect(after.available).toBe(before.available);
  });

  it("throws when order not found", async () => {
    await expect(OrderService.delete(mockDb as any, 1, 999)).rejects.toThrow(/Заказ не найден/);
  });
});

describe("OrderService.list", () => {
  it("returns paginated results with shopName and agentName", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "5"}],
    });

    const result = await OrderService.list(mockDb as any, 1, {}, { userId: 10, userRole: "agent" });

    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.data[0].shopName).toBe("Shop Alpha");
    expect(result.data[0].agentName).toBe("Agent One");
    expect(result.data[0].status).toBe("new");
  });

  it("filters by status", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "5"}],
    });
    await OrderService.updateStatus(mockDb as any, 1, 1, "processing");

    const result = await OrderService.list(mockDb as any, 1, { status: "processing" }, { userId: 10, userRole: "agent" });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].status).toBe("processing");

    const empty = await OrderService.list(mockDb as any, 1, { status: "delivered" }, { userId: 10, userRole: "agent" });
    expect(empty.data).toHaveLength(0);
  });

  it("returns empty for tenant with no orders", async () => {
    const result = await OrderService.list(mockDb as any, 999, {}, { userId: 10, userRole: "agent" });
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

describe("OrderService.create — costPrice snapshot", () => {
  it("snapshots costPrice from product into order items", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "5"}],
    });

    expect(orderItemsTable).toHaveLength(1);
    expect(orderItemsTable[0].costPrice).toBe("60.00");
  });

  it("uses server-side unitPrice, not client-provided", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "5"}],
    });

    // Server should use DB price (100.00), not client price (999)
    expect(ordersTable[0].subtotal).toBe("500.00");
    expect(orderItemsTable[0].unitPrice).toBe("100.00");
  });
});

describe("OrderService.create — idempotency", () => {
  it("returns existing order when idempotencyKey matches", async () => {
    const first = await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "5"}],
      idempotencyKey: "test-key-123",
    });

    const second = await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "5"}],
      idempotencyKey: "test-key-123",
    });

    expect(second.id).toBe(first.id);
    expect(second.orderNumber).toBe(first.orderNumber);
    expect(second.idempotent).toBe(true);
    expect(ordersTable).toHaveLength(1); // Only one order created
  });

  it("creates different orders for different idempotencyKeys", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "5"}],
      idempotencyKey: "key-1",
    });

    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "3"}],
      idempotencyKey: "key-2",
    });

    expect(ordersTable).toHaveLength(2);
  });
});
