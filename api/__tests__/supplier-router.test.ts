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

import { suppliers, supplies, supplierPayments, users } from "@db/schema";
import { makeConditionEvaluator } from "./helpers/fake-conditions";

/**
 * Стенд под api/supplier-router.ts.
 *
 * ── Что здесь подделано и почему именно так ──────────────────────────────────
 *
 * Долг нигде не хранится полем: роутер выводит его подзапросом `sql`` `. Такой
 * SQL стенд разобрать не может, поэтому подзапросы считаются здесь напрямую по
 * фейковым таблицам — но НЕ «лишь бы вернуть число», а по тому же правилу,
 * которое задумано в роутере: сумма поставки минус сумма платежей по ней.
 * Расхождение правил сделало бы тест бессмысленным.
 *
 * Соединения (`innerJoin`/`leftJoin`) стенд разрешает по внешним ключам, а не
 * считает выполненными: без этого `supplierName` и `currency`, которые роутер
 * берёт из присоединённой таблицы, молча приходили бы как undefined, и любая
 * проверка по ним подтверждала бы что угодно.
 *
 * `stats` здесь НЕ проверяется намеренно: он написан одним сырым запросом без
 * таблицы-источника, и честно воспроизвести его в стенде нельзя — пришлось бы
 * переписать тот же SQL на JavaScript и сверять его с самим собой. Такая
 * проверка не поймала бы ни одной настоящей ошибки.
 */

interface FakeSupplier { id: number; tenantId: number; name: string; contactName: string | null; phone: string | null; inn: string | null; address: string | null; notes: string | null; status: string; }
interface FakeSupply { id: number; tenantId: number; supplierId: number; arrivalId: number | null; supplyNumber: string; amount: string; currency: string; rateToUzs: string | null; supplyDate: Date; dueDate: Date | null; notes: string | null; createdBy: number | null; }
interface FakePayment { id: number; tenantId: number; supplierId: number; supplyId: number; amount: string; paidUzs: string | null; rateToUzs: string | null; paymentMethod: string; paidAt: Date; notes: string | null; createdBy: number | null; idempotencyKey: string | null; }
interface FakeUser { id: number; tenantId: number; name: string; }

let suppliersTable: FakeSupplier[] = [];
let suppliesTable: FakeSupply[] = [];
let paymentsTable: FakePayment[] = [];
let usersTable: FakeUser[] = [];
let nextSupplierId = 10;
let nextPaymentId = 10;

/** То же правило, что в роутере: уплачено по поставке — сумма её платежей. */
function paidFor(supplyId: number): number {
  return paymentsTable.filter((p) => p.supplyId === supplyId).reduce((s, p) => s + Number(p.amount), 0);
}

