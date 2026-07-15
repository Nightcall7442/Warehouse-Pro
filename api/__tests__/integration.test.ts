/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", () => {
  const sqlFn = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values }),
    {
      join(chunks: unknown[], _sep?: unknown) { return { __kind: "sql_join", chunks }; },
      raw(str: string) { return { __kind: "sql_raw", str }; },
    },
  );
  return {
    eq: (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
    and: (...conds: unknown[]) => ({ __kind: "and", conds }),
    desc: (col: unknown) => ({ __kind: "desc", col }),
    like: (col: unknown, val: unknown) => ({ __kind: "like", col, val }),
    isNull: (col: unknown) => ({ __kind: "isNull", col }),
    sql: sqlFn,
    ne: (col: unknown, val: unknown) => ({ __kind: "ne", col, val }),
  };
});

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

import {
  orders, orderItems, warehouseStock, products, stockMovements,
  shops, users, payments, settings, warehouses,
} from "@db/schema";

interface FakeOrder { id: number; tenantId: number; agentId: number; shopId: number; status: string; orderNumber: string; subtotal: string; discount: string; total: string; notes: string | null; createdAt: Date; updatedAt: Date; }
interface FakeOrderItem { id: number; orderId: number; productId: number; quantity: string; unitPrice: string; subtotal: string; createdAt: Date; }
interface FakeStock { id: number; productId: number; tenantId: number; warehouseId: number; currentStock: string; reserved: string; available: string; updatedAt: Date; }
interface FakeProduct { id: number; tenantId: number; name: string; code: string; unitPrice: string; costPrice: string; reorderPoint: string; category: string | null; unit: string; status: string; barcode?: string | null; photoUrl?: string | null; description?: string | null; unitWeight?: string; }
interface FakeMovement { id: number; tenantId: number; productId: number; type: string; quantity: string; notes: string | null; referenceType?: string | null; referenceId?: number | null; createdAt: Date; }
interface FakeShop { id: number; tenantId: number; name: string; city: string | null; district: string | null; agentId: number | null; debt: string; status: string; ownerName: string | null; phone: string | null; address: string | null; photoUrl: string | null; gpsLat: string | null; gpsLng: string | null; notes: string | null; createdAt: Date; updatedAt: Date; }
interface FakeUser { id: number; tenantId: number; name: string; email: string; role: string; }
interface FakePayment { id: number; tenantId: number; shopId: number; amount: string; type: string; notes: string | null; createdBy: number; createdAt: Date; }

let ordersTable: FakeOrder[] = [];
let orderItemsTable: FakeOrderItem[] = [];
let stockTable: FakeStock[] = [];
let productsTable: FakeProduct[] = [];
let movementsTable: FakeMovement[] = [];
let shopsTable: FakeShop[] = [];
let usersTable: FakeUser[] = [];
let paymentsTable: FakePayment[] = [];
let warehousesTable: { id: number; tenantId: number; name: string; isDefault: boolean; status: string }[] = [];
let nextOrderId = 1;
let nextItemId = 1;
let nextMovementId = 1;
let nextPaymentId = 1;

function resetTables() {
  ordersTable = [];
  orderItemsTable = [];
  stockTable = [
    { id: 1, productId: 1, tenantId: 1, warehouseId: 1, currentStock: "100.00", reserved: "0.00", available: "100.00", updatedAt: new Date() },
    { id: 2, productId: 2, tenantId: 1, warehouseId: 1, currentStock: "50.00", reserved: "0.00", available: "50.00", updatedAt: new Date() },
  ];
  productsTable = [
    { id: 1, tenantId: 1, name: "Widget A", code: "WA-001", unitPrice: "100.00", costPrice: "50.00", reorderPoint: "20.00", category: "Widgets", unit: "pcs", status: "active" },
    { id: 2, tenantId: 1, name: "Widget B", code: "WB-002", unitPrice: "50.00", costPrice: "25.00", reorderPoint: "10.00", category: "Widgets", unit: "pcs", status: "active" },
  ];
  movementsTable = [];
  shopsTable = [
    { id: 1, tenantId: 1, name: "Shop Alpha", city: "Tashkent", district: "Centr", agentId: 10, debt: "500.00", status: "active", ownerName: "Owner1", phone: "+998901234567", address: "Addr1", photoUrl: null, gpsLat: null, gpsLng: null, notes: null, createdAt: new Date(), updatedAt: new Date() },
  ];
  usersTable = [
    { id: 10, tenantId: 1, name: "Agent One", email: "a1@test.com", role: "agent" },
    { id: 1, tenantId: 1, name: "Operator", email: "op@test.com", role: "operator" },
    { id: 20, tenantId: 2, name: "Agent T2", email: "a1@t2.com", role: "agent" },
  ];
  paymentsTable = [];
  warehousesTable = [
    { id: 1, tenantId: 1, name: "Main", isDefault: true, status: "active" },
  ];
  nextOrderId = 1;
  nextItemId = 1;
  nextMovementId = 1;
  nextPaymentId = 1;
}

