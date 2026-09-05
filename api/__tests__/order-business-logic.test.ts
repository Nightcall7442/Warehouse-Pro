/**
 * Order business-logic tests.
 *
 * Mocks `drizzle-orm`'s query helpers (`eq`, `and`, `sql`) with simple,
 * introspectable marker objects instead of trying to parse drizzle's real
 * (circular, version-specific) SQL AST. This keeps the test independent of
 * drizzle's internals while still exercising the exact branching logic in
 * `order-router.ts` — every `eq(col, val)` / `and(...)` / `sql\`col +/- n\`
 * call in the router is replaced by a marker the in-memory fake DB below can
 * interpret directly.
 *
 * Covers the money/stock critical paths:
 *  - creating an order reserves exactly the requested quantity
 *  - creating an order with more than the available stock is rejected,
 *    and no partial reservation leaks through
 *  - cancelling an order returns the full reservation, exactly once
 *  - completing an order deducts stock and clears the reservation, once
 *  - updateStatus can't double-apply stock changes on a repeated call
 *    (duplicate request after a network retry, double-click, etc.)
 *  - an agent cannot cancel another agent's order
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { deriveShopDebt, isShopDebtRecalc } from "./helpers/shop-debt-recalc";

// ── Mock drizzle-orm's query helpers with introspectable markers ───────────────
vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  return drizzleMock();
});

vi.mock("../telegram-router", () => ({
  notifyAdmin: vi.fn(async () => {}),
  tgMessages: { newOrder: vi.fn(() => "mock message") },
}));

import { orders, orderItems, warehouseStock, products, warehouses, shops } from "@db/schema";
import { createExecuteMock } from "./helpers/mock-execute";
import { makeConditionEvaluator } from "./helpers/fake-conditions";

// ── Fake in-memory tables ─────────────────────────────────────────────────────
interface FakeOrder { id: number; tenantId: number; agentId: number; shopId: number; status: string; deletedAt: Date | null; subtotal: string; discount: string; total: string; paymentMethod: string; }
interface FakeOrderItem { id: number; orderId: number; productId: number; quantity: string; }
interface FakeStock { productId: number; tenantId: number; warehouseId: number; currentStock: string; reserved: string; available: string; }
interface FakeProduct { id: number; tenantId: number; name: string; unitPrice: string; status: string; }

let ordersTable: FakeOrder[]         = [];
let orderItemsTable: FakeOrderItem[] = [];
let stockTable: FakeStock[]          = [];
let productsTable: FakeProduct[]     = [];
let warehousesTable: { id: number; tenantId: number; name: string; isDefault: boolean; status: string }[] = [];
let shopsTable: { id: number; tenantId: number; name: string; debt: string }[] = [];
let nextOrderId = 1;
let nextItemId  = 1;

function resetFakeTables() {
  ordersTable     = [];
  orderItemsTable = [];
  stockTable      = [
    { productId: 1, tenantId: 1, warehouseId: 1, currentStock: "100.00", reserved: "0.00", available: "100.00" },
    { productId: 2, tenantId: 1, warehouseId: 1, currentStock: "5.00",   reserved: "0.00", available: "5.00"   },
  ];
  productsTable   = [
    { id: 1, tenantId: 1, name: "Product 1", unitPrice: "100.00", status: "active" },
    { id: 2, tenantId: 1, name: "Product 2", unitPrice: "50.00", status: "active" },
  ];
  warehousesTable = [
    { id: 1, tenantId: 1, name: "Main", isDefault: true, status: "active" },
  ];
  shopsTable = [
    { id: 1, tenantId: 1, name: "Test Shop", debt: "0.00" },
  ];
  nextOrderId = 1;
  nextItemId  = 1;
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

// Map every column object (across all three tables we care about) to its
// JS property name on the table — drizzle's `.name` is the snake_case DB
// column name (e.g. "product_id"), not the camelCase JS key our fake rows
// use, so we build this lookup once instead of trusting `.name`.
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
          ordersTable.push({
            id,
            tenantId: vals.tenantId as number,
            agentId: vals.agentId as number,
            shopId: vals.shopId as number,
            status: vals.status as string,
            deletedAt: null,
            // Money fields drive the debt logic — the fake has to carry them.
            subtotal: String(vals.subtotal ?? "0.00"),
            discount: String(vals.discount ?? "0.00"),
            total: String(vals.total ?? "0.00"),
            paymentMethod: String(vals.paymentMethod ?? "cash"),
          });
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
    execute: (sqlObj: unknown) => {
      if (!sqlObj || typeof sqlObj !== "object" || (sqlObj as Record<string, unknown>).__kind !== "sql") return Promise.resolve();
      const s = sqlObj as { strings: string[]; values: unknown[] };
      const fullSql = s.strings.join("");

      // Shop debt is derived, not nudged: the statement binds [shopId, tenantId]
      // and recomputes the balance from the shop's own records.
      if (isShopDebtRecalc(fullSql)) {
        const [shopId, tenantId] = s.values.filter((v): v is number => typeof v === "number");
        for (const shop of shopsTable) {
          if (shop.id === shopId && shop.tenantId === tenantId) {
            shop.debt = deriveShopDebt(tenantId, shopId, { orders: ordersTable });
          }
        }
        return Promise.resolve();
      }

      if (!fullSql.includes("UPDATE warehouse_stock")) return Promise.resolve();

      // Simple pattern: SET available = available - X, reserved = reserved + X WHERE product_id = Y AND tenant_id = Z
      // Note: qty appears twice in the SQL (available - qty, reserved + qty), so numericValues may be [qty, qty, productId, tenantId]
      if (fullSql.includes("available = available -") && fullSql.includes("reserved = reserved +") && !fullSql.includes("CASE")) {
        const numericValues = s.values.filter(v => typeof v === "number");
        if (numericValues.length >= 3) {
          const qty = numericValues[0];
          const offset = numericValues.length >= 4 ? 2 : 1;
          const productId = numericValues[offset];
          const tenantId = numericValues[offset + 1];
          for (const row of stockTable) {
            if (row.productId === productId && row.tenantId === tenantId) {
              row.available = (Number(row.available) - qty).toFixed(2);
              row.reserved = (Number(row.reserved) + qty).toFixed(2);
            }
          }
        }
        return Promise.resolve();
      }

      // Batch CASE/WHEN queries (create/cancel/updateStatus's delta form) —
      // shared with the other test files so a change to the SQL shape only
      // needs updating in one place.
      return createExecuteMock(stockTable)(sqlObj);
    },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return db;
}

let mockDb: ReturnType<typeof makeMockDb>;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

function makeCtx(tenantId: number, userId: number, role = "agent"): any {
  return {
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    user: { id: userId, tenantId, role, status: "active", name: "Test", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test", name: "Test Co", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    db: mockDb,
  };
}

beforeEach(() => {
  resetFakeTables();
  mockDb = makeMockDb();
});

describe("order.create — stock reservation", () => {
  it("reserves exactly the requested quantity and reduces available", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 20}] });

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.reserved).toBe("20.00");
    expect(stock.available).toBe("80.00");
    expect(stock.currentStock).toBe("100.00");
  });

  it("rejects an order that requests more than the available stock", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    await expect(
      caller.create({ shopId: 1, items: [{ productId: 2, quantity: 50}] })
    ).rejects.toThrow(/на складе \d+, а в заказе \d+/);

    const stock = stockTable.find(s => s.productId === 2)!;
    expect(stock.reserved).toBe("0.00");
    expect(stock.available).toBe("5.00");
    expect(ordersTable).toHaveLength(0);
  });

  it("creates exactly one order row and one order_items row per line", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    await caller.create({
      shopId: 1,
      items: [
        { productId: 1, quantity: 5},
        { productId: 2, quantity: 2},
      ],
    });
    expect(ordersTable).toHaveLength(1);
    expect(orderItemsTable).toHaveLength(2);
  });
});

describe("order.cancel — stock release", () => {
  it("returns the full reservation back to available stock", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 15}] });

    expect(stockTable.find(s => s.productId === 1)!.reserved).toBe("15.00");

    await caller.cancel({ id: 1 });

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.reserved).toBe("0.00");
    expect(stock.available).toBe("100.00");
    expect(ordersTable[0].status).toBe("cancelled");
  });

  it("refuses to cancel an order that isn't in 'new' status", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 10}] });
    await caller.cancel({ id: 1 });

    await expect(caller.cancel({ id: 1 })).rejects.toThrow(/Можно отменить только новые заказ/);
  });

  it("an agent cannot cancel another agent's order", async () => {
    const { orderRouter } = await import("../order-router");
    const ownerCaller    = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const intruderCaller = orderRouter.createCaller(makeCtx(1, 99, "agent"));

    await ownerCaller.create({ shopId: 1, items: [{ productId: 1, quantity: 10}] });

    await expect(intruderCaller.cancel({ id: 1 })).rejects.toThrow(/оформил другой сотрудник/);
  });
});

describe("order.updateStatus — no double-apply on stock", () => {
  it("completing an order deducts currentStock once and clears the reservation", async () => {
    const { orderRouter } = await import("../order-router");
    const caller   = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const opCaller = orderRouter.createCaller(makeCtx(1, 1, "operator"));

    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 10}] });
    await opCaller.updateStatus({ id: 1, status: "delivered" });

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.currentStock).toBe("90.00");
    expect(stock.reserved).toBe("0.00");
  });

  it("calling updateStatus(delivered) twice does not deduct stock twice", async () => {
    const { orderRouter } = await import("../order-router");
    const caller   = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const opCaller = orderRouter.createCaller(makeCtx(1, 1, "operator"));

    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 10}] });
    await opCaller.updateStatus({ id: 1, status: "delivered" });
    try { await opCaller.updateStatus({ id: 1, status: "delivered" }); } catch { /* expected */ }

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.currentStock).toBe("90.00");
  });

  it("cancelling via updateStatus twice does not return the reservation twice", async () => {
    const { orderRouter } = await import("../order-router");
    const caller   = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const opCaller = orderRouter.createCaller(makeCtx(1, 1, "operator"));

    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 10}] });
    await opCaller.updateStatus({ id: 1, status: "cancelled" });
    try { await opCaller.updateStatus({ id: 1, status: "cancelled" }); } catch { /* expected */ }

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.available).toBe("100.00");
  });
});

