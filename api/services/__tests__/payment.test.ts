import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
  and: (...conds: unknown[]) => ({ __kind: "and", conds }),
  desc: (col: unknown) => ({ __kind: "desc", col }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values }),
}));

vi.mock("../lib/sanitize", () => ({
  sanitizeString: (s: string) => s.replace(/<[^>]*>/g, "").trim(),
}));

import { payments, shops } from "@db/schema";

type FakePayment = {
  id: number; tenantId: number; shopId: number; amount: string;
  type: string; notes?: string; createdBy: number; createdAt: Date;
};
type FakeShop = { id: number; tenantId: number; name: string; debt: string };

let paymentsTable: FakePayment[] = [];
let shopsTable: FakeShop[] = [];
let nextPaymentId = 1;

function resetTables() {
  paymentsTable = [];
  shopsTable = [
    { id: 1, tenantId: 1, name: "Test Shop", debt: "500.00" },
    { id: 2, tenantId: 1, name: "Another Shop", debt: "0.00" },
  ];
  nextPaymentId = 1;
}

function tableOf(ref: unknown): string {
  if (ref === payments) return "payments";
  if (ref === shops) return "shops";
  return "other";
}

function rowsFor(table: string): unknown[] {
  const map: Record<string, unknown[]> = { payments: paymentsTable, shops: shopsTable };
  return map[table] ?? [];
}

const colToField = new Map<unknown, string>();
for (const [f, c] of Object.entries(payments)) colToField.set(c, f);
for (const [f, c] of Object.entries(shops)) colToField.set(c, f);