function tableOf(ref: unknown): string {
  if (ref === orders) return "orders";
  if (ref === orderItems) return "orderItems";
  if (ref === warehouseStock) return "warehouseStock";
  if (ref === products) return "products";
  if (ref === stockMovements) return "stockMovements";
  if (ref === shops) return "shops";
  if (ref === users) return "users";
  if (ref === payments) return "payments";
  if (ref === settings) return "settings";
  if (ref === warehouses) return "warehouses";
  return "other";
}

function rowsFor(table: string): unknown[] {
  const map: Record<string, unknown[]> = {
    orders: ordersTable, orderItems: orderItemsTable, warehouseStock: stockTable,
    products: productsTable, stockMovements: movementsTable, shops: shopsTable,
    users: usersTable, payments: paymentsTable, warehouses: warehousesTable,
  };
  return map[table] ?? [];
}

const columnToFieldName = new Map<unknown, string>();
for (const [f, c] of Object.entries(orders)) columnToFieldName.set(c, f);
for (const [f, c] of Object.entries(orderItems)) columnToFieldName.set(c, f);
for (const [f, c] of Object.entries(warehouseStock)) columnToFieldName.set(c, f);
for (const [f, c] of Object.entries(products)) columnToFieldName.set(c, f);
for (const [f, c] of Object.entries(stockMovements)) columnToFieldName.set(c, f);
for (const [f, c] of Object.entries(shops)) columnToFieldName.set(c, f);
for (const [f, c] of Object.entries(users)) columnToFieldName.set(c, f);
for (const [f, c] of Object.entries(payments)) columnToFieldName.set(c, f);
for (const [f, c] of Object.entries(warehouses)) columnToFieldName.set(c, f);