function resetTables() {
  suppliersTable = [
    { id: 1, tenantId: 1, name: "Завод Ташкент", contactName: "Азиз", phone: "+998901112233", inn: "301234567", address: null, notes: null, status: "active" },
    { id: 2, tenantId: 1, name: "Неактивный", contactName: null, phone: null, inn: null, address: null, notes: null, status: "inactive" },
    { id: 3, tenantId: 2, name: "Чужой поставщик", contactName: null, phone: null, inn: null, address: null, notes: null, status: "active" },
    { id: 4, tenantId: 1, name: "Без долгов", contactName: null, phone: null, inn: null, address: null, notes: null, status: "active" },
  ];
  suppliesTable = [
    // Поставка 1: долг 40000 (100000 − 60000), срока нет.
    { id: 1, tenantId: 1, supplierId: 1, arrivalId: 100, supplyNumber: "SUP-AAA", amount: "100000.00", currency: "UZS", rateToUzs: null, supplyDate: new Date("2026-01-10"), dueDate: null, notes: null, createdBy: 1 },
    // Поставка 2: погашена полностью.
    { id: 2, tenantId: 1, supplierId: 1, arrivalId: 101, supplyNumber: "SUP-BBB", amount: "50000.00", currency: "UZS", rateToUzs: null, supplyDate: new Date("2026-01-05"), dueDate: null, notes: null, createdBy: 1 },
    // Поставка 3: долларовая, долг есть, срок в далёком прошлом — просрочена.
    { id: 3, tenantId: 1, supplierId: 1, arrivalId: 102, supplyNumber: "SUP-CCC", amount: "20000.00", currency: "USD", rateToUzs: "12800.0000", supplyDate: new Date("2025-01-01"), dueDate: new Date("2025-02-01"), notes: null, createdBy: 1 },
  ];
  paymentsTable = [
    { id: 1, tenantId: 1, supplierId: 1, supplyId: 1, amount: "60000.00", paidUzs: null, rateToUzs: null, paymentMethod: "cash", paidAt: new Date("2026-01-15T14:30:00"), notes: null, createdBy: 7, idempotencyKey: "seed-1" },
    { id: 2, tenantId: 1, supplierId: 1, supplyId: 2, amount: "50000.00", paidUzs: null, rateToUzs: null, paymentMethod: "transfer", paidAt: new Date("2026-01-06T09:15:00"), notes: null, createdBy: 7, idempotencyKey: "seed-2" },
  ];
  usersTable = [{ id: 7, tenantId: 1, name: "Оператор Пётр" }];
  nextSupplierId = 10;
  nextPaymentId = 10;
}

function tableOf(ref: unknown): string {
  if (ref === suppliers) return "suppliers";
  if (ref === supplies) return "supplies";
  if (ref === supplierPayments) return "supplierPayments";
  if (ref === users) return "users";
  return "other";
}

function rowsFor(table: string): Record<string, unknown>[] {
  if (table === "suppliers") return suppliersTable as unknown as Record<string, unknown>[];
  if (table === "supplies") return suppliesTable as unknown as Record<string, unknown>[];
  if (table === "supplierPayments") return paymentsTable as unknown as Record<string, unknown>[];
  if (table === "users") return usersTable as unknown as Record<string, unknown>[];
  return [];
}

/** Объект колонки → { таблица, поле }. Нужно, чтобы разрешать соединения. */
const columnInfo = new Map<unknown, { table: string; field: string }>();
for (const [table, def] of Object.entries({ suppliers, supplies, supplierPayments, users })) {
  for (const [field, col] of Object.entries(def)) columnInfo.set(col, { table, field });
}

const evalCond = makeConditionEvaluator({
  fieldOf: col => columnInfo.get(col)?.field ?? (col as { name?: string } | null)?.name,
  treatMissingColumnAsMatch: false,
  rawSql: () => true,
});

function chainable(rows: Record<string, unknown>[]) {
  const p = Promise.resolve(rows) as Promise<Record<string, unknown>[]> & {
    limit?: (n: number) => ReturnType<typeof chainable>;
    orderBy?: (..._a: unknown[]) => ReturnType<typeof chainable>;
    for?: (..._a: unknown[]) => ReturnType<typeof chainable>;
  };
  p.limit = (n: number) => chainable(rows.slice(0, n));
  p.orderBy = () => chainable(rows);
  // .for("update") здесь СКВОЗНОЙ: настоящая блокировка строки в стенде
  // невоспроизводима, параллельных сделок тут нет. Значит гонку двух платежей
  // этим набором проверить нельзя — она проверяется в
  // api/__tests__/real-db/supplier-debt.test.ts на настоящей MySQL. Здесь
  // метод есть только затем, чтобы цепочка вызовов не оборвалась.
  p.for = () => chainable(rows);
  return p;
}

/**
 * Разрешить строку присоединённой таблицы по внешнему ключу базовой.
 *
 * Стенд не разбирает условие ON — он знает связи этой предметной области и
 * идёт по ним. Неизвестная связь возвращает undefined, и проверка по такому
 * полю провалится, а не пройдёт молча.
 */
