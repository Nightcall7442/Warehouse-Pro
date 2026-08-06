/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AUDIT PROBE — not a product test. Drives the real courier.completeDelivery
 * handler and prints the money/stock fields it writes, so the two partial-return
 * implementations (services/order.ts vs courier-router.ts) can be compared on
 * identical input.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq:  (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
  and: (...conds: unknown[]) => ({ __kind: "and", conds }),
  desc: (col: unknown) => ({ __kind: "desc", col }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings: [...strings], values }),
}));
vi.mock("../lib/sse", () => ({ sseBus: { emit: vi.fn() } }));
vi.mock("../lib/sanitize", () => ({ sanitizeString: (s: string) => s, sanitizeSearch: (s: string) => s }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../services/push-service", () => ({ sendPushToUser: vi.fn(async () => {}) }));
vi.mock("../lib/feature-gating", () => ({ checkSubscriptionAccess: vi.fn(async () => true) }));

import { orders, shops, users, payments, notifications, orderItems, warehouseStock, warehouses, debtReminders, stockMovements } from "@db/schema";

type Row = Record<string, any>;

let ordersTable: Row[] = [];
let itemsTable: Row[] = [];
let stocksTable: Row[] = [];
let paymentsTable: Row[] = [];
const shopsTable: Row[] = [{ id: 1, tenantId: 1, name: "Shop A", debt: "0.00" }];
const usersTable: Row[] = [
  { id: 100, tenantId: 1, name: "Courier", role: "courier", status: "active" },
  { id: 10, tenantId: 1, name: "Agent", role: "agent", status: "active" },
  { id: 1, tenantId: 1, name: "CEO", role: "ceo", status: "active" },
];
const warehousesTable: Row[] = [{ id: 1, tenantId: 1, isDefault: true }];

function reset() {
  // 2 lines: 10 x 100 = 1000, 5 x 200 = 1000. subtotal 2000, 10% off, total 1800.
  ordersTable = [{
    id: 1, tenantId: 1, orderNumber: "ORD-001", status: "processing", deliveryStatus: "assigned",
    subtotal: "2000.00", discount: "200.00", total: "1800.00",
    shopId: 1, courierId: 100, agentId: 10, paymentMethod: "cash", deliveredAt: null, deletedAt: null,
  }];
  itemsTable = [
    { id: 1, orderId: 1, productId: 1, quantity: "10.00", unitPrice: "100.00", costPrice: "60.00", subtotal: "1000.00", deliveredQuantity: null },
    { id: 2, orderId: 1, productId: 2, quantity: "5.00", unitPrice: "200.00", costPrice: "120.00", subtotal: "1000.00", deliveredQuantity: null },
  ];
  stocksTable = [
    { id: 1, productId: 1, tenantId: 1, warehouseId: 1, currentStock: "100.00", reserved: "10.00", available: "90.00" },
    { id: 2, productId: 2, tenantId: 1, warehouseId: 1, currentStock: "50.00", reserved: "5.00", available: "45.00" },
  ];
  paymentsTable = [];
}

function tableOf(ref: unknown) {
  if (ref === orders) return ordersTable;
  if (ref === orderItems) return itemsTable;
  if (ref === warehouseStock) return stocksTable;
  if (ref === shops) return shopsTable;
  if (ref === users) return usersTable;
  if (ref === warehouses) return warehousesTable;
  if (ref === payments) return paymentsTable;
  return null;
}
function nameOf(ref: unknown) {
  if (ref === payments) return "payments";
  if (ref === notifications) return "notifications";
  if (ref === debtReminders) return "debtReminders";
  if (ref === stockMovements) return "stockMovements";
  return "other";
}

const colToField = new Map<unknown, string>();
for (const t of [orders, orderItems, warehouseStock, shops, users, warehouses, payments]) {
  for (const [f, c] of Object.entries(t)) colToField.set(c, f);
}

function evalCond(row: Row, cond: any): boolean {
  if (!cond || typeof cond !== "object") return true;
  if (cond.__kind === "and") return cond.conds.every((c: any) => evalCond(row, c));
  if (cond.__kind === "eq") {
    const f = colToField.get(cond.col);
    if (!f) return true;
    return String(row[f]) === String(cond.val);
  }
  if (cond.__kind === "sql") {
    // `deliveryStatus IN ('assigned','out_for_delivery')`
    const s = (cond.strings as string[]).join("");
    if (s.includes("IN ('assigned', 'out_for_delivery')")) {
      return row.deliveryStatus === "assigned" || row.deliveryStatus === "out_for_delivery";
    }
    return true;
  }
  return true;
}

const stockSql: string[] = [];

function applyStockSql(strings: string[], values: any[]) {
  const full = strings.join("?").replace(/\s+/g, " ").trim();
  if (!full.includes("UPDATE warehouse_stock")) return;
  stockSql.push(full + "  <= " + JSON.stringify(values));
  const n = values.map(Number);
  const find = (pid: number) => stocksTable.find(s => Number(s.productId) === pid);
  const set = (r: Row, f: string, v: number) => { r[f] = v.toFixed(2); };

  if (full.includes("current_stock = current_stock - ?, reserved = GREATEST(0, reserved - ?), available = available + ?")) {
    const [delivered, ordered, returned, pid] = n;
    const r = find(pid); if (!r) return;
    set(r, "currentStock", Number(r.currentStock) - delivered);
    set(r, "reserved", Math.max(0, Number(r.reserved) - ordered));
    set(r, "available", Number(r.available) + returned);
    return;
  }
  if (full.includes("current_stock = current_stock - ?, reserved = GREATEST(0, reserved - ?)")) {
    const [qty, qty2, pid] = n;
    const r = find(pid); if (!r) return;
    set(r, "currentStock", Number(r.currentStock) - qty);
    set(r, "reserved", Math.max(0, Number(r.reserved) - qty2));
    return;
  }
  if (full.includes("reserved = GREATEST(0, reserved - ?), available = available + ?")) {
    const [qty, qty2, pid] = n;
    const r = find(pid); if (!r) return;
    set(r, "reserved", Math.max(0, Number(r.reserved) - qty));
    set(r, "available", Number(r.available) + qty2);
    return;
  }
  throw new Error("PROBE: unmodelled stock SQL: " + full);
}

function makeDb() {
  const db: Row = {
    select: () => {
      let rows: Row[] = [];
      const api: Row = {
        from(ref: unknown) { rows = tableOf(ref) ?? []; return api; },
        leftJoin() { return api; },
        innerJoin() { return api; },
        where(cond: unknown) {
          const out = rows.filter(r => evalCond(r, cond));
          const wrap = (a: Row[]): any => Object.assign(Promise.resolve(a), {
            limit: (k: number) => wrap(a.slice(0, k)),
            for: () => wrap(a),
            orderBy: () => wrap(a),
          });
          return wrap(out);
        },
        limit: (k: number) => Promise.resolve(rows.slice(0, k)),
      };
      return api;
    },
    insert: (ref: unknown) => ({
      values: (v: any) => {
        if (nameOf(ref) === "payments") paymentsTable.push({ id: paymentsTable.length + 1, ...v });
        return Promise.resolve([{ insertId: 1 }]);
      },
    }),
    update: (ref: unknown) => ({
      set: (patch: Row) => ({
        where: (cond: unknown) => {
          const rows = tableOf(ref) ?? [];
          let k = 0;
          for (const r of rows) { if (!evalCond(r, cond)) continue; k++; for (const [key, val] of Object.entries(patch)) if (val !== undefined) r[key] = val; }
          return Promise.resolve([{ affectedRows: k }]);
        },
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    transaction: async (fn: (tx: Row) => Promise<unknown>) => fn(db),
    execute: (q: any) => {
      if (q?.strings) applyStockSql(q.strings, q.values ?? []);
      return Promise.resolve([{ affectedRows: 1 }]);
    },
  };
  return db;
}

let mockDb: ReturnType<typeof makeDb>;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

function ctx(role = "courier", userId = 100): any {
  return {
    req: new Request("http://localhost/"), resHeaders: new Headers(),
    user: { id: userId, tenantId: 1, role, status: "active", name: "T", email: "t@t.com" },
    tenant: { id: 1, slug: "t", name: "T", plan: "trial", status: "active" },
    db: mockDb,
  };
}

beforeEach(() => { reset(); stockSql.length = 0; mockDb = makeDb(); });

function snapshot(label: string) {
  const o = ordersTable[0];
  console.log(label, {
    orders: { status: o.status, subtotal: o.subtotal, discount: o.discount, total: o.total },
    order_items: itemsTable.map(i => ({ id: i.id, quantity: i.quantity, delivered: i.deliveredQuantity, subtotal: i.subtotal })),
    SUM_item_subtotal: itemsTable.reduce((s, i) => s + Number(i.subtotal), 0).toFixed(2),
    stock: stocksTable.map(s => ({ p: s.productId, cur: s.currentStock, res: s.reserved, avail: s.available })),
    payments: paymentsTable.map(p => ({ amount: p.amount, total: p.totalOrderAmount, debt: p.debtAmount })),
  });
}

describe("PROBE E: courier partial_returned", () => {
  it("returns 4 of 10 on line 1, nothing on line 2", async () => {
    const { courierRouter } = await import("../courier-router");
    await courierRouter.createCaller(ctx()).completeDelivery({
      orderId: 1, result: "partial_returned", paymentMethod: "cash",
      returnedItems: [{ itemId: 1, returnedQty: 4 }],
    });
    snapshot("PROBE E ->");
    console.log("PROBE E expected order total = (6*100 + 5*200) * 0.9 =", ((6 * 100 + 5 * 200) * 0.9).toFixed(2));
    expect(ordersTable[0].total).toBeDefined();
  });
});

describe("PROBE F: courier partial_returned WITHOUT returnedItems", () => {
  it("prints what happens when the array is omitted", async () => {
    const { courierRouter } = await import("../courier-router");
    await courierRouter.createCaller(ctx()).completeDelivery({
      orderId: 1, result: "partial_returned", paymentMethod: "cash",
    });
    snapshot("PROBE F ->");
    console.log("PROBE F stockSql:", stockSql);
    expect(ordersTable[0].status).toBeDefined();
  });
});

describe("PROBE G: courier returnedQty larger than ordered / negative", () => {
  it("prints what an out-of-range returnedQty does", async () => {
    const { courierRouter } = await import("../courier-router");
    await courierRouter.createCaller(ctx()).completeDelivery({
      orderId: 1, result: "partial_returned", paymentMethod: "cash",
      returnedItems: [{ itemId: 1, returnedQty: 25 }, { itemId: 2, returnedQty: -3 }],
    });
    snapshot("PROBE G ->");
    console.log("PROBE G stockSql:", stockSql);
    expect(true).toBe(true);
  });
});

describe("PROBE H: courier full 'returned'", () => {
  it("prints orders.total after a full return", async () => {
    const { courierRouter } = await import("../courier-router");
    await courierRouter.createCaller(ctx()).completeDelivery({
      orderId: 1, result: "returned", paymentMethod: "cash",
      debtDueDate: "2026-09-01",
    });
    snapshot("PROBE H ->");
    expect(true).toBe(true);
  });
});

describe("PROBE I: courier 'paid' with a stale client-side amount above the order total", () => {
  it("prints whether an overpayment is rejected", async () => {
    const { courierRouter } = await import("../courier-router");
    await courierRouter.createCaller(ctx()).completeDelivery({
      orderId: 1, result: "paid", paidAmount: "5000", paymentMethod: "cash",
    });
    snapshot("PROBE I ->");
    expect(true).toBe(true);
  });
});

describe("PROBE J: operator partial delivery first, courier 'paid' afterwards", () => {
  it("prints stock after both paths run on the same order", async () => {
    // Simulate what OrderService.applyPartialDelivery leaves behind: status
    // delivered, totals shrunk, deliveredQuantity set, reservation released,
    // current_stock already deducted for the delivered part. deliveryStatus is
    // untouched, so the order is still 'assigned' to the courier.
    ordersTable[0].status = "delivered";
    ordersTable[0].subtotal = "1600.00"; ordersTable[0].discount = "160.00"; ordersTable[0].total = "1440.00";
    itemsTable[0].deliveredQuantity = "6.00"; itemsTable[0].subtotal = "600.00";
    itemsTable[1].deliveredQuantity = "5.00";
    stocksTable[0] = { ...stocksTable[0], currentStock: "94.00", reserved: "0.00", available: "94.00" };
    stocksTable[1] = { ...stocksTable[1], currentStock: "45.00", reserved: "0.00", available: "45.00" };

    const { courierRouter } = await import("../courier-router");
    await courierRouter.createCaller(ctx()).completeDelivery({
      orderId: 1, result: "paid", paidAmount: "1440", paymentMethod: "cash",
    });
    snapshot("PROBE J ->");
    console.log("PROBE J stockSql:", stockSql);
    expect(true).toBe(true);
  });
});

describe("PROBE G2: courier returns MORE than ordered on every line", () => {
  it("prints whether orders.subtotal/discount go negative", async () => {
    const { courierRouter } = await import("../courier-router");
    await courierRouter.createCaller(ctx()).completeDelivery({
      orderId: 1, result: "partial_returned", paymentMethod: "cash",
      returnedItems: [{ itemId: 1, returnedQty: 25 }, { itemId: 2, returnedQty: 25 }],
    });
    const o = ordersTable[0];
    console.log("PROBE G2 ->", { status: o.status, subtotal: o.subtotal, discount: o.discount, total: o.total });
    expect(true).toBe(true);
  });
});
