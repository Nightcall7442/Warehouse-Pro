/**
 * AUDIT PROBE — not a product test. Runs the real OrderService partial-delivery
 * code path against a minimal fake tx and prints the money fields it writes.
 * Stock columns are NOT modelled here (the UPDATE ... GREATEST statement is
 * captured verbatim instead, so we can read what MySQL would have been asked).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", () => {
  const sqlFn = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings: [...strings], values }),
    {
      join(chunks: unknown[]) { return { __kind: "sql_join", chunks }; },
      raw(str: string) { return { __kind: "sql_raw", str }; },
    },
  );
  return {
    eq: (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
    and: (...conds: unknown[]) => ({ __kind: "and", conds }),
    or: (...conds: unknown[]) => ({ __kind: "or", conds }),
    desc: (col: unknown) => ({ __kind: "desc", col }),
    isNull: (col: unknown) => ({ __kind: "isNull", col }),
    isNotNull: (col: unknown) => ({ __kind: "isNotNull", col }),
    inArray: (col: unknown, vals: unknown) => ({ __kind: "inArray", col, vals }),
    sql: sqlFn,
  };
});
vi.mock("drizzle-orm/mysql-core", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, alias: (t: unknown) => t };
});

import { orders, orderItems, warehouses, warehouseStock } from "@db/schema";

type Row = Record<string, unknown>;

let ordersTable: Row[] = [];
let itemsTable: Row[] = [];
let stockTable: Row[] = [];
let warehousesTable: Row[] = [{ id: 1, tenantId: 1, isDefault: true }];
const rawSql: string[] = [];

const colToField = new Map<unknown, string>();
for (const t of [orders, orderItems, warehouses, warehouseStock]) {
  for (const [f, c] of Object.entries(t)) colToField.set(c, f);
}

function evalCond(row: Row, cond: unknown): boolean {
  if (!cond || typeof cond !== "object") return true;
  const c = cond as Row;
  if (c.__kind === "and") return (c.conds as unknown[]).every(x => evalCond(row, x));
  if (c.__kind === "isNull") return row[colToField.get(c.col) ?? ""] == null;
  if (c.__kind === "eq") {
    const f = colToField.get(c.col);
    if (!f) return true;
    return String(row[f]) === String(c.val);
  }
  return true;
}

function tableOf(ref: unknown) {
  if (ref === orders) return ordersTable;
  if (ref === orderItems) return itemsTable;
  if (ref === warehouses) return warehousesTable;
  if (ref === warehouseStock) return stockTable;
  return null;
}

function makeDb() {
  const db: Record<string, unknown> = {
    select: () => {
      let rows: Row[] = [];
      const api: Record<string, unknown> = {
        from(ref: unknown) { rows = tableOf(ref) ?? []; return api; },
        leftJoin() { return api; },
        innerJoin() { return api; },
        where(cond: unknown) {
          const out = rows.filter(r => evalCond(r, cond));
          const wrap = (a: Row[]): unknown => Object.assign(Promise.resolve(a), {
            limit: (n: number) => wrap(a.slice(0, n)),
            for: () => wrap(a),
            orderBy: () => wrap(a),
          });
          return wrap(out);
        },
      };
      return api;
    },
    execute: (s: unknown) => {
      const o = s as { strings?: string[]; values?: unknown[] };
      if (o?.strings) {
        const full = o.strings.join("?").replace(/\s+/g, " ").trim();
        rawSql.push(full);
        if (full.includes("UPDATE warehouse_stock SET current_stock = current_stock - ?, reserved = GREATEST(0, reserved - ?), available = available + ?")) {
          const v = (o.values ?? []).map(Number);
          const [delivered, ordered, returned, pid] = v;
          const r = stockTable.find(x => Number(x.productId) === pid);
          if (r) {
            r.currentStock = (Number(r.currentStock) - delivered).toFixed(2);
            r.reserved = Math.max(0, Number(r.reserved) - ordered).toFixed(2);
            r.available = (Number(r.available) + returned).toFixed(2);
          }
        }
        if (full.includes("UPDATE warehouse_stock SET current_stock = current_stock - ?, available = available - ?")) {
          const v = (o.values ?? []).map(Number);
          const [delta, , pid] = v;
          const r = stockTable.find(x => Number(x.productId) === pid);
          if (r) {
            r.currentStock = (Number(r.currentStock) - delta).toFixed(2);
            r.available = (Number(r.available) - delta).toFixed(2);
          }
        }
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    },
    insert: () => ({ values: () => Promise.resolve([{ insertId: 1 }]) }),
    update: (ref: unknown) => ({
      set: (patch: Row) => ({
        where: (cond: unknown) => {
          const rows = tableOf(ref) ?? [];
          let n = 0;
          for (const r of rows) {
            if (!evalCond(r, cond)) continue;
            n++;
            Object.assign(r, patch);
          }
          return Promise.resolve([{ affectedRows: n }]);
        },
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return db;
}

let db: ReturnType<typeof makeDb>;

import { OrderService } from "../order";

beforeEach(() => {
  rawSql.length = 0;
  // Order: 2 lines. line1 = 10 x 100 = 1000, line2 = 5 x 200 = 1000.
  // subtotal 2000, discount 10% = 200, total 1800.
  ordersTable = [{
    id: 1, tenantId: 1, orderNumber: "ORD-1", shopId: 1, agentId: 10,
    status: "new", subtotal: "2000.00", discount: "200.00", total: "1800.00",
    deletedAt: null,
  }];
  itemsTable = [
    { id: 101, orderId: 1, productId: 1, quantity: "10.00", unitPrice: "100.00", subtotal: "1000.00", deliveredQuantity: null },
    { id: 102, orderId: 1, productId: 2, quantity: "5.00", unitPrice: "200.00", subtotal: "1000.00", deliveredQuantity: null },
  ];
  stockTable = [
    { productId: 1, tenantId: 1, warehouseId: 1, currentStock: "100.00", reserved: "10.00", available: "90.00" },
    { productId: 2, tenantId: 1, warehouseId: 1, currentStock: "50.00", reserved: "5.00", available: "45.00" },
  ];
  warehousesTable = [{ id: 1, tenantId: 1, isDefault: true }];
  db = makeDb();
});

describe("PROBE A: partial delivery naming only a SUBSET of the order's lines", () => {
  it("prints what orders.subtotal/total become", async () => {
    // Operator (or any API client) records delivery for line 101 only.
    // Line 102 is untouched: still ordered, still reserved, still owed.
    await OrderService.recordPartialDelivery(db as never, 1, 7, {
      orderId: 1,
      items: [{ itemId: 101, deliveredQuantity: 6, returnReason: "нет места" }],
    });

    const o = ordersTable[0];
    const sumOfLines = itemsTable.reduce((s, i) => s + Number(i.subtotal), 0);
    console.log("PROBE A ->", {
      ordersSubtotal: o.subtotal, ordersDiscount: o.discount, ordersTotal: o.total,
      lineSubtotals: itemsTable.map(i => ({ id: i.id, qty: i.quantity, delivered: i.deliveredQuantity, subtotal: i.subtotal })),
      sumOfLineSubtotals: sumOfLines.toFixed(2),
      expectedSubtotalIfLine102StillCounts: (6 * 100 + 5 * 200).toFixed(2),
      stockSqlIssued: rawSql.filter(s => s.includes("warehouse_stock")).length,
    });
    expect(o.subtotal).toBeDefined();
  });
});

describe("PROBE B: partial delivery that removes every line (all returned)", () => {
  it("prints totals when deliveredQuantity is 0 on every line", async () => {
    await OrderService.recordPartialDelivery(db as never, 1, 7, {
      orderId: 1,
      items: [
        { itemId: 101, deliveredQuantity: 0, returnReason: "всё вернули" },
        { itemId: 102, deliveredQuantity: 0, returnReason: "всё вернули" },
      ],
    });
    const o = ordersTable[0];
    console.log("PROBE B ->", {
      status: o.status, subtotal: o.subtotal, discount: o.discount, total: o.total,
      lines: itemsTable.map(i => ({ id: i.id, qty: i.quantity, delivered: i.deliveredQuantity, subtotal: i.subtotal })),
    });
    expect(o.total).toBeDefined();
  });
});

describe("PROBE C: two sequential partial deliveries, one line each", () => {
  it("prints the running totals", async () => {
    await OrderService.recordPartialDelivery(db as never, 1, 7, {
      orderId: 1, items: [{ itemId: 101, deliveredQuantity: 10 }],
    });
    console.log("PROBE C after call#1 ->", { subtotal: ordersTable[0].subtotal, discount: ordersTable[0].discount, total: ordersTable[0].total });
    await OrderService.recordPartialDelivery(db as never, 1, 7, {
      orderId: 1, items: [{ itemId: 102, deliveredQuantity: 5 }],
    });
    console.log("PROBE C after call#2 ->", {
      subtotal: ordersTable[0].subtotal, discount: ordersTable[0].discount, total: ordersTable[0].total,
      lines: itemsTable.map(i => ({ id: i.id, subtotal: i.subtotal, delivered: i.deliveredQuantity })),
    });
    expect(ordersTable[0].total).toBeDefined();
  });
});

describe("PROBE D: deliveredQuantity greater than ordered is rejected, negative is not", () => {
  it("prints what a negative deliveredQuantity does", async () => {
    let err: string | null = null;
    try {
      await OrderService.recordPartialDelivery(db as never, 1, 7, {
        orderId: 1, items: [{ itemId: 101, deliveredQuantity: -4 }, { itemId: 102, deliveredQuantity: 5 }],
      });
    } catch (e) { err = (e as Error).message; }
    console.log("PROBE D ->", {
      error: err,
      subtotal: ordersTable[0].subtotal, discount: ordersTable[0].discount, total: ordersTable[0].total,
      stockSql: rawSql.filter(s => s.includes("warehouse_stock")),
    });
    expect(true).toBe(true);
  });
});

describe("PROBE L: applyPartialDelivery run on an order that is ALREADY delivered", () => {
  it("prints stock after a repeat run (deliveredQuantity still null)", async () => {
    // Delivered earlier by OrderService.updateStatus, which does not set
    // deliveredQuantity — so the idempotency guard does not fire.
    ordersTable[0].status = "delivered";
    stockTable[0] = { ...stockTable[0], currentStock: "90.00", reserved: "0.00", available: "90.00" };
    stockTable[1] = { ...stockTable[1], currentStock: "45.00", reserved: "0.00", available: "45.00" };

    let err: string | null = null;
    try {
      await OrderService.recordPartialDelivery(db as never, 1, 7, {
        orderId: 1,
        items: [{ itemId: 101, deliveredQuantity: 10 }, { itemId: 102, deliveredQuantity: 5 }],
      });
    } catch (e) { err = (e as Error).message; }

    console.log("PROBE L ->", {
      error: err,
      orders: { status: ordersTable[0].status, subtotal: ordersTable[0].subtotal, total: ordersTable[0].total },
      stock: stockTable.map(s => ({ p: s.productId, cur: s.currentStock, res: s.reserved, avail: s.available })),
    });
    expect(true).toBe(true);
  });
});

describe("PROBE M: tenant has no default warehouse", () => {
  it("prints whether partial delivery still changes money", async () => {
    warehousesTable = [];
    let err: string | null = null;
    try {
      await OrderService.recordPartialDelivery(db as never, 1, 7, {
        orderId: 1,
        items: [{ itemId: 101, deliveredQuantity: 6 }, { itemId: 102, deliveredQuantity: 0 }],
      });
    } catch (e) { err = (e as Error).message; }
    console.log("PROBE M ->", {
      error: err,
      orders: { status: ordersTable[0].status, subtotal: ordersTable[0].subtotal, discount: ordersTable[0].discount, total: ordersTable[0].total },
      stock: stockTable.map(s => ({ p: s.productId, cur: s.currentStock, res: s.reserved, avail: s.available })),
      warehouseSqlIssued: rawSql.filter(s => s.includes("warehouse_stock")).length,
    });
    expect(true).toBe(true);
  });
});

describe("PROBE N: updateItems on an order that already went through partial delivery", () => {
  it("prints the stock delta and the new total", async () => {
    // State left by a partial delivery: line 101 ordered 10, delivered 6.
    // 6 units left the warehouse; 4 went back to available.
    ordersTable[0].status = "delivered";
    ordersTable[0].subtotal = "1600.00"; ordersTable[0].discount = "160.00"; ordersTable[0].total = "1440.00";
    itemsTable[0].deliveredQuantity = "6.00"; itemsTable[0].subtotal = "600.00";
    itemsTable[1].deliveredQuantity = "5.00";
    stockTable[0] = { productId: 1, tenantId: 1, warehouseId: 1, currentStock: "94.00", reserved: "0.00", available: "94.00" };
    stockTable[1] = { productId: 2, tenantId: 1, warehouseId: 1, currentStock: "45.00", reserved: "0.00", available: "45.00" };

    const before = JSON.parse(JSON.stringify(stockTable));
    // Operator corrects line 101 from "10 ordered" to 8.
    await OrderService.updateItems(db as never, 1, 1, {
      items: [{ itemId: 101, quantity: 8 }, { itemId: 102, quantity: 5 }],
    });

    console.log("PROBE N ->", {
      stockBefore: before.map((s: Record<string, string>) => ({ p: s.productId, cur: s.currentStock, avail: s.available })),
      stockAfter: stockTable.map(s => ({ p: s.productId, cur: s.currentStock, avail: s.available })),
      orders: { subtotal: ordersTable[0].subtotal, discount: ordersTable[0].discount, total: ordersTable[0].total },
      lines: itemsTable.map(i => ({ id: i.id, qty: i.quantity, delivered: i.deliveredQuantity, subtotal: i.subtotal })),
      note: "line 101 really consumed 6; operator says 8 => 2 MORE units should leave the warehouse",
      stockSql: rawSql.filter(s => s.includes("warehouse_stock")),
    });
    expect(true).toBe(true);
  });
});