function relatedRow(baseTable: string, base: Record<string, unknown>, target: string): Record<string, unknown> | undefined {
  if (target === "suppliers") {
    const id = baseTable === "supplies" || baseTable === "supplierPayments" ? base.supplierId : undefined;
    return suppliersTable.find(x => x.id === id) as unknown as Record<string, unknown> | undefined;
  }
  if (target === "supplies") {
    const id = baseTable === "supplierPayments" ? base.supplyId : undefined;
    return suppliesTable.find(x => x.id === id) as unknown as Record<string, unknown> | undefined;
  }
  if (target === "users") {
    return usersTable.find(x => x.id === base.createdBy) as unknown as Record<string, unknown> | undefined;
  }
  return undefined;
}

/** Значения, которые роутер получает подзапросом sql``, — по имени алиаса. */
const COMPUTED: Record<string, (base: string, row: Record<string, unknown>) => unknown> = {
  paid: (_b, row) => String(paidFor(Number(row.id))),
  debtUzs: (_b, row) => String(suppliesTable
    .filter(s => s.supplierId === row.id && s.currency === "UZS")
    .reduce((sum, s) => sum + (Number(s.amount) - paidFor(s.id)), 0)),
  debtUsd: (_b, row) => String(suppliesTable
    .filter(s => s.supplierId === row.id && s.currency === "USD")
    .reduce((sum, s) => sum + (Number(s.amount) - paidFor(s.id)), 0)),
  suppliesCount: (_b, row) => suppliesTable.filter(s => s.supplierId === row.id).length,
  overdueCount: (_b, row) => suppliesTable.filter(s =>
    s.supplierId === row.id && s.dueDate && s.dueDate < new Date(new Date().toDateString())
    && Number(s.amount) > paidFor(s.id)).length,
  lastPaymentAt: (_b, row) => {
    const dates = paymentsTable.filter(p => p.supplierId === row.id).map(p => p.paidAt.getTime());
    return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
  },
  arrivalNumber: (_b, row) => (row.arrivalId ? `ARR-${row.arrivalId}` : null),
};

function makeMockDb() {
  const db: any = {
    select: (proj?: Record<string, unknown>) => {
      let baseTable = "other";
      const joined: string[] = [];
      const api: Record<string, any> = {
        from(ref: unknown) { baseTable = tableOf(ref); return api; },
        innerJoin(ref: unknown) { joined.push(tableOf(ref)); return api; },
        leftJoin(ref: unknown) { joined.push(tableOf(ref)); return api; },
        where(cond: unknown) {
          const filtered = rowsFor(baseTable).filter((r) => evalCond(r, cond as Record<string, unknown>));
          if (!proj) return chainable(filtered);

          return chainable(filtered.map((row) => {
            const out: Record<string, unknown> = {};
            for (const [alias, def] of Object.entries(proj)) {
              if (COMPUTED[alias]) { out[alias] = COMPUTED[alias](baseTable, row); continue; }
              const info = columnInfo.get(def);
              if (!info) { out[alias] = undefined; continue; }
              if (info.table === baseTable) { out[alias] = row[info.field]; continue; }
              // Колонка из присоединённой таблицы — идём по внешнему ключу.
              const rel = joined.includes(info.table) ? relatedRow(baseTable, row, info.table) : undefined;
              out[alias] = rel ? rel[info.field] : undefined;
            }
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
  it("считает долг по каждой валюте отдельно, не смешивая сумы с долларами", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const result = await supplierRouter.createCaller(makeCtx(1, 10)).list(undefined);
    const zavod = result.find((s) => s.id === 1)!;
    // Поставка 1: 100000 − 60000 = 40000 UZS; поставка 2 погашена.
    expect(zavod.debtUzs).toBe(40000);
    // Поставка 3: 20000 USD — отдельной суммой, а не приплюсована к сумовой.
    expect(zavod.debtUsd).toBe(20000);
    expect(zavod.suppliesCount).toBe(3);
  });

  it("подтягивает дату последнего платежа и число просроченных поставок", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const result = await supplierRouter.createCaller(makeCtx(1, 10)).list(undefined);
    const zavod = result.find((s) => s.id === 1)!;
    expect(zavod.overdueCount).toBe(1); // только поставка 3
    expect(new Date(zavod.lastPaymentAt!).getTime()).toBe(new Date("2026-01-15T14:30:00").getTime());
  });

  it("не показывает неактивных по умолчанию и показывает по флагу", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const caller = supplierRouter.createCaller(makeCtx(1, 10));
    expect((await caller.list(undefined)).find((s) => s.id === 2)).toBeUndefined();
    expect((await caller.list({ includeInactive: true })).find((s) => s.id === 2)).toBeDefined();
  });

  it("onlyDebtors оставляет только тех, у кого есть долг", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const result = await supplierRouter.createCaller(makeCtx(1, 10)).list({ onlyDebtors: true });
    expect(result.map((s) => s.id)).toEqual([1]);
  });

  it("onlyOverdue оставляет только просроченных", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const result = await supplierRouter.createCaller(makeCtx(1, 10)).list({ onlyOverdue: true });
    expect(result.map((s) => s.id)).toEqual([1]);
  });

  it("не видит контрагентов другой организации", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const result = await supplierRouter.createCaller(makeCtx(1, 10)).list(undefined);
    expect(result.find((s) => s.id === 3)).toBeUndefined();
  });
});