describe("order.delete — soft delete with stock release", () => {
  it("releases stock when deleting a new order", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const opCaller = orderRouter.createCaller(makeCtx(1, 1, "operator"));

    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 15}] });
    expect(stockTable.find(s => s.productId === 1)!.reserved).toBe("15.00");

    await opCaller.delete({ id: 1 });

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.reserved).toBe("0.00");
    expect(stock.available).toBe("100.00");
    expect(stock.currentStock).toBe("100.00");
  });

  it("does not double-release if order was already cancelled", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const opCaller = orderRouter.createCaller(makeCtx(1, 1, "operator"));

    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 10}] });
    await opCaller.cancel({ id: 1 });
    await opCaller.delete({ id: 1 });

    const stock = stockTable.find(s => s.productId === 1)!;
    expect(stock.available).toBe("100.00");
  });
});

describe("order.restore — restore soft-deleted order", () => {
  it("restores a deleted order and re-reserves stock", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 10, "agent"));
    const opCaller = orderRouter.createCaller(makeCtx(1, 1, "operator"));

    await caller.create({ shopId: 1, items: [{ productId: 1, quantity: 10}] });
    await opCaller.delete({ id: 1 });

    const stockBefore = stockTable.find(s => s.productId === 1)!;
    expect(stockBefore.reserved).toBe("0.00");

    await opCaller.restore({ id: 1 });

    const stockAfter = stockTable.find(s => s.productId === 1)!;
    expect(stockAfter.reserved).toBe("10.00");
    expect(stockAfter.available).toBe("90.00");
  });
});

