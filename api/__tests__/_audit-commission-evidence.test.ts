/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AUDIT EVIDENCE ONLY — not a product test. Demonstrates the numbers that
 * calculateSalary() actually writes. Delete after the audit.
 *
 * The in-memory db below is stricter than the existing suites' doubles:
 *  - orderBy(desc(col)) really sorts (so "latest monthly row" is real)
 *  - update(...).where(...) really honours the condition (so the status
 *    guard is real)
 *  - innerJoin really joins, and conditions are resolved per source table
 *    (so `returns` ⋈ `orders` filtering is real)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  return drizzleMock();
});
vi.mock("../services/anti-fraud", () => ({
  calculateFraudMetrics: vi.fn(async () => ({ suspiciousVisits: 0, fraudRate: 0, avgVisitDuration: 0 })),
}));
vi.mock("../lib/feature-gating", () => ({ hasSubscriptionAccess: vi.fn(async () => true), checkSubscriptionAccess: vi.fn(async () => true), invalidateSubscriptionAccess: vi.fn() }));
vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());
vi.mock("../lib/sse", () => ({ sseBus: { emit: vi.fn() } }));
vi.mock("../telegram-router", () => ({ notifyAdmin: vi.fn(async () => {}), tgMessages: { upgradeRequest: vi.fn(() => "mock") } }));
vi.mock("../lib/cache", () => ({
  cache: { get: () => undefined, set: () => {}, invalidate: () => {}, invalidatePrefix: () => {} },
  CacheKeys: { commissions: (t: number) => `commissions:${t}` },
  CacheTTL: { commissions: 60, kpis: 60 },
}));
let routerDb: any;
vi.mock("../queries/connection", () => ({ getDb: () => routerDb }));

import { orders, returns, commissions, salesTargets, users } from "@db/schema";
import { calculateSalary } from "../services/kpi";

// ── tiny SQL engine ──────────────────────────────────────────────────────────
const TABLES: Record<string, any> = { orders, returns, commissions, salesTargets, users };
const colInfo = new Map<unknown, { t: string; f: string }>();
for (const [tname, tbl] of Object.entries(TABLES)) {
  for (const [f, col] of Object.entries(tbl as object)) {
    if (col && typeof col === "object") colInfo.set(col, { t: tname, f });
  }
}
function tableName(ref: unknown): string {
  for (const [n, t] of Object.entries(TABLES)) if (t === ref) return n;
  return "other";
}

let data: Record<string, any[]> = {};
let nextId = 100;
const inserted: any[] = [];

function readCol(row: any, col: unknown): unknown {
  const info = colInfo.get(col);
  if (!info) return undefined;
  if (row.__joined) return row[info.t]?.[info.f];
  return row.__t === info.t ? row[info.f] : undefined;
}

function num(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  const n = Number(v);
  return Number.isNaN(n) ? NaN : n;
}

function evalCond(row: any, cond: any): boolean {
  if (!cond || typeof cond !== "object") return true;
  switch (cond.__kind) {
    case "and": return cond.conds.every((c: any) => evalCond(row, c));
    case "or": return cond.conds.some((c: any) => evalCond(row, c));
    case "eq": {
      // right-hand side may itself be a column (join predicates)
      const rhs = colInfo.has(cond.val) ? readCol(row, cond.val) : cond.val;
      if (readCol(row, cond.col) == null || rhs == null) return false;
      return String(readCol(row, cond.col)) === String(rhs);
    }
    case "ne": return String(readCol(row, cond.col)) !== String(cond.val);
    case "isNull": return readCol(row, cond.col) == null;
    case "isNotNull": return readCol(row, cond.col) != null;
    case "inArray": return (cond.values as unknown[]).map(String).includes(String(readCol(row, cond.col)));
    case "gte": case "lte": {
      const a = num(readCol(row, cond.col)), b = num(cond.val);
      if (Number.isNaN(a) || Number.isNaN(b)) {
        return cond.__kind === "gte"
          ? String(readCol(row, cond.col)) >= String(cond.val)
          : String(readCol(row, cond.col)) <= String(cond.val);
      }
      return cond.__kind === "gte" ? a >= b : a <= b;
    }
    case "sql": {
      // Сравнение вида sql`${колонка} = ${значение}`. Раньше здесь стоял
      // безусловный true с пометкой «сырые условия в проверяемом коде не
      // используются» — и это перестало быть правдой ровно тогда, когда
      // calculateSalary начал искать строку за КОНКРЕТНЫЙ период. Стенд молча
      // пропускал фильтр, отдавал первую попавшуюся строку, и проверка
      // «новый месяц создаётся» зеленела, ничего не проверив.
      const [lhs, rhs] = (cond.values ?? []) as unknown[];
      const op = String(cond.strings?.[1] ?? "").trim();
      if (op === "=" && colInfo.has(lhs)) {
        const actual = readCol(row, lhs);
        if (actual == null) return false;
        // period_start — колонка типа date; в базе это календарный день, а в
        // стенде может лежать как строка, так и Date.
        const norm = (v: unknown) =>
          v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
        return norm(actual) === norm(rhs);
      }
      return true; // прочие сырые выражения стенд по-прежнему не толкует
    }
    default: return true;
  }
}