function evalCond(row: unknown, cond: unknown): boolean {
  if (!cond || typeof cond !== "object") return true;
  const c = cond as Record<string, unknown>;
  if (c.__kind === "and") return (c.conds as unknown[]).every((child: unknown) => evalCond(row, child));
  if (c.__kind === "eq") {
    const col = c.col as { name?: string } | string;
    const val = c.val as { name?: string } | string | number;
    const fn = (typeof col === "object" && col !== null ? (colToField.get(col) ?? col.name ?? col) : colToField.get(col) ?? (typeof col === "string" ? col : "")) as string;
    const r = row as Record<string, unknown>;
    return r[fn] === val || String(r[fn]) === String(val);
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
  const selectBuilder = () => {
    let tbl = "";
    const api: Record<string, unknown> = {
      from(ref: unknown) { tbl = tableOf(ref); return api; },
      where(cond: unknown) {
        const filtered = rowsFor(tbl).filter((r) => evalCond(r, cond));
        return Object.assign(Promise.resolve(filtered), {
          orderBy: () => Object.assign(Promise.resolve(filtered), {
            limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
          }),
          limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
        });
      },
      limit(n: number) { return Promise.resolve(rowsFor(tbl).slice(0, n)); },
    };
    return api;
  };

  const updateBuilder = (tbl: string) => ({
    set(patch: Record<string, unknown>) {
      return {
        where(cond: unknown) {
          for (const row of rowsFor(tbl)) {
            if (!evalCond(row, cond)) continue;
            const r = row as Record<string, unknown>;
            for (const [key, val] of Object.entries(patch)) {
              r[key] = val && typeof val === "object" && (val as Record<string, unknown>).__kind === "sql"
                ? evalSqlDelta(row, key, val) : val;
            }
          }
          return Promise.resolve();
        },
      };
    },
  });

  const db = {
    select: () => selectBuilder(),
    insert: (ref: unknown) => ({
      values: (vals: unknown) => {
        const tbl = tableOf(ref);
        if (tbl === "payments") {
          const list = Array.isArray(vals) ? (vals as Record<string, unknown>[]) : [vals as Record<string, unknown>];
          for (const v of list) {
            paymentsTable.push({
              id: nextPaymentId++, tenantId: v.tenantId as number, shopId: v.shopId as number,
              amount: String(v.amount), type: v.type as string, notes: v.notes as string | undefined,
              createdBy: v.createdBy as number, createdAt: new Date(),
            });
          }
          return Promise.resolve([{ insertId: nextPaymentId }]);
        }
        return Promise.resolve([{ insertId: 1 }]);
      },
    }),
    update: (ref: unknown) => updateBuilder(tableOf(ref)),
    delete: () => ({
      where: () => Promise.resolve(),
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

import { PaymentService } from "../payment";

describe("PaymentService.addPayment", () => {
  it("creates payment record and reduces shop debt for payment type", async () => {
    const result = await PaymentService.addPayment(mockDb as any, 1, {
      shopId: 1, amount: "200.00", type: "payment", createdBy: 10,
    });

    expect(result.success).toBe(true);
    expect(paymentsTable).toHaveLength(1);
    expect(paymentsTable[0].amount).toBe("200.00");
    expect(paymentsTable[0].type).toBe("payment");

    const shop = shopsTable.find((s) => s.id === 1)!;
    expect(shop.debt).toBe("300.00");
  });

  it("creates payment record and increases shop debt for debt type", async () => {
    await PaymentService.addPayment(mockDb as any, 1, {
      shopId: 1, amount: "100.00", type: "debt", createdBy: 10,
    });

    expect(paymentsTable).toHaveLength(1);
    expect(paymentsTable[0].type).toBe("debt");

    const shop = shopsTable.find((s) => s.id === 1)!;
    expect(shop.debt).toBe("600.00");
  });

  it("defaults to payment type when type is not specified", async () => {
    await PaymentService.addPayment(mockDb as any, 1, {
      shopId: 1, amount: "50.00", createdBy: 10,
    });

    expect(paymentsTable[0].type).toBe("payment");
    const shop = shopsTable.find((s) => s.id === 1)!;
    expect(shop.debt).toBe("450.00");
  });

  it("sanitizes notes input", async () => {
    await PaymentService.addPayment(mockDb as any, 1, {
      shopId: 1, amount: "10.00", notes: "<script>alert('xss')</script>Cash payment", createdBy: 10,
    });

    expect(paymentsTable[0].notes).toBe("alert('xss')Cash payment");
  });

  it("records the createdBy user", async () => {
    await PaymentService.addPayment(mockDb as any, 1, {
      shopId: 1, amount: "100.00", createdBy: 42,
    });

    expect(paymentsTable[0].createdBy).toBe(42);
  });

  it("records the tenantId", async () => {
    await PaymentService.addPayment(mockDb as any, 1, {
      shopId: 1, amount: "100.00", createdBy: 10,
    });

    expect(paymentsTable[0].tenantId).toBe(1);
  });
});

describe("PaymentService.getPaymentHistory", () => {
  it("returns payments for the given shop ordered by createdAt desc", async () => {
    await PaymentService.addPayment(mockDb as any, 1, { shopId: 1, amount: "100.00", createdBy: 10 });
    await PaymentService.addPayment(mockDb as any, 1, { shopId: 1, amount: "200.00", createdBy: 10 });
    await PaymentService.addPayment(mockDb as any, 1, { shopId: 2, amount: "50.00", createdBy: 10 });

    const history = await PaymentService.getPaymentHistory(mockDb as any, 1, 1);
    expect(history).toHaveLength(2);
    expect(history.every((p: unknown) => (p as FakePayment).shopId === 1)).toBe(true);
  });

  it("returns empty array for shop with no payments", async () => {
    const history = await PaymentService.getPaymentHistory(mockDb as any, 1, 999);
    expect(history).toHaveLength(0);
  });

  it("returns empty array for wrong tenant", async () => {
    await PaymentService.addPayment(mockDb as any, 1, { shopId: 1, amount: "100.00", createdBy: 10 });

    const history = await PaymentService.getPaymentHistory(mockDb as any, 2, 1);
    expect(history).toHaveLength(0);
  });

  it("limits results to 20", async () => {
    for (let i = 0; i < 25; i++) {
      await PaymentService.addPayment(mockDb as any, 1, { shopId: 1, amount: "10.00", createdBy: 10 });
    }

    const history = await PaymentService.getPaymentHistory(mockDb as any, 1, 1);
    expect(history.length).toBeLessThanOrEqual(20);
  });
});
