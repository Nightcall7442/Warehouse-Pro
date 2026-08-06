/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AUDIT EVIDENCE — not a product test. Delete after the audit.
 *
 * These cases model MySQL row locking in the STRONGEST possible way:
 * `db.transaction()` takes a global mutex, so no two transactions ever
 * overlap. Any interleaving that still corrupts stock/money here is therefore
 * broken *despite* perfect row locking — because the decision was made on a
 * read that happened outside the transaction, where no lock exists.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { deriveShopDebt, isShopDebtRecalc } from "./helpers/shop-debt-recalc";

vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  return drizzleMock();
});

import { orders, orderItems, warehouseStock, products, warehouses, shops, returns, returnItems, stockMovements } from "@db/schema";

interface FakeOrder { id: number; tenantId: number; agentId: number; shopId: number; status: string; deletedAt: Date | null; subtotal: string; discount: string; total: string; paymentMethod: string; }
interface FakeOrderItem { id: number; orderId: number; productId: number; quantity: string; unitPrice: string; subtotal: string; deliveredQuantity: string | null; }
interface FakeStock { productId: number; tenantId: number; warehouseId: number; currentStock: string; reserved: string; available: string; }
interface FakeReturn { id: number; tenantId: number; shopId: number; orderId: number | null; status: string; totalAmount: string; }
interface FakeReturnItem { id: number; returnId: number; productId: number; quantity: string; }

let ordersTable: FakeOrder[] = [];
let orderItemsTable: FakeOrderItem[] = [];
let stockTable: FakeStock[] = [];
let returnsTable: FakeReturn[] = [];
let returnItemsTable: FakeReturnItem[] = [];
let warehousesTable: { id: number; tenantId: number; isDefault: boolean }[] = [];
let shopsTable: { id: number; tenantId: number; debt: string }[] = [];
let productsTable: { id: number; tenantId: number; costPrice: string; unitPrice: string; status: string }[] = [];

function reset() {
  ordersTable = [];
  orderItemsTable = [];
  returnsTable = [];
  returnItemsTable = [];
  stockTable = [{ productId: 1, tenantId: 1, warehouseId: 1, currentStock: "100.00", reserved: "0.00", available: "100.00" }];
  warehousesTable = [{ id: 1, tenantId: 1, isDefault: true }];
  shopsTable = [{ id: 1, tenantId: 1, debt: "0.00" }];
  productsTable = [{ id: 1, tenantId: 1, costPrice: "50.00", unitPrice: "100.00", status: "active" }];
}

function tableOf(ref: unknown) {
  if (ref === orders) return "orders";
  if (ref === orderItems) return "orderItems";
  if (ref === warehouseStock) return "warehouseStock";
  if (ref === products) return "products";
  if (ref === warehouses) return "warehouses";
  if (ref === shops) return "shops";
  if (ref === returns) return "returns";
  if (ref === returnItems) return "returnItems";
  if (ref === stockMovements) return "stockMovements";
  return "other";
}
function rowsFor(t: string): any[] {
  switch (t) {
    case "orders": return ordersTable;
    case "orderItems": return orderItemsTable;
    case "warehouseStock": return stockTable;
    case "products": return productsTable;
    case "warehouses": return warehousesTable;
    case "shops": return shopsTable;
    case "returns": return returnsTable;
    case "returnItems": return returnItemsTable;
    default: return [];
  }
}

const colName = new Map<unknown, string>();
for (const tbl of [orders, orderItems, warehouseStock, products, warehouses, shops, returns, returnItems]) {
  for (const [field, col] of Object.entries(tbl)) colName.set(col, field);
}

function evalCond(row: any, cond: any): boolean {
  if (!cond || typeof cond !== "object") return true;
  if (cond.__kind === "and") return cond.conds.every((c: any) => evalCond(row, c));
  if (cond.__kind === "or") return cond.conds.some((c: any) => evalCond(row, c));
  const f = colName.get(cond.col) ?? cond.col?.name;
  if (cond.__kind === "eq") return String(row[f as string]) === String(cond.val);
  if (cond.__kind === "isNull") return row[f as string] === null || row[f as string] === undefined;
  if (cond.__kind === "isNotNull") return row[f as string] !== null && row[f as string] !== undefined;
  if (cond.__kind === "inArray") return (cond.values as any[]).map(String).includes(String(row[f as string]));
  return true;
}

function evalSqlSet(row: any, field: string, expr: any): any {
  if (!expr || typeof expr !== "object" || expr.__kind !== "sql") return expr;
  const opStr = (expr.strings as string[]).find(s => s.includes("+") || s.includes("-")) ?? "";
  const op = opStr.includes("+") ? "+" : "-";
  const amount = Number(expr.values[expr.values.length - 1]);
  return (op === "+" ? Number(row[field]) + amount : Number(row[field]) - amount).toFixed(2);
}

/** Global mutex — models MySQL row locks as *total* transaction serialization. */
let txChain: Promise<unknown> = Promise.resolve();
const txLog: string[] = [];

