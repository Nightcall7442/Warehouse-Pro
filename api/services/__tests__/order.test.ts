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
    sql: sqlFn,
  };
});

import { orders, orderItems, warehouseStock, shops, users } from "@db/schema";

type FakeOrder = {
  id: number; tenantId: number; orderNumber: string; shopId: number;
  agentId: number; status: string; subtotal: string; discount: string;
  total: string; notes?: string; createdAt: Date;
};
type FakeOrderItem = {
  id: number; orderId: number; productId: number; quantity: string;
  unitPrice: string; subtotal: string; createdAt: Date;
};
type FakeStock = {
  productId: number; tenantId: number; currentStock: string;
  reserved: string; available: string;
};
type FakeShop = { id: number; tenantId: number; name: string };
type FakeUser = { id: number; tenantId: number; name: string };

let ordersTable: FakeOrder[] = [];
let orderItemsTable: FakeOrderItem[] = [];
let stockTable: FakeStock[] = [];
let shopsTable: FakeShop[] = [];
let usersTable: FakeUser[] = [];
let nextOrderId = 1;
let nextItemId = 1;

function resetTables() {
  ordersTable = [];
  orderItemsTable = [];
  stockTable = [
    { productId: 1, tenantId: 1, currentStock: "100.00", reserved: "0.00", available: "100.00" },
    { productId: 2, tenantId: 1, currentStock: "50.00", reserved: "0.00", available: "50.00" },
  ];
  shopsTable = [{ id: 1, tenantId: 1, name: "Shop Alpha" }];
  usersTable = [{ id: 10, tenantId: 1, name: "Agent One" }];
  nextOrderId = 1;
  nextItemId = 1;
}

function tableOf(ref: unknown): string {
  if (ref === orders) return "orders";
  if (ref === orderItems) return "orderItems";
  if (ref === warehouseStock) return "warehouseStock";
  if (ref === shops) return "shops";
  if (ref === users) return "users";
  return "other";
}

function rowsFor(table: string): unknown[] {
  const map: Record<string, unknown[]> = {
    orders: ordersTable, orderItems: orderItemsTable,
    warehouseStock: stockTable, shops: shopsTable, users: usersTable,
  };
  return map[table] ?? [];
}

const colToField = new Map<unknown, string>();
for (const [field, col] of Object.entries(orders)) colToField.set(col, field);
for (const [field, col] of Object.entries(orderItems)) colToField.set(col, field);
for (const [field, col] of Object.entries(warehouseStock)) colToField.set(col, field);
for (const [field, col] of Object.entries(shops)) colToField.set(col, field);
for (const [field, col] of Object.entries(users)) colToField.set(col, field);

function evalCond(row: unknown, cond: unknown): boolean {
  if (!cond || typeof cond !== "object") return true;
  const c = cond as Record<string, unknown>;
  if (c.__kind === "and") return (c.conds as unknown[]).every((child: unknown) => evalCond(row, child));
  if (c.__kind === "eq") {
    const col = c.col as { name?: string } | string;
    const val = c.val as { name?: string } | string | number;
    const fnL = (typeof col === "object" && col !== null ? (colToField.get(col) ?? col.name ?? col) : colToField.get(col) ?? (typeof col === "string" ? col : "")) as string;
    const fnR = (typeof val === "object" && val !== null ? (colToField.get(val) ?? val.name ?? val) : colToField.get(val) ?? (typeof val === "string" ? val : "")) as string;
    const r = row as Record<string, unknown>;
    const left = r[fnL];
    const right = typeof val === "object" && val !== null && colToField.has(val) ? r[fnR] : val;
    return left === right || String(left) === String(right);
  }
  return true;
}

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
            for (const row of rowsFor(table)) {
              if (!evalCond(row, cond)) continue;
              const r = row as Record<string, unknown>;
              for (const [key, val] of Object.entries(patch)) {
                r[key] = val && typeof val === "object" && (val as Record<string, unknown>).__kind === "sql"
                  ? evalSqlDelta(row, key, val)
                  : val;
              }
            }
            return Promise.resolve();
          },
        };
      },
    };
  }

  const db = {
    select: (proj?: unknown) => selectBuilder(proj),
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
            notes: v.notes as string | undefined, createdAt: new Date(),
          });
          return Promise.resolve([{ insertId: id }]);
        }
        if (table === "orderItems") {
          const list = Array.isArray(vals) ? (vals as Record<string, unknown>[]) : [vals as Record<string, unknown>];
          for (const v of list) {
            orderItemsTable.push({
              id: nextItemId++, orderId: v.orderId as number, productId: v.productId as number,
              quantity: String(v.quantity), unitPrice: String(v.unitPrice),
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
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

beforeEach(() => {
  resetTables();
  mockDb = makeMockDb();
});

import { OrderService } from "../order";

describe("OrderService.create", () => {
  it("reserves stock and creates order atomically", async () => {
    const result = await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "20", unitPrice: "100" }],
    });

    expect(result.id).toBe(1);
    expect(result.orderNumber).toMatch(/^ORD-/);
    expect(ordersTable).toHaveLength(1);
    expect(orderItemsTable).toHaveLength(1);

    const stock = stockTable.find((s) => s.productId === 1)!;
    expect(stock.reserved).toBe("20.00");
    expect(stock.available).toBe("80.00");
  });

  it("rejects when stock is insufficient", async () => {
    await expect(
      OrderService.create(mockDb as any, 1, 10, {
        shopId: 1, items: [{ productId: 1, quantity: "200", unitPrice: "50" }],
      }),
    ).rejects.toThrow(/Недостаточно товара/);

    expect(ordersTable).toHaveLength(0);
    expect(stockTable.find((s) => s.productId === 1)!.reserved).toBe("0.00");
  });

  it("creates order with multiple items", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1,
      items: [
        { productId: 1, quantity: "5", unitPrice: "100" },
        { productId: 2, quantity: "3", unitPrice: "200" },
      ],
    });

    expect(ordersTable).toHaveLength(1);
    expect(orderItemsTable).toHaveLength(2);
    expect(stockTable.find((s) => s.productId === 1)!.reserved).toBe("5.00");
    expect(stockTable.find((s) => s.productId === 2)!.reserved).toBe("3.00");
  });

  it("calculates total with discount", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1,
      items: [{ productId: 1, quantity: "10", unitPrice: "100" }],
      discount: "50",
    });

    const order = ordersTable[0];
    expect(order.subtotal).toBe("1000.00");
    expect(order.discount).toBe("50.00");
    expect(order.total).toBe("950.00");
  });
});

