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
    eq:   (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
    and:  (...conds: unknown[]) => ({ __kind: "and", conds }),
    like: (col: unknown, val: unknown) => ({ __kind: "like", col, val }),
    desc: (col: unknown) => ({ __kind: "desc", col }),
    sql: sqlFn,
  };
});

vi.mock("../lib/sanitize", () => ({
  sanitizeString: (s: string) => s.replace(/<[^>]*>/g, "").trim(),
  sanitizeSearch: (s: string) => s.replace(/[%_]/g, ""),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { suppliers, supplies, supplierPayments } from "@db/schema";
import { makeConditionEvaluator } from "./helpers/fake-conditions";

/**
 * Стенд под api/supplier-router.ts.
 *
 * Долг здесь не хранится полем — router.ts сам вычисляет его подзапросом
 * (сумма поставки минус сумма платежей). Разобрать произвольный sql`` стенд
 * не может, поэтому три подзапроса router.ts (`paid` у одной поставки,
 * `debtUzs`/`debtUsd`/`suppliesCount` у списка поставщиков) считаются здесь
 * напрямую по фейковым таблицам, по имени алиаса в проекции — не через общий
 * разбор SQL, а по тому же принципу, каким сам router.ts эти подзапросы
 * задумал.
 */

interface FakeSupplier { id: number; tenantId: number; name: string; contactName: string | null; phone: string | null; inn: string | null; address: string | null; notes: string | null; status: string; }
interface FakeSupply { id: number; tenantId: number; supplierId: number; arrivalId: number | null; supplyNumber: string; amount: string; currency: string; rateToUzs: string | null; supplyDate: Date; dueDate: Date | null; notes: string | null; createdBy: number | null; }
interface FakePayment { id: number; tenantId: number; supplierId: number; supplyId: number; amount: string; paidUzs: string | null; rateToUzs: string | null; paymentMethod: string; paidAt: Date; notes: string | null; createdBy: number | null; idempotencyKey: string | null; }

let suppliersTable: FakeSupplier[] = [];
let suppliesTable: FakeSupply[] = [];
let paymentsTable: FakePayment[] = [];
let nextSupplierId = 10;
let nextPaymentId = 10;

function paidFor(supplyId: number): number {
  return paymentsTable.filter((p) => p.supplyId === supplyId).reduce((s, p) => s + Number(p.amount), 0);
}

function resetTables() {
  suppliersTable = [
    { id: 1, tenantId: 1, name: "Завод Ташкент", contactName: null, phone: "+998901112233", inn: null, address: null, notes: null, status: "active" },
    { id: 2, tenantId: 1, name: "Неактивный", contactName: null, phone: null, inn: null, address: null, notes: null, status: "inactive" },
    { id: 3, tenantId: 2, name: "Чужой поставщик", contactName: null, phone: null, inn: null, address: null, notes: null, status: "active" },
  ];
  suppliesTable = [
    // Поставка 1: долг 40000 (100000 - 60000), не просрочена (без срока).
    { id: 1, tenantId: 1, supplierId: 1, arrivalId: 100, supplyNumber: "SUP-AAA", amount: "100000.00", currency: "UZS", rateToUzs: null, supplyDate: new Date("2026-01-10"), dueDate: null, notes: null, createdBy: 1 },
    // Поставка 2: полностью погашена.
    { id: 2, tenantId: 1, supplierId: 1, arrivalId: 101, supplyNumber: "SUP-BBB", amount: "50000.00", currency: "UZS", rateToUzs: null, supplyDate: new Date("2026-01-05"), dueDate: null, notes: null, createdBy: 1 },
    // Поставка 3: долг есть, срок в далёком прошлом — просрочена.
    { id: 3, tenantId: 1, supplierId: 1, arrivalId: 102, supplyNumber: "SUP-CCC", amount: "20000.00", currency: "USD", rateToUzs: "12800.0000", supplyDate: new Date("2025-01-01"), dueDate: new Date("2025-02-01"), notes: null, createdBy: 1 },
  ];
  paymentsTable = [
    { id: 1, tenantId: 1, supplierId: 1, supplyId: 1, amount: "60000.00", paidUzs: null, rateToUzs: null, paymentMethod: "cash", paidAt: new Date("2026-01-15"), notes: null, createdBy: 1, idempotencyKey: "seed-1" },
    { id: 2, tenantId: 1, supplierId: 1, supplyId: 2, amount: "50000.00", paidUzs: null, rateToUzs: null, paymentMethod: "transfer", paidAt: new Date("2026-01-06"), notes: null, createdBy: 1, idempotencyKey: "seed-2" },
  ];
  nextSupplierId = 10;
  nextPaymentId = 10;
}

function tableOf(ref: unknown): string {
  if (ref === suppliers) return "suppliers";
  if (ref === supplies) return "supplies";
  if (ref === supplierPayments) return "supplierPayments";
  return "other";
}

function rowsFor(table: string): Record<string, unknown>[] {
  if (table === "suppliers") return suppliersTable as unknown as Record<string, unknown>[];
  if (table === "supplies") return suppliesTable as unknown as Record<string, unknown>[];
  if (table === "supplierPayments") return paymentsTable as unknown as Record<string, unknown>[];
  return [];
}

const columnToFieldName = new Map<unknown, string>();
for (const [field, col] of Object.entries(suppliers)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(supplies)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(supplierPayments)) columnToFieldName.set(col, field);

const evalCond = makeConditionEvaluator({
  fieldOf: col => columnToFieldName.get(col) ?? (col as { name?: string } | null)?.name,
  treatMissingColumnAsMatch: false,
  rawSql: () => true,
});

function chainable(rows: Record<string, unknown>[]) {
  const p = Promise.resolve(rows) as Promise<Record<string, unknown>[]> & {
    limit?: (n: number) => ReturnType<typeof chainable>;
    orderBy?: (..._a: unknown[]) => ReturnType<typeof chainable>;
  };
  p.limit = (n: number) => chainable(rows.slice(0, n));
  p.orderBy = () => chainable(rows);
  return p;
}

/** Проекция строки поставщика с подзапросами долга — по имени алиаса. */
function projectSupplierRow(row: FakeSupplier, proj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const alias of Object.keys(proj)) {
    if (alias === "debtUzs") {
      out.debtUzs = String(suppliesTable
        .filter((s) => s.supplierId === row.id && s.currency === "UZS")
        .reduce((sum, s) => sum + (Number(s.amount) - paidFor(s.id)), 0));
    } else if (alias === "debtUsd") {
      out.debtUsd = String(suppliesTable
        .filter((s) => s.supplierId === row.id && s.currency === "USD")
        .reduce((sum, s) => sum + (Number(s.amount) - paidFor(s.id)), 0));
    } else if (alias === "suppliesCount") {
      out.suppliesCount = suppliesTable.filter((s) => s.supplierId === row.id).length;
    } else {
      out[alias] = (row as Record<string, unknown>)[alias];
    }
  }
  return out;
}

/** Проекция строки поставки (getSupplyByArrival / pay) — по имени алиаса. */
function projectSupplyRow(row: FakeSupply, proj: Record<string, unknown>, supplierName?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const alias of Object.keys(proj)) {
    if (alias === "paid") out.paid = String(paidFor(row.id));
    else if (alias === "supplierName") out.supplierName = supplierName ?? suppliersTable.find((s) => s.id === row.supplierId)?.name;
    else out[alias] = (row as Record<string, unknown>)[alias];
  }
  return out;
}

function makeMockDb() {
  const db: any = {
    select: (proj?: Record<string, unknown>) => {
      let currentTable = "other";
      let joined = false;
      const api: Record<string, any> = {
        from(ref: unknown) { currentTable = tableOf(ref); return api; },
        innerJoin(_ref: unknown, _cond: unknown) { joined = true; return api; },
        where(cond: unknown) {
          const filtered = rowsFor(currentTable).filter((r) => evalCond(r, cond as Record<string, unknown>));
          if (!proj) return chainable(filtered);
          if (currentTable === "suppliers" && !joined) {
            return chainable(filtered.map((r) => projectSupplierRow(r as unknown as FakeSupplier, proj)));
          }
          if (currentTable === "supplies") {
            return chainable(filtered.map((r) => projectSupplyRow(r as unknown as FakeSupply, proj)));
          }
          return chainable(filtered.map((r) => {
            const out: Record<string, unknown> = {};
            for (const alias of Object.keys(proj)) out[alias] = (r as Record<string, unknown>)[alias];
            return out;
          }));
        },
      };
      return api;
    },
    insert: (ref: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const table = tableOf(ref);
        if (table === "suppliers") {
          if (suppliersTable.some((s) => s.tenantId === vals.tenantId && s.name === vals.name)) {
            throw new Error("Duplicate entry 'x' for key 'uq_supplier_name_tenant'");
          }
          const id = nextSupplierId++;
          suppliersTable.push({
            id, tenantId: vals.tenantId as number, name: vals.name as string,
            contactName: (vals.contactName as string) ?? null, phone: (vals.phone as string) ?? null,
            inn: (vals.inn as string) ?? null, address: (vals.address as string) ?? null,
            notes: (vals.notes as string) ?? null, status: "active",
          });
          return Promise.resolve([{ insertId: id }]);
        }
        if (table === "supplierPayments") {
          if (paymentsTable.some((p) => p.tenantId === vals.tenantId && p.idempotencyKey === vals.idempotencyKey)) {
            throw new Error("Duplicate entry 'x' for key 'uq_supplier_payment_idem'");
          }
          const id = nextPaymentId++;
          paymentsTable.push({
            id, tenantId: vals.tenantId as number, supplierId: vals.supplierId as number,
            supplyId: vals.supplyId as number, amount: String(vals.amount ?? "0.00"),
            paidUzs: vals.paidUzs != null ? String(vals.paidUzs) : null,
            rateToUzs: vals.rateToUzs != null ? String(vals.rateToUzs) : null,
            paymentMethod: (vals.paymentMethod as string) ?? "transfer",
            paidAt: new Date(), notes: (vals.notes as string) ?? null,
            createdBy: (vals.createdBy as number) ?? null,
            idempotencyKey: (vals.idempotencyKey as string) ?? null,
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
              for (const [key, val] of Object.entries(patch)) if (val !== undefined) row[key] = val;
            }
            return Promise.resolve([{ affectedRows: matched }]);
          },
        };
      },
    }),
    transaction: async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn(db),
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

describe("supplier.list", () => {
  it("считает долг по каждой валюте отдельно, не смешивая суммы с долларами", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const caller = supplierRouter.createCaller(makeCtx(1, 10));
    const result = await caller.list(undefined);
    const zavod = result.find((s) => s.id === 1)!;
    // Поставка 1: 100000 - 60000 = 40000 UZS. Поставка 2: погашена, 0.
    expect(zavod.debtUzs).toBe(40000);
    // Поставка 3: 20000 - 0 = 20000 USD, отдельно от суммовой.
    expect(zavod.debtUsd).toBe(20000);
    expect(zavod.suppliesCount).toBe(3);
  });

  it("не показывает неактивных поставщиков по умолчанию", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const caller = supplierRouter.createCaller(makeCtx(1, 10));
    const result = await caller.list(undefined);
    expect(result.find((s) => s.id === 2)).toBeUndefined();
  });

  it("onlyDebtors оставляет только тех, у кого есть долг хотя бы в одной валюте", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const caller = supplierRouter.createCaller(makeCtx(1, 10));
    const result = await caller.list({ onlyDebtors: true });
    expect(result.map((s) => s.id)).toEqual([1]);
  });

  it("не видит поставщиков другой организации", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const caller = supplierRouter.createCaller(makeCtx(1, 10));
    const result = await caller.list(undefined);
    expect(result.find((s) => s.id === 3)).toBeUndefined();
  });
});

