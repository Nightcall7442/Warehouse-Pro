/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Операторы drizzle — из общего помощника, а не своим списком.
//
// Здесь перечислялись четыре имени: eq, and, desc, sql. Пока роутер обходился
// ими, всё работало; в день, когда он возьмёт пятое, набор упадёт с текстом
// «No "…" export is defined on the drizzle-orm mock» — то есть по виду по вине
// продукта, хотя дыра в стенде. Ровно так однажды и случилось с inArray, разом
// в одиннадцати тестах kpi.
//
// Общий список один на всех, и drizzle-operators.test.ts следит, чтобы он не
// отставал от того, что импортирует продакшн-код.
vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  return drizzleMock();
});

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

vi.mock("../lib/sanitize", () => ({
  sanitizeString: (s: string) => s.replace(/<[^>]*>/g, "").trim(),
  sanitizeSearch: (s: string) => s.replace(/['";\\]/g, "").replace(/--/g, "").trim(),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../services/push-service", () => ({
  sendPushToUser: vi.fn(async () => {}),
}));

import { orders, shops, users, payments, notifications, orderItems, warehouseStock, warehouses } from "@db/schema";
import { makeConditionEvaluator } from "./helpers/fake-conditions";

// ── Fake tables ──────────────────────────────────────────────────────────────
interface FakeOrder { id: number; tenantId: number; orderNumber: string; status: string; deliveryStatus: string; total: string; shopId: number; courierId: number | null; agentId: number; deliveredAt: Date | null; createdAt: Date; }
interface FakeShop { id: number; tenantId: number; name: string; address: string; city: string; debt: string; status: string; agentId: number | null; territoryId: number | null; }
interface FakeUser { id: number; tenantId: number; name: string; email: string; role: string; status: string; }
interface FakePayment { id: number; tenantId: number; shopId: number; orderId: number | null; amount: string; type: string; notes: string; createdBy: number; createdAt: Date; }
interface FakeNotification { id: number; tenantId: number; userId: number; type: string; title: string; message: string; createdAt: Date; }
interface FakeOrderItem { id: number; orderId: number; productId: number; quantity: string; }
interface FakeStock { id: number; productId: number; tenantId: number; warehouseId: number; currentStock: string; reserved: string; available: string; }
interface FakeWarehouse { id: number; tenantId: number; name: string; isDefault: boolean; status: string; }

let ordersTable: FakeOrder[] = [];
let warehousesTable: FakeWarehouse[] = [];
let shopsTable: FakeShop[] = [];
let usersTable: FakeUser[] = [];
let paymentsTable: FakePayment[] = [];
let notificationsTable: FakeNotification[] = [];
let orderItemsTable: FakeOrderItem[] = [];
let stocksTable: FakeStock[] = [];
let nextPaymentId = 10;
let nextNotifId = 10;

function resetTables() {
  ordersTable = [
    { id: 1, tenantId: 1, orderNumber: "ORD-001", status: "processing", deliveryStatus: "assigned", total: "500.00", shopId: 1, courierId: 100, agentId: 10, deliveredAt: null, createdAt: new Date() },
    { id: 2, tenantId: 1, orderNumber: "ORD-002", status: "new", deliveryStatus: "none", total: "300.00", shopId: 2, courierId: null, agentId: 10, deliveredAt: null, createdAt: new Date() },
    { id: 3, tenantId: 1, orderNumber: "ORD-003", status: "processing", deliveryStatus: "out_for_delivery", total: "200.00", shopId: 1, courierId: 100, agentId: 10, deliveredAt: null, createdAt: new Date() },
  ];
  shopsTable = [
    { id: 1, tenantId: 1, name: "Shop A", address: "123 Main St", city: "Tashkent", debt: "0.00", status: "active", agentId: 10, territoryId: null },
    { id: 2, tenantId: 1, name: "Shop B", address: "456 Side St", city: "Samarkand", debt: "100.00", status: "active", agentId: 10, territoryId: null },
  ];
  usersTable = [
    { id: 100, tenantId: 1, name: "Courier One", email: "c@test.com", role: "courier", status: "active" },
    { id: 10, tenantId: 1, name: "Agent One", email: "a@test.com", role: "agent", status: "active" },
    { id: 1, tenantId: 1, name: "CEO", email: "ceo@test.com", role: "ceo", status: "active" },
  ];
  paymentsTable = [];
  notificationsTable = [];
  orderItemsTable = [
    { id: 1, orderId: 1, productId: 1, quantity: "10" },
    { id: 2, orderId: 1, productId: 2, quantity: "5" },
  ];
  stocksTable = [
    { id: 1, productId: 1, tenantId: 1, warehouseId: 1, currentStock: "100.00", reserved: "15.00", available: "85.00" },
    { id: 2, productId: 2, tenantId: 1, warehouseId: 1, currentStock: "50.00", reserved: "5.00", available: "45.00" },
  ];
  // Stock operations resolve the tenant's default warehouse — without this row
  // every delivery path fails with "Склад по умолчанию не найден".
  warehousesTable = [
    { id: 1, tenantId: 1, name: "Main", isDefault: true, status: "active" },
  ];
  nextPaymentId = 10;
  nextNotifId = 10;
}

function tableOf(ref: unknown): string {
  if (ref === orders) return "orders";
  if (ref === shops) return "shops";
  if (ref === users) return "users";
  if (ref === payments) return "payments";
  if (ref === notifications) return "notifications";
  if (ref === orderItems) return "orderItems";
  if (ref === warehouseStock) return "warehouseStock";
  if (ref === warehouses) return "warehouses";
  return "other";
}

function rowsFor(table: string): Record<string, unknown>[] {
  if (table === "orders") return ordersTable as unknown as Record<string, unknown>[];
  if (table === "shops") return shopsTable as unknown as Record<string, unknown>[];
  if (table === "users") return usersTable as unknown as Record<string, unknown>[];
  if (table === "payments") return paymentsTable as unknown as Record<string, unknown>[];
  if (table === "notifications") return notificationsTable as unknown as Record<string, unknown>[];
  if (table === "orderItems") return orderItemsTable as unknown as Record<string, unknown>[];
  if (table === "warehouseStock") return stocksTable as unknown as Record<string, unknown>[];
  if (table === "warehouses") return warehousesTable as unknown as Record<string, unknown>[];
  return [];
}

const columnToFieldName = new Map<unknown, string>();
for (const [field, col] of Object.entries(orders)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(shops)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(users)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(payments)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(notifications)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(orderItems)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(warehouseStock)) columnToFieldName.set(col, field);

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
  // Сырой sql`` этот стенд не воспроизводит; условие считается выполненным.
  // Решение записано здесь, а не спрятано в умолчании разборщика.
  rawSql: () => true,
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
  p.groupBy = () => chainable(rows);
  p.for = () => chainable(rows);
  return p;
}

function makeMockDb() {
  const db: any = {
    select: () => {
      let currentTable = "other";
      const api: Record<string, any> = {
        from(ref: unknown) { currentTable = tableOf(ref); return api; },
        leftJoin() { return api; },
        innerJoin() { return api; },
        where(cond: unknown) {
          const filtered = rowsFor(currentTable).filter((r) => evalCond(r, cond as Record<string, unknown>));
          return chainable(filtered);
        },
        limit(n: number) { return chainable(rowsFor(currentTable).slice(0, n)); },
        offset(n: number) { return chainable(rowsFor(currentTable).slice(n)); },
        orderBy() { return chainable(rowsFor(currentTable)); },
        groupBy() { return chainable(rowsFor(currentTable)); },
      };
      return api;
    },
    insert: (ref: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const table = tableOf(ref);
        if (table === "payments") {
          const id = nextPaymentId++;
          paymentsTable.push({
            id, tenantId: vals.tenantId as number, shopId: vals.shopId as number,
            orderId: (vals.orderId as number | null) ?? null,
            amount: String(vals.amount ?? "0"), type: String(vals.type ?? "payment"),
            notes: String(vals.notes ?? ""), createdBy: (vals.createdBy as number) ?? 0, createdAt: new Date(),
          });
          return Promise.resolve([{ insertId: id }]);
        }
        if (table === "notifications") {
          const id = nextNotifId++;
          notificationsTable.push({
            id, tenantId: vals.tenantId as number, userId: vals.userId as number,
            type: String(vals.type ?? ""), title: String(vals.title ?? ""), message: String(vals.message ?? ""),
            createdAt: new Date(),
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
    delete: () => ({
      where: () => Promise.resolve(),
    }),
    transaction: async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn(db),
    execute: (query: { values?: unknown[]; strings?: string[] }) => {
      const rawSql = (query.strings ?? []).join("?");
      // UPDATE warehouse_stock (for stock deduction)
      if (rawSql.includes("UPDATE") && rawSql.includes("warehouse_stock")) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      // SELECT warehouse_stock for FOR UPDATE
      if (rawSql.includes("SELECT") && rawSql.includes("warehouse_stock")) {
        return Promise.resolve([stocksTable.map(s => ({ id: s.id }))]);
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

describe("courier.assignCourier", () => {
  it("assigns a courier to a new order", async () => {
    const { courierRouter } = await import("../courier-router");
    const caller = courierRouter.createCaller(makeCtx(1, 1));
    const result = await caller.assignCourier({ orderId: 2, courierId: 100 });
    expect(result.success).toBe(true);
    const order = ordersTable.find((o) => o.id === 2)!;
    expect(order.courierId).toBe(100);
    expect(order.deliveryStatus).toBe("assigned");
  });

  it("throws if order not found", async () => {
    const { courierRouter } = await import("../courier-router");
    const caller = courierRouter.createCaller(makeCtx(1, 1));
    await expect(caller.assignCourier({ orderId: 999, courierId: 100 })).rejects.toThrow("Заказ не найден");
  });

  it("throws if order status is not new/processing", async () => {
    ordersTable[0].status = "delivered";
    const { courierRouter } = await import("../courier-router");
    const caller = courierRouter.createCaller(makeCtx(1, 1));
    await expect(caller.assignCourier({ orderId: 1, courierId: 100 })).rejects.toThrow("Можно назначить курьера");
  });

  it("throws if courier user not found", async () => {
    const { courierRouter } = await import("../courier-router");
    const caller = courierRouter.createCaller(makeCtx(1, 1));
    await expect(caller.assignCourier({ orderId: 2, courierId: 999 })).rejects.toThrow("Курьер не найден");
  });
});

describe("courier.markOutForDelivery", () => {
  it("changes deliveryStatus to out_for_delivery", async () => {
    const { courierRouter } = await import("../courier-router");
    const caller = courierRouter.createCaller(makeCtx(1, 100));
    const result = await caller.markOutForDelivery({ orderId: 1 });
    expect(result.success).toBe(true);
    expect(ordersTable.find((o) => o.id === 1)!.deliveryStatus).toBe("out_for_delivery");
  });

  it("throws if order not assigned to this courier", async () => {
    const { courierRouter } = await import("../courier-router");
    const caller = courierRouter.createCaller(makeCtx(1, 100));
    await expect(caller.markOutForDelivery({ orderId: 2 })).rejects.toThrow("Заказ не найден");
  });
});

describe("courier.markDelivered", () => {
  it("marks order as delivered and completed", async () => {
    const { courierRouter } = await import("../courier-router");
    const caller = courierRouter.createCaller(makeCtx(1, 100));
    const result = await caller.markDelivered({ orderId: 1 });
    expect(result.success).toBe(true);
    const order = ordersTable.find((o) => o.id === 1)!;
    expect(order.deliveryStatus).toBe("delivered");
    expect(order.status).toBe("delivered");
    expect(order.deliveredAt).not.toBeNull();
  });

  it("records cash payment when cashAmount provided", async () => {
    const { courierRouter } = await import("../courier-router");
    const caller = courierRouter.createCaller(makeCtx(1, 100));
    await caller.markDelivered({ orderId: 1, cashAmount: "500.00" });
    const payment = paymentsTable.find((p) => p.orderId === 1);
    expect(payment).toBeDefined();
    expect(payment!.amount).toBe("500.00");
    expect(payment!.type).toBe("payment");
  });

  it("throws if cashAmount exceeds order total by >20%", async () => {
    const { courierRouter } = await import("../courier-router");
    const caller = courierRouter.createCaller(makeCtx(1, 100));
    await expect(caller.markDelivered({ orderId: 1, cashAmount: "1000.00" })).rejects.toThrow("Сумма наличных превышает");
  });

  it("throws if order not found or not assigned", async () => {
    const { courierRouter } = await import("../courier-router");
    const caller = courierRouter.createCaller(makeCtx(1, 100));
    await expect(caller.markDelivered({ orderId: 999 })).rejects.toThrow("Заказ не найден");
  });

  it("deducts stock on delivery", async () => {
    const { courierRouter } = await import("../courier-router");
    const caller = courierRouter.createCaller(makeCtx(1, 100));
    await caller.markDelivered({ orderId: 1 });
    // Stock deduction is mocked via execute; verify order status changed
    expect(ordersTable.find((o) => o.id === 1)!.status).toBe("delivered");
  });
});

describe("courier.markFailed", () => {
  it("marks order as failed and resets status to new", async () => {
    const { courierRouter } = await import("../courier-router");
    const caller = courierRouter.createCaller(makeCtx(1, 100));
    const result = await caller.markFailed({ orderId: 1, reason: "Customer not home" });
    expect(result.success).toBe(true);
    const order = ordersTable.find((o) => o.id === 1)!;
    expect(order.deliveryStatus).toBe("failed");
    expect(order.status).toBe("new");
  });

  it("marks out_for_delivery order as failed", async () => {
    const { courierRouter } = await import("../courier-router");
    const caller = courierRouter.createCaller(makeCtx(1, 100));
    const result = await caller.markFailed({ orderId: 3 });
    expect(result.success).toBe(true);
    expect(ordersTable.find((o) => o.id === 3)!.deliveryStatus).toBe("failed");
  });

  it("throws if order not assigned to this courier", async () => {
    const { courierRouter } = await import("../courier-router");
    const caller = courierRouter.createCaller(makeCtx(1, 100));
    await expect(caller.markFailed({ orderId: 2 })).rejects.toThrow("Заказ не найден");
  });

  it("keeps the reservation on failed delivery so the order still owns the goods", async () => {
    const { courierRouter } = await import("../courier-router");
    const caller = courierRouter.createCaller(makeCtx(1, 100));
    const before = stocksTable.map((s) => ({ ...s }));

    await caller.markFailed({ orderId: 1 });

    // Order goes back into the delivery pool...
    expect(ordersTable.find((o) => o.id === 1)!.status).toBe("new");
    // ...but the goods stay committed to it. Releasing them here would let the
    // same units be sold twice and push `reserved` negative on the retry.
    expect(stocksTable).toEqual(before);
  });
});

/**
 * Список доставок.
 *
 * Здесь стояло `expect(Array.isArray(result)).toBe(true)` — и больше ничего.
 * Упасть такая проверка не могла: стенд всегда отдаёт массив. Верни запрос
 * чужие заказы, пустоту или весь список организации целиком — тест остался бы
 * зелёным, и весь смысл этой ручки (курьер видит СВОИ доставки) держался бы
 * ни на чём.
 *
 * Теперь сверяются сами строки.
 *
 * Чего здесь намеренно нет: проверки на deliveryStatus для курьера. В
 * продакшене это сырой `sql`…IN ('assigned','out_for_delivery')``, а стенд
 * такие условия считает выполненными не глядя. Написать про них ожидание
 * значило бы проверить стенд, а не продукт, — то есть завести здесь второй
 * тест, который не может упасть.
 */
function idsOf(rows: unknown): number[] {
  return (rows as Array<{ id: number }>).map(r => r.id).sort((a, b) => a - b);
}

/** Заказ соседней организации: тот же курьер, тот же статус, чужой tenantId. */
function addForeignTenantOrder() {
  ordersTable.push({
    id: 4, tenantId: 2, orderNumber: "ORD-004", status: "processing",
    deliveryStatus: "assigned", total: "700.00", shopId: 1,
    courierId: 100, agentId: 10, deliveredAt: null, createdAt: new Date(),
  });
}

describe("courier.listMyDeliveries", () => {
  it("курьер видит свои доставки и не видит чужие", async () => {
    const { courierRouter } = await import("../courier-router");
    const caller = courierRouter.createCaller(makeCtx(1, 100, "courier"));

    // Заказ 2 назначен никому — курьеру он не принадлежит.
    expect(idsOf(await caller.listMyDeliveries())).toEqual([1, 3]);
  });

  it("оператор видит назначенные доставки организации", async () => {
    const { courierRouter } = await import("../courier-router");
    const caller = courierRouter.createCaller(makeCtx(1, 1, "operator"));

    // Только «назначен»: заказ 3 уже в пути, заказ 2 не назначен вовсе.
    expect(idsOf(await caller.listMyDeliveries())).toEqual([1]);
  });

  it("заказ соседней организации не приходит ни курьеру, ни оператору", async () => {
    addForeignTenantOrder();
    const { courierRouter } = await import("../courier-router");

    const courier  = courierRouter.createCaller(makeCtx(1, 100, "courier"));
    const operator = courierRouter.createCaller(makeCtx(1, 1, "operator"));

    // Строка 4 подобрана так, чтобы пройти ВСЕ остальные условия запроса:
    // тот же курьер, статус «назначен». Отсечь её может только граница
    // организации — если её уберут, упадёт ровно этот тест.
    expect(idsOf(await courier.listMyDeliveries())).not.toContain(4);
    expect(idsOf(await operator.listMyDeliveries())).not.toContain(4);
  });

  it("курьер соседней организации не видит наши доставки", async () => {
    addForeignTenantOrder();
    const { courierRouter } = await import("../courier-router");
    const foreign = courierRouter.createCaller(makeCtx(2, 100, "courier"));

    expect(idsOf(await foreign.listMyDeliveries())).toEqual([4]);
  });
});