function evalCond(row: unknown, cond: unknown): boolean {
  if (!cond || typeof cond !== "object") return true;
  const c = cond as Record<string, unknown>;
  if (c.__kind === "and") return (c.conds as unknown[]).every((inner: unknown) => evalCond(row, inner));
  if (c.__kind === "eq") {
    const fnL = columnToFieldName.get(c.col) ?? (c.col as Record<string, unknown>)?.name ?? c.col;
    const fnR = columnToFieldName.get(c.val) ?? (c.val as Record<string, unknown>)?.name ?? c.val;
    const r = row as Record<string, unknown>;
    const left = r[fnL as string];
    const right = typeof c.val === "object" && c.val !== null && columnToFieldName.has(c.val) ? r[fnR as string] : c.val;
    return left === right || String(left) === String(right);
  }
  if (c.__kind === "like") {
    const fn = columnToFieldName.get(c.col) ?? (c.col as Record<string, unknown>)?.name ?? c.col;
    const r = row as Record<string, unknown>;
    const val = r[fn as string] ?? "";
    const pattern = String(c.val).replace(/^%/, ".*").replace(/%$/, "");
    return new RegExp(pattern, "i").test(String(val));
  }
  return true;
}

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
  function selectBuilder(proj?: unknown) {
    let currentTable = "other";
    const isCount = proj && typeof proj === "object" && !Array.isArray(proj) && (proj as Record<string, unknown>).count && ((proj as Record<string, unknown>).count as Record<string, unknown>).__kind === "sql";
    const api: unknown = {
      from(ref: unknown) { currentTable = tableOf(ref); return api; },
      leftJoin() { return api; },
      where(cond: unknown) {
        const filtered = rowsFor(currentTable).filter((r) => evalCond(r, cond));
        if (isCount) return Promise.resolve([{ count: filtered.length }]);
        const wrap = (arr: unknown[]): any => Object.assign(Promise.resolve(arr), {
          limit: (n: number) => wrap(arr.slice(0, n)),
          offset: (n: number) => wrap(arr.slice(n)),
          orderBy: () => wrap(arr),
          for: () => wrap(arr),
        });
        return wrap(filtered);
      },
      limit(n: number) {
        const all = rowsFor(currentTable).slice(0, n);
        const wrap = (arr: unknown[]): any => Object.assign(Promise.resolve(arr), {
          limit: (n2: number) => wrap(arr.slice(0, n2)),
          offset: (n2: number) => wrap(arr.slice(n2)),
          orderBy: () => wrap(arr),
        });
        return wrap(all);
      },
      offset(n: number) {
        const all = rowsFor(currentTable).slice(n);
        const wrap = (arr: unknown[]): any => Object.assign(Promise.resolve(arr), {
          limit: (n2: number) => wrap(arr.slice(0, n2)),
          offset: (n2: number) => wrap(arr.slice(n2)),
          orderBy: () => wrap(arr),
        });
        return wrap(all);
      },
      orderBy() {
        const filtered = rowsFor(currentTable);
        const wrap = (arr: unknown[]): any => Object.assign(Promise.resolve(arr), {
          limit: (n: number) => wrap(arr.slice(0, n)),
          offset: (n: number) => wrap(arr.slice(n)),
          orderBy: () => wrap(arr),
        });
        return wrap(filtered);
      },
    };
    return api;
  }

  function updateBuilder(table: string) {
    return {
      set(patch: Record<string, unknown>) {
        return {
          where(cond: unknown) {
            for (const row of rowsFor(table)) {
              if (!evalCond(row, cond)) continue;
              const r = row as Record<string, unknown>;
              for (const [key, val] of Object.entries(patch)) {
                if (val && typeof val === "object" && (val as Record<string, unknown>).__kind === "sql") {
                  r[key] = evalSqlDelta(row, key, val);
                } else if (val !== undefined) {
                  r[key] = val;
                }
              }
            }
            return Promise.resolve();
          },
        };
      },
    };
  }

  const db: any = {
    select: (proj?: unknown) => selectBuilder(proj),
    insert: (ref: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const v = vals;
        const table = tableOf(ref);
        if (table === "orders") {
          const id = nextOrderId++;
          ordersTable.push({
            id, tenantId: v.tenantId as number, agentId: v.agentId as number, shopId: v.shopId as number,
            status: (v.status as string) ?? "new", orderNumber: (v.orderNumber as string) ?? `ORD-${id}`,
            subtotal: String(v.subtotal ?? "0.00"), discount: String(v.discount ?? "0.00"),
            total: String(v.total ?? "0.00"), notes: (v.notes as string) ?? null,
            createdAt: new Date(), updatedAt: new Date(),
          });
          return Promise.resolve([{ insertId: id }]);
        }
        if (table === "orderItems") {
          const list = Array.isArray(vals) ? vals : [vals];
          for (const v of list) {
            orderItemsTable.push({
              id: nextItemId++, orderId: v.orderId as number, productId: v.productId as number,
              quantity: String(v.quantity), unitPrice: String(v.unitPrice),
              subtotal: String(v.subtotal ?? Number(v.unitPrice) * Number(v.quantity)),
              createdAt: new Date(),
            });
          }
          return Promise.resolve([{ insertId: nextItemId }]);
        }
        if (table === "stockMovements") {
          const id = nextMovementId++;
          movementsTable.push({
            id, tenantId: v.tenantId as number, productId: v.productId as number, type: v.type as string,
            quantity: String(v.quantity), notes: (v.notes as string) ?? null, createdAt: new Date(),
          });
          return Promise.resolve([{ insertId: id }]);
        }
        if (table === "payments") {
          const id = nextPaymentId++;
          paymentsTable.push({
            id, tenantId: v.tenantId as number, shopId: v.shopId as number,
            amount: String(v.amount), type: (v.type as string) ?? "payment",
            notes: (v.notes as string) ?? null, createdBy: (v.createdBy as number) ?? 0, createdAt: new Date(),
          });
          return Promise.resolve([{ insertId: id }]);
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
      if (!fullSql.includes("UPDATE warehouse_stock")) return Promise.resolve();

      const updates: Array<{ productId: number; field: string; op: string; amount: number }> = [];
      const isCreatePattern = fullSql.includes("reserved = reserved +") || fullSql.includes("available = available -");
      const isCompletePattern = fullSql.includes("current_stock = CASE") && !fullSql.includes("reserved = reserved +");

      let caseIndex = 0;
      for (const val of s.values) {
        if (!val || typeof val !== "object") continue;
        const obj = val as Record<string, unknown>;
        if (obj.__kind === "sql_join" && Array.isArray(obj.chunks)) {
          if (caseIndex < 2) {
            let field = isCompletePattern ? (caseIndex === 0 ? "currentStock" : "reserved") : (caseIndex === 0 ? "reserved" : "available");
            let op = isCreatePattern ? (caseIndex === 0 ? "+" : "-") : (isCompletePattern ? "-" : (caseIndex === 0 ? "-" : "+"));
            for (const chunk of obj.chunks) {
              if (!chunk || typeof chunk !== "object") continue;
              const c = chunk as { __kind: string; strings: string[]; values: unknown[] };
              if (c.__kind !== "sql") continue;
              updates.push({ productId: Number(c.values[0]), field, op, amount: Number(c.values[1]) });
            }
          }
          caseIndex++;
        }
      }

      const tenantId = s.values.filter(v => typeof v !== "object" || v === null).pop();
      for (const u of updates) {
        for (const row of stockTable) {
          if (String(row.productId) === String(u.productId) && String(row.tenantId) === String(tenantId) && u.field) {
            const cur = Number((row as unknown as Record<string, string>)[u.field]);
            (row as unknown as Record<string, string>)[u.field] = (u.op === "+" ? cur + u.amount : cur - u.amount).toFixed(2);
          }
        }
      }
      return Promise.resolve();
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
    user: { id: userId, tenantId, role, status: "active" as const, name: "Test", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test", name: "Test Co", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    db: mockDb,
  };
}

beforeEach(() => {
  resetTables();
  mockDb = makeMockDb();
});

describe("integration: complete order lifecycle", () => {
  it("create -> process -> complete flows through correctly", async () => {
    const { orderRouter } = await import("../order-router");
    const agentCaller = orderRouter.createCaller({ ...makeCtx(1, 10, "agent"), db: mockDb });
    const opCaller = orderRouter.createCaller({ ...makeCtx(1, 1, "operator"), db: mockDb });

    const created = await agentCaller.create({
      shopId: 1,
      items: [
        { productId: 1, quantity: 10, unitPrice: 100 },
        { productId: 2, quantity: 5, unitPrice: 50 },
      ],
    });

    expect(created.id).toBe(1);
    expect(stockTable.find(s => s.productId === 1)!.reserved).toBe("10.00");
    expect(stockTable.find(s => s.productId === 1)!.available).toBe("90.00");
    expect(stockTable.find(s => s.productId === 2)!.reserved).toBe("5.00");
    expect(stockTable.find(s => s.productId === 2)!.available).toBe("45.00");

    await opCaller.updateStatus({ id: 1, status: "processing" });
    expect(ordersTable[0].status).toBe("processing");
    expect(stockTable.find(s => s.productId === 1)!.reserved).toBe("10.00");

    await opCaller.updateStatus({ id: 1, status: "completed" });
    expect(ordersTable[0].status).toBe("completed");
    expect(stockTable.find(s => s.productId === 1)!.currentStock).toBe("90.00");
    expect(stockTable.find(s => s.productId === 1)!.reserved).toBe("0.00");
    expect(stockTable.find(s => s.productId === 1)!.available).toBe("90.00");
    expect(stockTable.find(s => s.productId === 2)!.currentStock).toBe("45.00");
    expect(stockTable.find(s => s.productId === 2)!.reserved).toBe("0.00");

    const order = await agentCaller.getById({ id: 1 });
    expect(order).not.toBeNull();
    expect(order!.status).toBe("completed");
    expect(order!.items).toHaveLength(2);
  });
});

describe("integration: order create then cancel", () => {
  it("cancelling returns all reserved stock", async () => {
    const { orderRouter } = await import("../order-router");
    const agentCaller = orderRouter.createCaller({ ...makeCtx(1, 10, "agent"), db: mockDb });

    await agentCaller.create({
      shopId: 1,
      items: [
        { productId: 1, quantity: 20, unitPrice: 100 },
        { productId: 2, quantity: 10, unitPrice: 50 },
      ],
    });

    expect(stockTable.find(s => s.productId === 1)!.available).toBe("80.00");
    expect(stockTable.find(s => s.productId === 2)!.available).toBe("40.00");

    await agentCaller.cancel({ id: 1 });

    expect(ordersTable[0].status).toBe("cancelled");
    expect(stockTable.find(s => s.productId === 1)!.reserved).toBe("0.00");
    expect(stockTable.find(s => s.productId === 1)!.available).toBe("100.00");
    expect(stockTable.find(s => s.productId === 2)!.reserved).toBe("0.00");
    expect(stockTable.find(s => s.productId === 2)!.available).toBe("50.00");
  });
});

describe("integration: payment flow", () => {
  it("add payment reduces shop debt, add debt increases it", async () => {
    const { shopRouter } = await import("../shop-router");
    const caller = shopRouter.createCaller({ ...makeCtx(1, 1, "operator"), db: mockDb });

    expect(shopsTable.find(s => s.id === 1)!.debt).toBe("500.00");

    await caller.addPayment({ shopId: 1, amount: "200.00", type: "payment" });
    expect(shopsTable.find(s => s.id === 1)!.debt).toBe("300");
    expect(paymentsTable).toHaveLength(1);
    expect(paymentsTable[0].amount).toBe("200.00");
    expect(paymentsTable[0].type).toBe("payment");

    await caller.addPayment({ shopId: 1, amount: "100.00", type: "debt" });
    expect(shopsTable.find(s => s.id === 1)!.debt).toBe("400.00");
    expect(paymentsTable).toHaveLength(2);
    expect(paymentsTable[1].type).toBe("debt");
  });
});

describe("integration: stock adjustment flow", () => {
  it("adjust stock in creates movement and updates stock levels", async () => {
    const { warehouseRouter } = await import("../warehouse-router");
    const caller = warehouseRouter.createCaller(makeCtx(1, 1, "operator"));

    expect(stockTable.find(s => s.productId === 1)!.currentStock).toBe("100.00");

    await caller.adjustStock({ productId: 1, quantity: "50", type: "in", notes: "Restock" });

    expect(stockTable.find(s => s.productId === 1)!.currentStock).toBe("150.00");
    expect(stockTable.find(s => s.productId === 1)!.available).toBe("150.00");
    expect(movementsTable).toHaveLength(1);
    expect(movementsTable[0].type).toBe("in");
    expect(movementsTable[0].quantity).toBe("50");
    expect(movementsTable[0].notes).toBe("Restock");

    await caller.adjustStock({ productId: 1, quantity: "30", type: "out" });

    expect(stockTable.find(s => s.productId === 1)!.currentStock).toBe("120.00");
    expect(stockTable.find(s => s.productId === 1)!.available).toBe("120.00");
    expect(movementsTable).toHaveLength(2);
    expect(movementsTable[1].type).toBe("out");
  });
});

describe("integration: multi-tenant isolation", () => {
  it("tenant 1 operations cannot see tenant 2 data", async () => {
    const { orderRouter } = await import("../order-router");
    const t1Caller = orderRouter.createCaller({ ...makeCtx(1, 10, "agent"), db: mockDb });
    const t2Caller = orderRouter.createCaller({ ...makeCtx(2, 20, "agent"), db: mockDb });

    await t1Caller.create({ shopId: 1, items: [{ productId: 1, quantity: 5, unitPrice: 100 }] });

    const t1Orders = await t1Caller.list();
    const t2Orders = await t2Caller.list();

    expect(t1Orders.data).toHaveLength(1);
    expect(t2Orders.data).toHaveLength(0);
  });

  it("tenant 2 cannot access tenant 1 order by ID", async () => {
    const { orderRouter } = await import("../order-router");
    const t1Caller = orderRouter.createCaller({ ...makeCtx(1, 10, "agent"), db: mockDb });
    const t2Caller = orderRouter.createCaller({ ...makeCtx(2, 20, "agent"), db: mockDb });

    await t1Caller.create({ shopId: 1, items: [{ productId: 1, quantity: 5, unitPrice: 100 }] });

    const t1Order = await t1Caller.getById({ id: 1 });
    const t2Order = await t2Caller.getById({ id: 1 });

    expect(t1Order).not.toBeNull();
    expect(t2Order).toBeNull();
  });

  it("stock adjustment is scoped to tenant", async () => {
    const { warehouseRouter } = await import("../warehouse-router");
    const t1Caller = warehouseRouter.createCaller(makeCtx(1, 1, "operator"));

    await t1Caller.adjustStock({ productId: 1, quantity: "25", type: "in" });

    expect(stockTable.find(s => s.productId === 1)!.currentStock).toBe("125.00");
    expect(movementsTable[0].tenantId).toBe(1);
  });
});