describe("supplier.create / update", () => {
  it("отклоняет имя, уже занятое в этой организации", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const caller = supplierRouter.createCaller(makeCtx(1, 10));
    await expect(caller.create({ name: "Завод Ташкент" })).rejects.toThrow(/уже заведён/i);
  });

  it("то же имя у другой организации — не конфликт", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const result = await supplierRouter.createCaller(makeCtx(2, 20)).create({ name: "Завод Ташкент" });
    expect(result.id).toBeGreaterThan(0);
  });

  it("не даёт править контрагента чужой организации", async () => {
    const { supplierRouter } = await import("../supplier-router");
    await expect(
      supplierRouter.createCaller(makeCtx(2, 20)).update({ id: 1, name: "Переименовали" }),
    ).rejects.toThrow(/не найден/i);
    expect(suppliersTable.find(s => s.id === 1)!.name).toBe("Завод Ташкент");
  });
});

describe("supplier.supplies", () => {
  it("считает остаток и помечает просрочку", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const result = await supplierRouter.createCaller(makeCtx(1, 10)).supplies({ supplierId: 1 });
    const byId = Object.fromEntries(result.data.map(r => [r.id, r]));
    expect(byId[1].debt).toBe(40000);
    expect(byId[1].overdue).toBe(false); // срока нет
    expect(byId[2].debt).toBe(0);
    expect(byId[3].overdue).toBe(true);  // срок в прошлом и долг есть
  });

  it("погашенная поставка не считается просроченной даже с истёкшим сроком", async () => {
    // Гасим просроченную поставку целиком — признак обязан погаснуть.
    paymentsTable.push({
      id: 99, tenantId: 1, supplierId: 1, supplyId: 3, amount: "20000.00", paidUzs: null,
      rateToUzs: null, paymentMethod: "cash", paidAt: new Date("2026-02-01"), notes: null,
      createdBy: 7, idempotencyKey: "seed-3",
    });
    const { supplierRouter } = await import("../supplier-router");
    const result = await supplierRouter.createCaller(makeCtx(1, 10)).supplies({ supplierId: 1 });
    const supply3 = result.data.find(r => r.id === 3)!;
    expect(supply3.debt).toBe(0);
    expect(supply3.overdue).toBe(false);
  });

  it("onlyUnpaid и onlyOverdue отсеивают, и total считается после отсева", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const caller = supplierRouter.createCaller(makeCtx(1, 10));
    const unpaid = await caller.supplies({ supplierId: 1, onlyUnpaid: true });
    expect(unpaid.data.map(r => r.id).sort()).toEqual([1, 3]);
    // total обязан отражать отфильтрованное, иначе постраничная навигация
    // покажет несуществующие страницы.
    expect(unpaid.total).toBe(2);

    const overdue = await caller.supplies({ supplierId: 1, onlyOverdue: true });
    expect(overdue.data.map(r => r.id)).toEqual([3]);
    expect(overdue.total).toBe(1);
  });

  it("подтягивает название контрагента из присоединённой таблицы", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const result = await supplierRouter.createCaller(makeCtx(1, 10)).supplies({ supplierId: 1 });
    expect(result.data[0].supplierName).toBe("Завод Ташкент");
  });

  it("не отдаёт поставки чужой организации", async () => {
    const { supplierRouter } = await import("../supplier-router");
    await expect(
      supplierRouter.createCaller(makeCtx(2, 20)).supplies({ supplierId: 1 }),
    ).rejects.toThrow(/не найден/i);
  });
});