function makeDb() {
  const selectBuilder = () => {
    let table = "other";
    const api: any = {
      from(ref: unknown) { table = tableOf(ref); return api; },
      leftJoin() { return api; }, innerJoin() { return api; },
      groupBy() { return api; }, orderBy() { return api; },
      where(cond: unknown) {
        const filtered = rowsFor(table).filter(r => evalCond(r, cond));
        const chain: any = Object.assign(Promise.resolve(filtered), {
          limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
          orderBy: () => chain,
          for: () => chain,
        });
        return chain;
      },
      limit(n: number) { return Promise.resolve(rowsFor(table).slice(0, n)); },
    };
    return api;
  };

  let nextId = 100;
  const db: any = {
    select: () => selectBuilder(),
    insert: (ref: unknown) => ({
      values: (vals: any) => {
        const t = tableOf(ref);
        const list = Array.isArray(vals) ? vals : [vals];
        let id = 0;
        for (const v of list) {
          id = nextId++;
          if (t === "orderItems") orderItemsTable.push({ id, orderId: v.orderId, productId: v.productId, quantity: String(v.quantity), unitPrice: String(v.unitPrice ?? "0"), subtotal: String(v.subtotal ?? "0"), deliveredQuantity: null });
          else if (t === "warehouseStock") stockTable.push({ productId: v.productId, tenantId: v.tenantId, warehouseId: v.warehouseId, currentStock: String(v.currentStock), reserved: String(v.reserved), available: String(v.available) });
        }
        return Promise.resolve([{ insertId: id }]);
      },
    }),
    update: (ref: unknown) => ({
      set: (patch: any) => ({
        where: (cond: unknown) => {
          const t = tableOf(ref);
          let matched = 0;
          for (const row of rowsFor(t)) {
            if (!evalCond(row, cond)) continue;
            matched++;
            for (const [k, v] of Object.entries(patch)) {
              row[k] = v && typeof v === "object" && (v as any).__kind === "sql" ? evalSqlSet(row, k, v) : v;
            }
          }
          return Promise.resolve([{ affectedRows: matched }]);
        },
      }),
    }),
    delete: (ref: unknown) => ({
      where: (cond: unknown) => {
        const t = tableOf(ref);
        if (t === "orderItems") orderItemsTable = orderItemsTable.filter(r => !evalCond(r, cond));
        return Promise.resolve();
      },
    }),
    execute: (sqlObj: any) => {
      if (!sqlObj || sqlObj.__kind !== "sql") return Promise.resolve([{ affectedRows: 0 }]);
      const full = (sqlObj.strings as string[]).join("");
      const vals = sqlObj.values as any[];

      if (isShopDebtRecalc(full)) {
        const [shopId, tenantId] = vals.filter((v: unknown) => typeof v === "number");
        for (const s of shopsTable) if (s.id === shopId && s.tenantId === tenantId) {
          s.debt = deriveShopDebt(tenantId, shopId, { orders: ordersTable as any, returns: returnsTable as any });
        }
        return Promise.resolve([{ affectedRows: 1 }]);
      }

      if (full.includes("UPDATE warehouse_stock")) {
        const nums = vals.filter((v: unknown) => typeof v === "number") as number[];

        // OrderService.restore:  SET available = available - qty, reserved = reserved + qty
        if (full.includes("available = available -") && full.includes("reserved = reserved +")) {
          const [qty, , productId, tenantId] = nums.length >= 4 ? nums : [nums[0], nums[0], nums[1], nums[2]];
          for (const r of stockTable) if (r.productId === productId && r.tenantId === tenantId) {
            r.available = (Number(r.available) - qty).toFixed(2);
            r.reserved = (Number(r.reserved) + qty).toFixed(2);
          }
          return Promise.resolve([{ affectedRows: 1 }]);
        }

        // returns-router "completed":  current_stock = current_stock + CASE.., available = available + CASE..
        if (full.includes("current_stock = current_stock + CASE") && full.includes("available = available + CASE")) {
          const tenantId = nums[nums.length - 2];
          for (const v of vals) {
            if (!v || v.__kind !== "sql_join") continue;
            for (const chunk of v.chunks) {
              if (!chunk || chunk.__kind !== "sql") continue;
              const pid = Number(chunk.values[0]);
              const amt = Number(chunk.values[chunk.values.length - 1]);
              for (const r of stockTable) if (r.productId === pid && r.tenantId === tenantId) {
                if (full.indexOf("current_stock") < full.indexOf("available")) { /* both applied below */ }
              }
              const row = stockTable.find(r => r.productId === pid && r.tenantId === tenantId);
              if (row && !(row as any).__seen) {
                row.currentStock = (Number(row.currentStock) + amt).toFixed(2);
                row.available = (Number(row.available) + amt).toFixed(2);
                (row as any).__seen = true;
              }
            }
          }
          for (const r of stockTable) delete (r as any).__seen;
          return Promise.resolve([{ affectedRows: 1 }]);
        }
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    },
    transaction: (fn: (tx: unknown) => Promise<unknown>) => {
      // Total serialization: strictly stronger than any real row lock.
      const run = txChain.then(async () => {
        txLog.push("TX-START");
        const r = await fn(db);
        txLog.push("TX-COMMIT");
        return r;
      });
      txChain = run.catch(() => {});
      return run;
    },
  };
  return db;
}

let mockDb: any;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

beforeEach(() => {
  reset();
  txChain = Promise.resolve();
  txLog.length = 0;
  mockDb = makeDb();
});

describe("EVIDENCE 1 — OrderService.restore: the deletedAt check lives OUTSIDE the transaction", () => {
  it("two overlapping restores of the same deleted order reserve the stock twice, even with transactions fully serialized", async () => {
    const { OrderService } = await import("../services/order");

    // A deleted order for 10 units. delete() already released the reservation,
    // so stock is back to available=100 / reserved=0.
    ordersTable.push({ id: 1, tenantId: 1, agentId: 5, shopId: 1, status: "new", deletedAt: new Date(), subtotal: "1000.00", discount: "0.00", total: "1000.00", paymentMethod: "cash" });
    orderItemsTable.push({ id: 1, orderId: 1, productId: 1, quantity: "10", unitPrice: "100.00", subtotal: "1000.00", deliveredQuantity: null });

    const results = await Promise.allSettled([
      OrderService.restore(mockDb, 1, 1),
      OrderService.restore(mockDb, 1, 1),
    ]);

    const stock = stockTable.find(s => s.productId === 1)!;
    // eslint-disable-next-line no-console
    console.log("[restore] outcomes:", results.map(r => r.status));
    // eslint-disable-next-line no-console
    console.log("[restore] tx interleaving:", txLog.join(" -> "));
    // eslint-disable-next-line no-console
    console.log("[restore] stock after:", JSON.stringify(stock));
    // eslint-disable-next-line no-console
    console.log("[restore] invariant current_stock === available + reserved ?",
      Number(stock.currentStock) === Number(stock.available) + Number(stock.reserved));

    expect(results.every(r => r.status === "fulfilled")).toBe(true);
    // ONE restore should hold 10. Two overlapping restores hold 20.
    expect(stock.reserved).toBe("20.00");
    expect(stock.available).toBe("80.00");

  });

  it("EVIDENCE 2 — returns.updateStatus: approved→completed is checked outside the transaction and the UPDATE has no status guard", async () => {
    const { returnsRouter } = await import("../returns-router");
    const { asTestContext } = await import("./helpers/test-context");

    returnsTable.push({ id: 7, tenantId: 1, shopId: 1, orderId: null, status: "approved", totalAmount: "1000.00" });
    returnItemsTable.push({ id: 1, returnId: 7, productId: 1, quantity: "10" });

    const ctx = asTestContext({
      req: new Request("http://localhost/"), resHeaders: new Headers(), db: mockDb,
      tenant: { id: 1, slug: "t", name: "T", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
      user: { id: 10, tenantId: 1, role: "operator" as const, status: "active" as const, name: "T", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    });
    const caller = returnsRouter.createCaller(ctx);

    const results = await Promise.allSettled([
      caller.updateStatus({ id: 7, status: "completed" }),
      caller.updateStatus({ id: 7, status: "completed" }),
    ]);
    const stock = stockTable.find(s => s.productId === 1)!;
    // eslint-disable-next-line no-console
    console.log("[returns] outcomes:", results.map(r => r.status === "rejected" ? `rejected(${(r.reason as Error).message})` : "fulfilled"));
    // eslint-disable-next-line no-console
    console.log("[returns] tx interleaving:", txLog.join(" -> "));
    // eslint-disable-next-line no-console
    console.log("[returns] stock after (a 10-unit return against a 100-unit shelf):", JSON.stringify(stock));

    expect(results.every(r => r.status === "fulfilled")).toBe(true);
    expect(stock.currentStock).toBe("120.00");
    expect(stock.available).toBe("120.00");
  });

  it("baseline: the same two calls run strictly one after the other are correct", async () => {
    const { OrderService } = await import("../services/order");
    ordersTable.push({ id: 1, tenantId: 1, agentId: 5, shopId: 1, status: "new", deletedAt: new Date(), subtotal: "1000.00", discount: "0.00", total: "1000.00", paymentMethod: "cash" });
    orderItemsTable.push({ id: 1, orderId: 1, productId: 1, quantity: "10", unitPrice: "100.00", subtotal: "1000.00", deliveredQuantity: null });

    await OrderService.restore(mockDb, 1, 1);
    const second = await OrderService.restore(mockDb, 1, 1).catch(e => e as Error);
    const stock = stockTable.find(s => s.productId === 1)!;
    // eslint-disable-next-line no-console
    console.log("[restore-sequential] second call:", second instanceof Error ? second.message : "SUCCEEDED");
    // eslint-disable-next-line no-console
    console.log("[restore-sequential] stock after:", JSON.stringify(stock));
    expect(stock.reserved).toBe("10.00");
  });
});