describe("supplier.create", () => {
  it("отклоняет второе имя, уже занятое в этой организации", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const caller = supplierRouter.createCaller(makeCtx(1, 10));
    await expect(caller.create({ name: "Завод Ташкент" })).rejects.toThrow(/уже заведён/i);
  });

  it("то же имя у другой организации — не конфликт", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const caller = supplierRouter.createCaller(makeCtx(2, 20));
    const result = await caller.create({ name: "Завод Ташкент" });
    expect(result.id).toBeGreaterThan(0);
  });
});

describe("supplier.getSupplyByArrival", () => {
  it("возвращает null, когда к приходу поставка не привязана", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const caller = supplierRouter.createCaller(makeCtx(1, 10));
    const result = await caller.getSupplyByArrival({ arrivalId: 999 });
    expect(result).toBeNull();
  });

  it("считает долг и подтягивает платежи по поставке", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const caller = supplierRouter.createCaller(makeCtx(1, 10));
    const result = await caller.getSupplyByArrival({ arrivalId: 100 });
    expect(result).not.toBeNull();
    expect(result!.supplierName).toBe("Завод Ташкент");
    expect(result!.amount).toBe(100000);
    expect(result!.paid).toBe(60000);
    expect(result!.debt).toBe(40000);
    expect(result!.payments).toHaveLength(1);
  });

  it("просрочена, только если срок в прошлом и долг ещё есть", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const caller = supplierRouter.createCaller(makeCtx(1, 10));
    const overdueSupply = await caller.getSupplyByArrival({ arrivalId: 102 });
    expect(overdueSupply!.overdue).toBe(true);

    const paidOffSupply = await caller.getSupplyByArrival({ arrivalId: 101 });
    expect(paidOffSupply!.debt).toBe(0);
    expect(paidOffSupply!.overdue).toBe(false); // долга нет — просрочка не считается, даже без срока
  });

  it("не отдаёт поставку другой организации по чужому arrivalId", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const caller = supplierRouter.createCaller(makeCtx(2, 20));
    const result = await caller.getSupplyByArrival({ arrivalId: 100 });
    expect(result).toBeNull();
  });
});