describe("supplier.getSupplyByArrival", () => {
  it("возвращает null, когда к приходу поставка не привязана", async () => {
    const { supplierRouter } = await import("../supplier-router");
    expect(await supplierRouter.createCaller(makeCtx(1, 10)).getSupplyByArrival({ arrivalId: 999 })).toBeNull();
  });

  it("считает долг и подтягивает платежи с автором", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const result = await supplierRouter.createCaller(makeCtx(1, 10)).getSupplyByArrival({ arrivalId: 100 });
    expect(result!.supplierName).toBe("Завод Ташкент");
    expect(result!.amount).toBe(100000);
    expect(result!.paid).toBe(60000);
    expect(result!.debt).toBe(40000);
    expect(result!.payments).toHaveLength(1);
    // Имя берётся leftJoin по users — если соединение перестанет работать,
    // здесь будет undefined, а не тихо пустая строка.
    expect(result!.payments[0].authorName).toBe("Оператор Пётр");
  });

  it("не отдаёт поставку другой организации по чужому arrivalId", async () => {
    const { supplierRouter } = await import("../supplier-router");
    expect(await supplierRouter.createCaller(makeCtx(2, 20)).getSupplyByArrival({ arrivalId: 100 })).toBeNull();
  });
});

describe("supplier.payments", () => {
  it("отдаёт историю с валютой поставки и автором", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const rows = await supplierRouter.createCaller(makeCtx(1, 10)).payments({ supplierId: 1 });
    expect(rows).toHaveLength(2);
    expect(rows[0].currency).toBe("UZS");          // из supplies через join
    expect(rows[0].supplierName).toBe("Завод Ташкент");
    expect(rows[0].authorName).toBe("Оператор Пётр");
  });

  it("не отдаёт платежи чужой организации", async () => {
    const { supplierRouter } = await import("../supplier-router");
    await expect(
      supplierRouter.createCaller(makeCtx(2, 20)).payments({ supplierId: 1 }),
    ).rejects.toThrow(/не найден/i);
  });
});

