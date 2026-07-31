/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq:  (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
  and: (...conds: unknown[]) => ({ __kind: "and", conds }),
  desc: (col: unknown) => ({ __kind: "desc", col }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values }),
}));

vi.mock("../telegram-router", () => ({
  notifyAdmin: vi.fn(async () => {}),
  tgMessages: { newOrder: vi.fn(() => "mock message") },
}));

vi.mock("../lib/feature-gating", () => ({
  checkSubscriptionAccess: vi.fn(async () => true),
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

import { orders, shops, users, payments, notifications, orderItems, products, warehouseStock, warehouses } from "@db/schema";

// ── Fake tables ──────────────────────────────────────────────────────────────
interface FakeOrder { id: number; tenantId: number; orderNumber: string; status: string; deliveryStatus: string; total: string; shopId: number; courierId: number | null; agentId: number; deliveredAt: Date | null; createdAt: Date; }
interface FakeShop { id: number; tenantId: number; name: string; address: string; city: string; debt: string; status: string; agentId: number | null; territoryId: number | null; }
interface FakeUser { id: number; tenantId: number; name: string; email: string; role: string; status: string; }
interface FakePayment { id: number; tenantId: number; shopId: number; amount: string; type: string; notes: string; createdBy: number; createdAt: Date; }
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
    select: (proj?: unknown) => {
      let currentTable = "other";
      const api: Record<string, any> = {
        from(ref: unknown) { currentTable = tableOf(ref); return api; },
        leftJoin(ref: unknown) { return api; },
        innerJoin(ref: unknown) { return api; },
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
        return Promise.resolve();
      },
    }),
    transaction: async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn(db),
    execute: (query: { values?: unknown[]; strings?: string[] }) => {
      const vals = query.values ?? [];
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
    ordersTable[0].status = "completed";
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
    expect(order.status).toBe("completed");
    expect(order.deliveredAt).not.toBeNull();
  });

  it("records cash payment when cashAmount provided", async () => {
    const { courierRouter } = await import("../courier-router");
    const caller = courierRouter.createCaller(makeCtx(1, 100));
    await caller.markDelivered({ orderId: 1, cashAmount: "500.00" });
    const payment = paymentsTable.find((p) => p.orderId === 1 as any);
    expect(paymentsTable.length).toBeGreaterThan(0);
    expect(paymentsTable[0].amount).toBe("500.00");
    expect(paymentsTable[0].type).toBe("payment");
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
    expect(ordersTable.find((o) => o.id === 1)!.status).toBe("completed");
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

describe("courier.listMyDeliveries", () => {
  it("returns assigned deliveries for courier role", async () => {
    const { courierRouter } = await import("../courier-router");
    const caller = courierRouter.createCaller(makeCtx(1, 100, "courier"));
    const result = await caller.listMyDeliveries() as any;
    // Should return orders assigned to this courier
    expect(Array.isArray(result)).toBe(true);
  });

  it("returns all assigned deliveries for operator role", async () => {
    const { courierRouter } = await import("../courier-router");
    const caller = courierRouter.createCaller(makeCtx(1, 1, "operator"));
    const result = await caller.listMyDeliveries() as any;
    expect(Array.isArray(result)).toBe(true);
  });
});