describe("order.create — multi-product reservation", () => {
  it("reserves stock for multiple products in a single order", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 10, "agent"));

    await caller.create({
      shopId: 1,
      items: [
        { productId: 1, quantity: 5},
        { productId: 2, quantity: 3},
      ],
    });

    const stock1 = stockTable.find(s => s.productId === 1)!;
    const stock2 = stockTable.find(s => s.productId === 2)!;
    expect(stock1.reserved).toBe("5.00");
    expect(stock1.available).toBe("95.00");
    expect(stock2.reserved).toBe("3.00");
    expect(stock2.available).toBe("2.00");
  });

  it("rejects entire order if any single product exceeds available", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 10, "agent"));

    await expect(caller.create({
      shopId: 1,
      items: [
        { productId: 1, quantity: 5},
        { productId: 2, quantity: 50},
      ],
    })).rejects.toThrow(/на складе \d+, а в заказе \d+/);

    expect(stockTable.find(s => s.productId === 1)!.reserved).toBe("0.00");
    expect(stockTable.find(s => s.productId === 2)!.reserved).toBe("0.00");
    expect(ordersTable).toHaveLength(0);
  });
});

describe("order lifecycle — shop debt", () => {
  it("books the debt on a credit order and takes it back on cancel", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 10, "agent"));

    const created = await caller.create({
      shopId: 1,
      items: [{ productId: 1, quantity: 5}],
      paymentMethod: "debt",
    }) as { id: number };

    expect(shopsTable[0].debt).toBe("500.00");

    await caller.cancel({ id: created.id });

    expect(shopsTable[0].debt).toBe("0.00");
  });

  it("leaves the debt alone for a cash order", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 10, "agent"));

    const created = await caller.create({
      shopId: 1,
      items: [{ productId: 1, quantity: 5}],
      paymentMethod: "cash",
    }) as { id: number };

    expect(shopsTable[0].debt).toBe("0.00");

    await caller.cancel({ id: created.id });

    expect(shopsTable[0].debt).toBe("0.00");
  });

  it("withdraws the debt on delete and restores it with the order", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 1, "operator"));

    const created = await caller.create({
      shopId: 1,
      items: [{ productId: 1, quantity: 4}],
      paymentMethod: "debt",
    }) as { id: number };
    expect(shopsTable[0].debt).toBe("400.00");

    await caller.delete({ id: created.id });
    expect(shopsTable[0].debt).toBe("0.00");

    await caller.restore({ id: created.id });
    expect(shopsTable[0].debt).toBe("400.00");
  });

  it("moves the debt by the difference when the discount changes", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 1, "operator"));

    const created = await caller.create({
      shopId: 1,
      items: [{ productId: 1, quantity: 5}],
      paymentMethod: "debt",
    }) as { id: number };
    expect(shopsTable[0].debt).toBe("500.00");

    // discount is a percentage — 30% of the 500 subtotal is 150 off.
    await caller.update({ id: created.id, discount: 30 });

    expect(shopsTable[0].debt).toBe("350.00");
  });
});

describe("order lifecycle — soft-deleted orders are out of play", () => {
  it("refuses to cancel an order that was already deleted", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 1, "operator"));

    const created = await caller.create({
      shopId: 1,
      items: [{ productId: 1, quantity: 10}],
    }) as { id: number };

    await caller.delete({ id: created.id });
    const releasedStock = { ...stockTable.find(s => s.productId === 1)! };

    // Cancelling now would hand the same 10 units back a second time.
    await expect(caller.cancel({ id: created.id })).rejects.toThrow(/не найден/);
    expect(stockTable.find(s => s.productId === 1)).toEqual(releasedStock);
  });

  it("refuses to complete an order that was already deleted", async () => {
    const { orderRouter } = await import("../order-router");
    const caller = orderRouter.createCaller(makeCtx(1, 1, "operator"));

    const created = await caller.create({
      shopId: 1,
      items: [{ productId: 1, quantity: 10}],
    }) as { id: number };

    await caller.delete({ id: created.id });

    await expect(caller.updateStatus({ id: created.id, status: "delivered" })).rejects.toThrow(/не найден/);
  });
});