describe("OrderService.cancel", () => {
  it("restores stock and marks order cancelled", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "15", unitPrice: "100" }],
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
      shopId: 1, items: [{ productId: 1, quantity: "5", unitPrice: "100" }],
    });
    await OrderService.cancel(mockDb as any, 1, 1, { userId: 10, userRole: "agent" });

    await expect(
      OrderService.cancel(mockDb as any, 1, 1, { userId: 10, userRole: "agent" }),
    ).rejects.toThrow(/Можно отменить только новые заказы/);
  });

  it("agent cannot cancel another agent's order", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "5", unitPrice: "100" }],
    });

    await expect(
      OrderService.cancel(mockDb as any, 1, 1, { userId: 99, userRole: "agent" }),
    ).rejects.toThrow(/Заказ не найден/);
  });
});

describe("OrderService.updateStatus", () => {
  it("transitions new -> processing", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "10", unitPrice: "100" }],
    });

    await OrderService.updateStatus(mockDb as any, 1, 1, "processing");
    expect(ordersTable[0].status).toBe("processing");
  });

  it("transitions new -> completed and deducts stock", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "10", unitPrice: "100" }],
    });

    await OrderService.updateStatus(mockDb as any, 1, 1, "completed");

    const stock = stockTable.find((s) => s.productId === 1)!;
    expect(stock.currentStock).toBe("90.00");
    expect(stock.reserved).toBe("0.00");
    expect(ordersTable[0].status).toBe("completed");
  });

  it("transitions new -> cancelled and restores available stock", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "10", unitPrice: "100" }],
    });

    await OrderService.updateStatus(mockDb as any, 1, 1, "cancelled");

    const stock = stockTable.find((s) => s.productId === 1)!;
    expect(stock.available).toBe("100.00");
    expect(stock.reserved).toBe("0.00");
  });

  it("throws on invalid transition", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "10", unitPrice: "100" }],
    });

    await expect(OrderService.updateStatus(mockDb as any, 1, 1, "new")).rejects.toThrow(/Невозможно перевести/);
  });

  it("throws when order not found", async () => {
    await expect(OrderService.updateStatus(mockDb as any, 1, 999, "completed")).rejects.toThrow(/Заказ не найден/);
  });

  it("rejects transition from completed", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "10", unitPrice: "100" }],
    });
    await OrderService.updateStatus(mockDb as any, 1, 1, "completed");

    await expect(OrderService.updateStatus(mockDb as any, 1, 1, "cancelled")).rejects.toThrow(/Невозможно перевести/);
  });
});

describe("OrderService.delete", () => {
  it("restores stock for new orders and removes order", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "25", unitPrice: "100" }],
    });

    await OrderService.delete(mockDb as any, 1, 1);

    const stock = stockTable.find((s) => s.productId === 1)!;
    expect(stock.reserved).toBe("0.00");
    expect(stock.available).toBe("100.00");
    expect(ordersTable).toHaveLength(0);
    expect(orderItemsTable).toHaveLength(0);
  });

  it("restores stock for processing orders", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "10", unitPrice: "100" }],
    });
    await OrderService.updateStatus(mockDb as any, 1, 1, "processing");

    await OrderService.delete(mockDb as any, 1, 1);

    const stock = stockTable.find((s) => s.productId === 1)!;
    expect(stock.reserved).toBe("0.00");
    expect(stock.available).toBe("100.00");
  });

  it("does not restore stock for completed orders", async () => {
    await OrderService.create(mockDb as any, 1, 10, {
      shopId: 1, items: [{ productId: 1, quantity: "10", unitPrice: "100" }],
    });
    await OrderService.updateStatus(mockDb as any, 1, 1, "completed");

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
      shopId: 1, items: [{ productId: 1, quantity: "5", unitPrice: "100" }],
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
      shopId: 1, items: [{ productId: 1, quantity: "5", unitPrice: "100" }],
    });
    await OrderService.updateStatus(mockDb as any, 1, 1, "processing");

    const result = await OrderService.list(mockDb as any, 1, { status: "processing" }, { userId: 10, userRole: "agent" });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].status).toBe("processing");

    const empty = await OrderService.list(mockDb as any, 1, { status: "completed" }, { userId: 10, userRole: "agent" });
    expect(empty.data).toHaveLength(0);
  });

  it("returns empty for tenant with no orders", async () => {
    const result = await OrderService.list(mockDb as any, 999, {}, { userId: 10, userRole: "agent" });
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});