describe("supplier.pay", () => {
  it("уменьшает долг и возвращает остаток", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const result = await supplierRouter.createCaller(makeCtx(1, 1)).pay({
      supplyId: 1, amount: "15000.00", paymentMethod: "cash",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.debt).toBe(25000);
  });

  it("запрещает переплату сверх остатка", async () => {
    const { supplierRouter } = await import("../supplier-router");
    await expect(supplierRouter.createCaller(makeCtx(1, 1)).pay({
      supplyId: 1, amount: "999999.00", paymentMethod: "cash",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
    })).rejects.toThrow(/остатка/i);
    expect(paymentsTable).toHaveLength(2); // ничего не записалось
  });

  it("платит остаток копейка в копейку — переплатой не считается", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const result = await supplierRouter.createCaller(makeCtx(1, 1)).pay({
      supplyId: 1, amount: "40000.00", paymentMethod: "transfer",
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
    });
    expect(result.debt).toBe(0);
  });

  it("повтор с тем же ключом не списывает долг дважды", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const caller = supplierRouter.createCaller(makeCtx(1, 1));
    const key = "44444444-4444-4444-8444-444444444444";
    await caller.pay({ supplyId: 1, amount: "10000.00", paymentMethod: "cash", idempotencyKey: key });
    const second = await caller.pay({ supplyId: 1, amount: "10000.00", paymentMethod: "cash", idempotencyKey: key });
    expect(second.duplicate).toBe(true);
    expect(paymentsTable.filter((p) => p.idempotencyKey === key)).toHaveLength(1);
  });

  it("не позволяет платить по поставке другой организации", async () => {
    const { supplierRouter } = await import("../supplier-router");
    await expect(supplierRouter.createCaller(makeCtx(2, 20)).pay({
      supplyId: 1, amount: "100.00", paymentMethod: "cash",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
    })).rejects.toThrow(/не найдена/i);
  });
});

describe("supplier.reconciliation — акт сверки", () => {
  it("ведёт остаток по каждой валюте отдельной лентой", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const result = await supplierRouter.createCaller(makeCtx(1, 10)).reconciliation({ supplierId: 1 });

    const uzs = result.byCurrency.find(b => b!.currency === "UZS")!;
    // 100000 + 50000 поставок минус 110000 платежей = 40000.
    expect(uzs.turnoverDebit).toBe(150000);
    expect(uzs.turnoverCredit).toBe(110000);
    expect(uzs.closing).toBe(40000);

    const usd = result.byCurrency.find(b => b!.currency === "USD")!;
    expect(usd.closing).toBe(20000);
    // Доллары не смешаны с сумами — это разные ленты.
    expect(usd.turnoverCredit).toBe(0);
  });

  it("остаток пересчитывается построчно и совпадает с последней строкой", async () => {
    const { supplierRouter } = await import("../supplier-router");
    const result = await supplierRouter.createCaller(makeCtx(1, 10)).reconciliation({ supplierId: 1 });
    const uzs = result.byCurrency.find(b => b!.currency === "UZS")!;
    expect(uzs.rows.at(-1)!.balance).toBe(uzs.closing);
    // События идут по возрастанию даты — иначе остаток считался бы задом наперёд.
    const dates = uzs.rows.map(r => new Date(r.date).getTime());
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
  });

  it("входящий остаток учитывает всё, что было до начала периода", async () => {
    const { supplierRouter } = await import("../supplier-router");
    // Всё суммовое движение произошло 05–15 января; берём период с 20 января.
    const result = await supplierRouter.createCaller(makeCtx(1, 10))
      .reconciliation({ supplierId: 1, from: "2026-01-20" });
    const uzs = result.byCurrency.find(b => b!.currency === "UZS")!;
    expect(uzs.opening).toBe(40000);   // долг накоплен до начала периода
    expect(uzs.rows).toHaveLength(0);  // внутри периода движений нет
    expect(uzs.closing).toBe(40000);   // и остаток не изменился
  });

  it("верхняя граница периода включает весь последний день", async () => {
    // Платёж датирован 15 января. Если границу брать полуночью, он выпадет
    // из периода «по 15 января» — и акт сверки уедет на сумму платежа.
    const { supplierRouter } = await import("../supplier-router");
    const result = await supplierRouter.createCaller(makeCtx(1, 10))
      .reconciliation({ supplierId: 1, from: "2026-01-15", to: "2026-01-15" });
    const uzs = result.byCurrency.find(b => b!.currency === "UZS")!;
    expect(uzs.turnoverCredit).toBe(60000);
  });

  it("не отдаёт сверку по контрагенту другой организации", async () => {
    const { supplierRouter } = await import("../supplier-router");
    await expect(
      supplierRouter.createCaller(makeCtx(2, 20)).reconciliation({ supplierId: 1 }),
    ).rejects.toThrow(/не найден/i);
  });
});