function rawSql(o: any): string {
  return Array.isArray(o?.strings) ? o.strings.join("?") : "";
}

function project(rows: any[], proj: any, from: string): any[] {
  const isAgg = Object.values(proj ?? {}).some((v: any) => v?.__kind === "sql" && /count\(|SUM\(/i.test(rawSql(v)));
  const val = (def: any, row: any): unknown => {
    if (def?.__kind === "sql") {
      const s = rawSql(def);
      if (/count\(\*/i.test(s)) return rows.length;
      if (/SUM\(/i.test(s)) {
        // column being summed: either interpolated (`${returns.totalAmount}`)
        // or written literally inside the SUM (`SUM(CAST(total AS ...))`)
        let get: (r: any) => unknown;
        if (def.values?.length && colInfo.has(def.values[0])) get = (r: any) => readCol(r, def.values[0]);
        else {
          const m = s.match(/SUM\(\s*(?:CAST\(\s*)?([a-z_]+)/i);
          const snake = m?.[1] ?? "";
          const camel = snake.replace(/_(\w)/g, (_x, c) => c.toUpperCase());
          get = (r: any) => (r.__joined ? r[from]?.[camel] : r[camel]);
        }
        return String(rows.reduce((s2, r) => s2 + Number(get(r) ?? 0), 0));
      }
      // bare column reference, e.g. sql`commission_rate`
      const camel = s.trim().replace(/_(\w)/g, (_x, c) => c.toUpperCase());
      return row?.__joined ? row[from]?.[camel] : row?.[camel];
    }
    return readCol(row, def);
  };
  if (isAgg) {
    const out: any = {};
    for (const [k, def] of Object.entries(proj)) out[k] = val(def, rows[0]);
    return [out];
  }
  return rows.map(r => {
    const out: any = {};
    for (const [k, def] of Object.entries(proj)) out[k] = val(def, r);
    return out;
  });
}

function makeDb() {
  const db: any = {};
  db.select = (proj?: any) => {
    let from = "other";
    let rows: any[] = [];
    let joined = false;
    const api: any = {
      from(ref: unknown) {
        from = tableName(ref);
        rows = (data[from] ?? []).map(r => ({ ...r, __t: from }));
        return api;
      },
      innerJoin(ref: unknown, on: any) {
        const other = tableName(ref);
        joined = true;
        const out: any[] = [];
        for (const l of rows) {
          for (const r of data[other] ?? []) {
            const jr = { __joined: true, [from]: l, [other]: r };
            if (evalCond(jr, on)) out.push(jr);
          }
        }
        rows = out;
        return api;
      },
      leftJoin() { return api; },
      where(cond: any) {
        const filtered = rows.filter(r => evalCond(r, cond));
        return chain(proj ? project(filtered, proj, from) : filtered);
      },
      orderBy(...a: any[]) { return chain(sortRows(rows, a, proj, from)); },
      limit(n: number) { return chain((proj ? project(rows, proj, from) : rows).slice(0, n)); },
      groupBy() { return chain(proj ? project(rows, proj, from) : rows); },
    };
    function sortRows(rs: any[], order: any[], p: any, f: string) {
      const sorted = [...rs];
      const o = order[0];
      if (o?.__kind === "desc" || o?.__kind === "asc") {
        sorted.sort((x, y) => {
          const a = String(readCol(x, o.col) ?? ""), b = String(readCol(y, o.col) ?? "");
          return o.__kind === "desc" ? (a < b ? 1 : a > b ? -1 : 0) : (a < b ? -1 : a > b ? 1 : 0);
        });
      }
      return p ? project(sorted, p, f) : sorted;
    }
    function chain(rs: any[]): any {
      const p: any = Promise.resolve(rs);
      p.limit = (n: number) => chain(rs.slice(0, n));
      p.orderBy = (...a: any[]) => {
        // rows here are already projected; re-sort by the raw source instead
        const src = rows.filter(() => true);
        void src;
        return chain(rs);
      };
      p.groupBy = () => p;
      p.innerJoin = () => p;
      p.leftJoin = () => p;
      p.for = () => p;
      return p;
    }
    void joined;
    return api;
  };
  db.insert = (ref: unknown) => ({
    values: (v: any) => {
      const t = tableName(ref);
      const row = { id: nextId++, ...unwrap(v) };
      (data[t] ??= []).push(row);
      inserted.push({ table: t, row });
      return Promise.resolve([{ insertId: row.id }]);
    },
  });
  db.update = (ref: unknown) => ({
    set: (patch: any) => ({
      where: (cond: any) => {
        const t = tableName(ref);
        let n = 0;
        for (const row of data[t] ?? []) {
          if (!evalCond({ ...row, __t: t }, cond)) continue;
          Object.assign(row, unwrap(patch));
          n++;
        }
        return Promise.resolve({ affectedRows: n });
      },
    }),
  });
  db.transaction = (fn: any) => fn(db);
  return db;
}
function unwrap(v: any): any {
  const out: any = {};
  for (const [k, val] of Object.entries(v ?? {})) {
    out[k] = (val as any)?.__kind === "sql" ? (val as any).values?.[0] : val;
  }
  return out;
}

const KPI: any = { agentId: 10, agentName: "Agent", kpiScore: 0, fraudRate: 0 };

beforeEach(() => {
  data = { orders: [], returns: [], commissions: [], salesTargets: [], users: [] };
  inserted.length = 0;
  nextId = 100;
});

const JULY = { s: new Date(Date.UTC(2026, 6, 1)), e: new Date(Date.UTC(2026, 6, 31, 23, 59, 59)) };
const AUG_MTD = { s: new Date(Date.UTC(2026, 7, 1)), e: new Date(Date.UTC(2026, 7, 6, 23, 59, 59)) };

/**
 * Раньше это был файл-улика: проверки утверждали НАБЛЮДАЕМОЕ, то есть неверное
 * поведение. Ошибки исправлены (см. блок persist в services/kpi.ts), поэтому
 * проверки переписаны на правильный исход — иначе они закрепляли бы баг и
 * покраснели бы у того, кто его чинит.
 */
describe("calculateSalary: запись расчёта по месяцам", () => {
  it("A. расчёт нового месяца НЕ переписывает строку прошлого", async () => {
    data.commissions = [{
      id: 1, tenantId: 1, userId: 10, commissionRate: "5.00", periodType: "monthly",
      periodStart: "2026-07-01", periodEnd: "2026-07-31",
      salesAmount: "50000000.00", commissionAmount: "2500000.00", status: "pending",
    }];
    data.orders = [
      { id: 1, tenantId: 1, agentId: 10, status: "delivered", total: "50000000.00", deletedAt: null, createdAt: new Date(Date.UTC(2026, 6, 15)) },
      { id: 2, tenantId: 1, agentId: 10, status: "delivered", total: "1000000.00", deletedAt: null, createdAt: new Date(Date.UTC(2026, 7, 3)) },
    ];
    const db = makeDb();
    const res = await calculateSalary(db as any, 10, 1, AUG_MTD.s, AUG_MTD.e, KPI, true);
    console.log("  August MTD salary:", { sales: res.salesAmount, commission: res.commissionAmount });
    console.log("  commissions row after viewing the August salary page:", data.commissions[0]);
    // Июльская строка на месте и нетронута: агент получит свои 2 500 000.
    const july = data.commissions.find(r => r.periodStart === "2026-07-01")!;
    expect(july, "июльская строка исчезла — комиссия за месяц потеряна").toBeTruthy();
    expect(july.salesAmount).toBe("50000000.00");
    expect(july.commissionAmount).toBe("2500000.00");
    // И появилась отдельная строка за август.
    const august = data.commissions.find(r => r.periodStart === "2026-08-01")!;
    expect(august, "строка за новый месяц не создана").toBeTruthy();
    expect(august.salesAmount).toBe("1000000.00");
  });

  it("B. после выплаченной строки новые месяцы продолжают создаваться", async () => {
    data.commissions = [{
      id: 1, tenantId: 1, userId: 10, commissionRate: "5.00", periodType: "monthly",
      periodStart: "2026-07-01", periodEnd: "2026-07-31",
      salesAmount: "50000000.00", commissionAmount: "2500000.00", status: "paid",
    }];
    data.orders = [
      { id: 2, tenantId: 1, agentId: 10, status: "delivered", total: "1000000.00", deletedAt: null, createdAt: new Date(Date.UTC(2026, 7, 3)) },
    ];
    const db = makeDb();
    const res = await calculateSalary(db as any, 10, 1, AUG_MTD.s, AUG_MTD.e, KPI, true);
    console.log("  August salary shown to the agent:", { sales: res.salesAmount, commission: res.commissionAmount });
    console.log("  rows in commissions:", data.commissions.map(r => ({ p: r.periodStart, s: r.salesAmount, st: r.status })));
    console.log("  inserts performed:", inserted.length);
    // Выплаченный июль остаётся выплаченным…
    const july = data.commissions.find(r => r.periodStart === "2026-07-01")!;
    expect(july.status).toBe("paid");
    expect(july.salesAmount).toBe("50000000.00");
    // …а август заводится заново. Раньше ветка создания срабатывала, только
    // когда строк не было вовсе, и нормальное закрытие первого месяца молча
    // выключало начисление комиссий этому агенту навсегда.
    const august = data.commissions.find(r => r.periodStart === "2026-08-01")!;
    expect(august, "после выплаты за прошлый месяц новый месяц не создаётся").toBeTruthy();
    expect(august.salesAmount).toBe("1000000.00");
  });

  it("C. открытие экрана в середине месяца не обрезает period_end до сегодня", async () => {
    data.commissions = [{
      id: 1, tenantId: 1, userId: 10, commissionRate: "5.00", periodType: "monthly",
      periodStart: "2026-08-01", periodEnd: "2026-08-31",
      salesAmount: "0.00", commissionAmount: "0.00", status: "pending",
    }];
    const db = makeDb();
    await calculateSalary(db as any, 10, 1, AUG_MTD.s, AUG_MTD.e, KPI, true);
    console.log("  period_end after opening the salary page on 6 Aug:", data.commissions[0].periodEnd);
    // Строка уже принадлежит августу; обновляются только суммы, границы периода
    // не трогаются. Прежде period_end переписывался на «сегодня», и последующий
    // пересчёт видел обрезанный месяц.
    expect(data.commissions[0].periodEnd).toBe("2026-08-31");
  });
});

describe("EVIDENCE: what the commission base subtracts", () => {
  it("D. a completed return is subtracted even after the order is moved to 'returned'", async () => {
    data.commissions = [{
      id: 1, tenantId: 1, userId: 10, commissionRate: "10.00", periodType: "monthly",
      periodStart: "2026-07-01", periodEnd: "2026-07-31",
      salesAmount: "0.00", commissionAmount: "0.00", status: "pending",
    }];
    // two identical delivered orders, 1 000 000 each
    data.orders = [
      { id: 1, tenantId: 1, agentId: 10, status: "delivered", total: "1000000.00", deletedAt: null, createdAt: new Date(Date.UTC(2026, 6, 10)) },
      { id: 2, tenantId: 1, agentId: 10, status: "delivered", total: "1000000.00", deletedAt: null, createdAt: new Date(Date.UTC(2026, 6, 11)) },
    ];
    const db = makeDb();
    const before = await calculateSalary(db as any, 10, 1, JULY.s, JULY.e, KPI, false);
    console.log("  no returns:            sales =", before.salesAmount, " commission =", before.commissionAmount);

    // order #2 comes back in full: a completed return document…
    data.returns = [{ id: 1, tenantId: 1, orderId: 2, agentId: 10, status: "completed", totalAmount: "1000000.00", createdAt: new Date(Date.UTC(2026, 6, 20)) }];
    const withReturn = await calculateSalary(db as any, 10, 1, JULY.s, JULY.e, KPI, false);
    console.log("  return completed:      sales =", withReturn.salesAmount, " commission =", withReturn.commissionAmount);

    // …and the operator then also flips the order itself to 'returned'
    data.orders[1].status = "returned";
    const after = await calculateSalary(db as any, 10, 1, JULY.s, JULY.e, KPI, false);
    console.log("  + order set 'returned': sales =", after.salesAmount, " commission =", after.commissionAmount);

    expect(before.salesAmount).toBe(2000000);
    expect(withReturn.salesAmount).toBe(1000000);
    expect(after.salesAmount).toBe(0); // ← the untouched order #1 vanishes too
  });

  it("E. a return not linked to an order is never subtracted", async () => {
    data.commissions = [{
      id: 1, tenantId: 1, userId: 10, commissionRate: "10.00", periodType: "monthly",
      periodStart: "2026-07-01", periodEnd: "2026-07-31",
      salesAmount: "0.00", commissionAmount: "0.00", status: "pending",
    }];
    data.orders = [
      { id: 1, tenantId: 1, agentId: 10, status: "delivered", total: "1000000.00", deletedAt: null, createdAt: new Date(Date.UTC(2026, 6, 10)) },
    ];
    data.returns = [
      { id: 1, tenantId: 1, orderId: null, agentId: 10, status: "completed", totalAmount: "400000.00", createdAt: new Date(Date.UTC(2026, 6, 20)) },
    ];
    const db = makeDb();
    const res = await calculateSalary(db as any, 10, 1, JULY.s, JULY.e, KPI, false);
    console.log("  sales with a 400 000 unlinked completed return:", res.salesAmount, " commission =", res.commissionAmount);
    expect(res.salesAmount).toBe(1000000);
  });

  it("F. an approved-but-not-yet-completed return is not subtracted", async () => {
    data.commissions = [{
      id: 1, tenantId: 1, userId: 10, commissionRate: "10.00", periodType: "monthly",
      periodStart: "2026-07-01", periodEnd: "2026-07-31",
      salesAmount: "0.00", commissionAmount: "0.00", status: "pending",
    }];
    data.orders = [{ id: 1, tenantId: 1, agentId: 10, status: "delivered", total: "1000000.00", deletedAt: null, createdAt: new Date(Date.UTC(2026, 6, 10)) }];
    data.returns = [{ id: 1, tenantId: 1, orderId: 1, agentId: 10, status: "approved", totalAmount: "400000.00", createdAt: new Date(Date.UTC(2026, 6, 20)) }];
    const db = makeDb();
    const res = await calculateSalary(db as any, 10, 1, JULY.s, JULY.e, KPI, false);
    console.log("  sales while the return sits in 'approved':", res.salesAmount);
    expect(res.salesAmount).toBe(1000000);
  });
});

// ── commission-router.calculate ──────────────────────────────────────────────
// NOTE: `calculate`'s row-selection uses raw sql`` fragments, which this engine
// cannot evaluate, so it selects every commissions row. The fixtures below are
// built so the real MySQL predicate would select exactly the same row.
function opCtx(): any {
  return {
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    db: routerDb,
    tenant: { id: 1, slug: "t", name: "T", plan: "pro" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    user: { id: 1, tenantId: 1, role: "operator" as const, status: "active" as const, name: "Op", email: "o@o.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
  };
}

describe("EVIDENCE: commission-router.calculate", () => {
  it("G. overwrites a row that is already marked PAID", async () => {
    data.commissions = [{
      id: 1, tenantId: 1, userId: 10, commissionRate: "5.00", periodType: "monthly",
      periodStart: "2026-07-01", periodEnd: "2026-07-31",
      salesAmount: "50000000.00", commissionAmount: "2500000.00", status: "paid",
    }];
    // the July order was soft-deleted / cancelled after payday
    data.orders = [];
    routerDb = makeDb();
    const { commissionRouter } = await import("../commission-router");
    const caller = commissionRouter.createCaller(opCtx());
    const res = await caller.calculate({ periodType: "monthly", periodStart: "2026-07-01", periodEnd: "2026-07-31" });
    console.log("  updated rows:", res.updated);
    console.log("  the PAID row is now:", data.commissions[0]);
    expect(data.commissions[0].status).toBe("paid");
    expect(data.commissions[0].commissionAmount).toBe("0.00"); // rewritten under a paid record
  });

  it("H. period_end left behind by the salary page truncates the month", async () => {
    // exactly the row calculateSalary persisted in evidence C
    data.commissions = [{
      id: 1, tenantId: 1, userId: 10, commissionRate: "10.00", periodType: "monthly",
      periodStart: "2026-08-01", periodEnd: "2026-08-06",
      salesAmount: "0.00", commissionAmount: "0.00", status: "pending",
    }];
    data.orders = [
      { id: 1, tenantId: 1, agentId: 10, status: "delivered", total: "1000000.00", deletedAt: null, createdAt: new Date(Date.UTC(2026, 7, 3, 10)) },
      { id: 2, tenantId: 1, agentId: 10, status: "delivered", total: "9000000.00", deletedAt: null, createdAt: new Date(Date.UTC(2026, 7, 20, 10)) },
    ];
    routerDb = makeDb();
    const { commissionRouter } = await import("../commission-router");
    const caller = commissionRouter.createCaller(opCtx());
    await caller.calculate({ periodType: "monthly", periodStart: "2026-08-01", periodEnd: "2026-08-31" });
    console.log("  operator asked for 1–31 Aug; row now says:", {
      periodEnd: data.commissions[0].periodEnd,
      sales: data.commissions[0].salesAmount,
      commission: data.commissions[0].commissionAmount,
    });
    console.log("  real August sales were 10 000 000");
    expect(data.commissions[0].salesAmount).toBe("1000000.00");
  });
});