describe("supplier.pay", () => {
  it("уменьшает долг и возвращает остаток", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const caller = supplierRouter.createCaller(makeCtx(1, 1));
    const result = await caller.pay({
      supplyId: 1, amount: "15000.00", paymentMethod: "cash",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.debt).toBe(25000); // было 40000, минус 15000
    expect(paymentsTable.some((p) => p.idempotencyKey === "11111111-1111-4111-8111-111111111111")).toBe(true);
  });

  it("запрещает переплату сверх остатка", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const caller = supplierRouter.createCaller(makeCtx(1, 1));
    await expect(caller.pay({
      supplyId: 1, amount: "999999.00", paymentMethod: "cash",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
    })).rejects.toThrow(/остатка/i);
    // Ни один платёж не записан — отказ произошёл до вставки.
    expect(paymentsTable).toHaveLength(2);
  });

  it("платит копейка в копейку остаток — переплатой не считается", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const caller = supplierRouter.createCaller(makeCtx(1, 1));
    const result = await caller.pay({
      supplyId: 1, amount: "40000.00", paymentMethod: "transfer",
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
    });
    expect(result.debt).toBe(0);
  });

  it("повтор той же попытки (тот же idempotencyKey) не списывает долг дважды", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const caller = supplierRouter.createCaller(makeCtx(1, 1));
    const key = "44444444-4444-4444-8444-444444444444";
    await caller.pay({ supplyId: 1, amount: "10000.00", paymentMethod: "cash", idempotencyKey: key });
    expect(paymentsTable.filter((p) => p.idempotencyKey === key)).toHaveLength(1);

    const second = await caller.pay({ supplyId: 1, amount: "10000.00", paymentMethod: "cash", idempotencyKey: key });
    expect(second.duplicate).toBe(true);
    // Не два платежа под одним ключом — вставка второй раз даже не случилась.
    expect(paymentsTable.filter((p) => p.idempotencyKey === key)).toHaveLength(1);
  });

  it("не позволяет платить по поставке другой организации", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const caller = supplierRouter.createCaller(makeCtx(2, 20));
    await expect(caller.pay({
      supplyId: 1, amount: "100.00", paymentMethod: "cash",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
    })).rejects.toThrow(/не найдена/i);
  });
});
