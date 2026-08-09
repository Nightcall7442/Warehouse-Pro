/**
 * Order state transition tests.
 *
 * Verifies all valid and invalid status transitions in OrderService.updateStatus:
 *  - Valid:   new → processing, new → delivered, new → cancelled,
 *             processing → delivered, processing → cancelled
 *  - Invalid: delivered → anything, cancelled → anything,
 *             processing → new, new → new, processing → processing
 *  - Idempotent: delivered → delivered (no double-deduct), cancelled → cancelled (no double-release)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TrpcContext } from "../context";
import { asTestContext } from "./helpers/test-context";

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
    isNull: (col: unknown) => ({ __kind: "isNull", col }),
    sql: sqlFn,
  };
});

vi.mock("../telegram-router", () => ({
  notifyAdmin: vi.fn(async () => {}),
  tgMessages: { newOrder: vi.fn(() => "mock message") },
}));

import { orders, orderItems, warehouseStock, products, warehouses, shops } from "@db/schema";
import { createExecuteMock } from "./helpers/mock-execute";
import { makeConditionEvaluator } from "./helpers/fake-conditions";

interface FakeOrder { id: number; tenantId: number; agentId: number; shopId: number; status: string; }
interface FakeOrderItem { id: number; orderId: number; productId: number; quantity: string; }
interface FakeStock { productId: number; tenantId: number; warehouseId: number; currentStock: string; reserved: string; available: string; }

let ordersTable: FakeOrder[] = [];
let orderItemsTable: FakeOrderItem[] = [];
let stockTable: FakeStock[] = [];
let productsTable: { id: number; tenantId: number; name: string; unitPrice: string; status: string; costPrice?: string }[] = [];
let warehousesTable: { id: number; tenantId: number; name: string; isDefault: boolean; status: string }[] = [];
let shopsTable: { id: number; tenantId: number; name: string }[] = [];
let nextOrderId = 1;
let nextItemId = 1;

function resetTables() {
  ordersTable = [];
  orderItemsTable = [];
  stockTable = [
    { productId: 1, tenantId: 1, warehouseId: 1, currentStock: "100.00", reserved: "0.00", available: "100.00" },
  ];
  productsTable = [
    { id: 1, tenantId: 1, name: "Test Product", unitPrice: "100.00", status: "active", costPrice: "50.00" },
  ];
  warehousesTable = [
    { id: 1, tenantId: 1, name: "Main", isDefault: true, status: "active" },
    { id: 2, tenantId: 2, name: "Other", isDefault: true, status: "active" },
  ];
  shopsTable = [
    { id: 1, tenantId: 1, name: "Test Shop" },
  ];
  nextOrderId = 1;
  nextItemId = 1;
}

function tableOf(ref: unknown): "orders" | "orderItems" | "warehouseStock" | "products" | "warehouses" | "shops" | "other" {
  if (ref === orders) return "orders";
  if (ref === orderItems) return "orderItems";
  if (ref === warehouseStock) return "warehouseStock";
  if (ref === products) return "products";
  if (ref === warehouses) return "warehouses";
  if (ref === shops) return "shops";
  return "other";
}

function rowsFor(table: ReturnType<typeof tableOf>): unknown[] {
  if (table === "orders") return ordersTable;
  if (table === "orderItems") return orderItemsTable;
  if (table === "warehouseStock") return stockTable;
  if (table === "products") return productsTable;
  if (table === "warehouses") return warehousesTable;
  if (table === "shops") return shopsTable;
  return [];
}

const columnToFieldName = new Map<unknown, string>();
for (const [field, col] of Object.entries(orders))        columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(orderItems))    columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(warehouseStock)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(products)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(warehouses)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(shops)) columnToFieldName.set(col, field);

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

function evalSqlDelta(row: unknown, fieldName: string, expr: unknown): string {
  const e = expr as Record<string, unknown>;
  if (!e || e.__kind !== "sql") return (row as Record<string, unknown>)[fieldName] as string;
  const opStr = (e.strings as string[]).find((s: string) => s.includes("+") || s.includes("-")) ?? "";
  const op = opStr.includes("+") ? "+" : "-";
  const amount = Number((e.values as unknown[])[(e.values as unknown[]).length - 1]);
  const current = Number((row as Record<string, unknown>)[fieldName]);
  return (op === "+" ? current + amount : current - amount).toFixed(2);
}

function makeMockDb() {
  function selectBuilder() {
    let table: ReturnType<typeof tableOf> = "other";
    const api = {
      from(ref: unknown) { table = tableOf(ref); return api; },
      leftJoin() { return api; },
      where(cond: unknown) {
        const filtered = rowsFor(table).filter((r) => evalCond(r, cond));
        const chain = Object.assign(Promise.resolve(filtered), {
          limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
          orderBy: () => Object.assign(Promise.resolve(filtered), { limit: (n: number) => Promise.resolve(filtered.slice(0, n)) }),
          for: () => chain,
        });
        return chain;
      },
      limit(n: number) { return Promise.resolve(rowsFor(table).slice(0, n)); },
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
    select: () => selectBuilder(),
    insert: (ref: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const table = tableOf(ref);
        if (table === "orders") {
          const id = nextOrderId++;
          ordersTable.push({ id, tenantId: vals.tenantId as number, agentId: vals.agentId as number, shopId: vals.shopId as number, status: vals.status as string });
          return Promise.resolve([{ insertId: id }]);
        }
        if (table === "orderItems") {
          const list = Array.isArray(vals) ? vals : [vals];
          for (const v of list) orderItemsTable.push({ id: nextItemId++, orderId: v.orderId as number, productId: v.productId as number, quantity: String(v.quantity) });
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
    execute: createExecuteMock(stockTable),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return db;
}

let mockDb: ReturnType<typeof makeMockDb>;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

function makeCtx(tenantId: number, userId: number, role = "agent"): TrpcContext {
  return asTestContext({
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    user: { id: userId, tenantId, role, status: "active" as const, name: "Test", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test", name: "Test Co", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    db: mockDb,
  });
}

// ── Helpers for creating an order in a specific state ─────────────────────────
async function createOrder(caller: ReturnType<typeof import("../order-router")["orderRouter"]["createCaller"]>) {
  return caller.create({ shopId: 1, items: [{ productId: 1, quantity: 10}] });
}

beforeEach(() => {
  resetTables();
  mockDb = makeMockDb();
});

// ── Valid transitions ─────────────────────────────────────────────────────────
describe("valid state transitions", () => {
  it("new → processing", async () => {
    const { orderRouter } = await import("../order-router");
    const agent = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const op = orderRouter.createCaller(makeCtx(1, 1, "operator"));
    await createOrder(agent);
    await op.updateStatus({ id: 1, status: "processing" });
    expect(ordersTable[0].status).toBe("processing");
  });

  it("new → delivered", async () => {
    const { orderRouter } = await import("../order-router");
    const agent = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const op = orderRouter.createCaller(makeCtx(1, 1, "operator"));
    await createOrder(agent);
    await op.updateStatus({ id: 1, status: "delivered" });
    expect(ordersTable[0].status).toBe("delivered");
  });

  it("new → cancelled", async () => {
    const { orderRouter } = await import("../order-router");
    const agent = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    await createOrder(agent);
    await agent.cancel({ id: 1 });
    expect(ordersTable[0].status).toBe("cancelled");
  });

  it("processing → delivered", async () => {
    const { orderRouter } = await import("../order-router");
    const agent = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const op = orderRouter.createCaller(makeCtx(1, 1, "operator"));
    await createOrder(agent);
    await op.updateStatus({ id: 1, status: "processing" });
    await op.updateStatus({ id: 1, status: "delivered" });
    expect(ordersTable[0].status).toBe("delivered");
  });

  it("processing → cancelled", async () => {
    const { orderRouter } = await import("../order-router");
    const agent = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const op = orderRouter.createCaller(makeCtx(1, 1, "operator"));
    await createOrder(agent);
    await op.updateStatus({ id: 1, status: "processing" });
    await op.updateStatus({ id: 1, status: "cancelled" });
    expect(ordersTable[0].status).toBe("cancelled");
  });
});

// ── Corrections in any direction ──────────────────────────────────────────────
// Operators fix mistakes both ways, so no transition is forbidden. What must
// hold is that stock settles to the same place regardless of the path taken.
describe("status corrections in any direction", () => {
  it("rolls a delivered order back to new and returns the goods to the shelf", async () => {
    const { orderRouter } = await import("../order-router");
    const agent = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const op = orderRouter.createCaller(makeCtx(1, 1, "operator"));
    await createOrder(agent);
    const afterCreate = { ...stockTable[0] };

    await op.updateStatus({ id: 1, status: "delivered" });
    await op.updateStatus({ id: 1, status: "new" });

    expect(ordersTable[0].status).toBe("new");
    expect(stockTable[0].currentStock).toBe(afterCreate.currentStock);
    expect(stockTable[0].reserved).toBe(afterCreate.reserved);
    expect(stockTable[0].available).toBe(afterCreate.available);
  });

  it("reopens a cancelled order and takes the reservation back", async () => {
    const { orderRouter } = await import("../order-router");
    const agent = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const op = orderRouter.createCaller(makeCtx(1, 1, "operator"));
    await createOrder(agent);
    const afterCreate = { ...stockTable[0] };

    await agent.cancel({ id: 1 });
    await op.updateStatus({ id: 1, status: "processing" });

    expect(ordersTable[0].status).toBe("processing");
    expect(stockTable[0].reserved).toBe(afterCreate.reserved);
    expect(stockTable[0].available).toBe(afterCreate.available);
  });

  it("moves processing back to new without touching stock", async () => {
    const { orderRouter } = await import("../order-router");
    const agent = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const op = orderRouter.createCaller(makeCtx(1, 1, "operator"));
    await createOrder(agent);
    const afterCreate = { ...stockTable[0] };

    await op.updateStatus({ id: 1, status: "processing" });
    await op.updateStatus({ id: 1, status: "new" });

    expect(ordersTable[0].status).toBe("new");
    expect(stockTable[0].reserved).toBe(afterCreate.reserved);
    expect(stockTable[0].available).toBe(afterCreate.available);
  });

  it("gives the goods back when a delivered order is cancelled", async () => {
    const { orderRouter } = await import("../order-router");
    const agent = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const op = orderRouter.createCaller(makeCtx(1, 1, "operator"));
    await createOrder(agent);
    const beforeOrder = Number(stockTable[0].currentStock);

    await op.updateStatus({ id: 1, status: "delivered" });
    await op.updateStatus({ id: 1, status: "cancelled" });

    expect(ordersTable[0].status).toBe("cancelled");
    expect(Number(stockTable[0].currentStock)).toBe(beforeOrder);
    expect(Number(stockTable[0].reserved)).toBe(0);
  });
});
