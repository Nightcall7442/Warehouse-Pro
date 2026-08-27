/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Отчёты и скорость — проверки по находкам аудита.
 *
 * ── Чем этот стенд отличается от соседних ───────────────────────────────────
 *
 * УСЛОВИЯ (WHERE) разбираются строго: непонятое условие — исключение, а не
 * «считаем выполненным». Иначе проверка «удалённый заказ не попадает в
 * себестоимость» зеленела бы и без самого фильтра — именно так эта ошибка и
 * дожила до продакшена.
 *
 * ВЫРАЖЕНИЯ в SELECT разбираются по мере надобности, и непонятое даёт null.
 * Здесь послабление безопасно и осознанно: колонка, которую тест не проверяет,
 * не может подтвердить ничего ложного, а тянуть в стенд полный разбор
 * DATE_FORMAT ради помесячного графика, к находкам отношения не имеющего, —
 * это стенд ради стенда. Все выражения, по которым тесты СУДЯТ, разбираются
 * честно: COALESCE, SUM, CAST, CASE WHEN, произведение и count.
 *
 * Скорость проверяется тем, что стенд считает обращения к базе. Это ровно то
 * свойство, которое чинили: число round-trip не должно расти вместе с числом
 * визитов или товаров. Проверка «в исходнике нет цикла» такого не умеет.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TrpcContext } from "../context";
import { asTestContext } from "./helpers/test-context";

vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  // Стандартный мок не даёт sql``.as(): продакшен-код называет так колонку
  // производной таблицы в warehouseReports.turnover.
  const base = drizzleMock();
  const tag = base.sql as any;
  const wrapped = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const node: any = { __kind: "sql", strings, values };
      node.as = (alias: string) => ({ ...node, __alias: alias });
      return node;
    },
    tag,
  );
  return { ...base, sql: wrapped };
});

vi.mock("../telegram-router", () => ({
  notifyAdmin: vi.fn(async () => {}),
  tgMessages: { newOrder: vi.fn(() => "mock") },
}));
vi.mock("../lib/feature-gating", () => ({
  hasSubscriptionAccess: vi.fn(async () => true),
  checkSubscriptionAccess: vi.fn(async () => true),
  invalidateSubscriptionAccess: vi.fn(),
}));
vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());
vi.mock("../lib/sse", () => ({ sseBus: { emit: vi.fn() } }));

// Кэш настоящий (Map), а не заглушка: проверка «повторный вызов прогноза не
// ходит в базу» обязана видеть реальное запоминание результата.
vi.mock("../lib/cache", () => {
  const store = new Map<string, unknown>();
  return {
    __store: store,
    withCache: async (key: string, _ttl: number, produce: () => Promise<unknown>) => {
      if (store.has(key)) return store.get(key);
      const value = await produce();
      store.set(key, value);
      return value;
    },
    cache: {
      get: (k: string) => store.get(k),
      set: (k: string, v: unknown) => store.set(k, v),
      invalidate: (k: string) => store.delete(k),
      invalidatePrefix: () => {},
    },
    CacheKeys: { dashboardKpis: (id: number) => `kpis:${id}`, commissions: (id: number) => `commissions:${id}` },
    CacheTTL: { kpis: 60_000, commissions: 60_000 },
  };
});

let mockDb: any;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

import {
  orders, orderItems, products, arrivals, arrivalItems, warehouseStock,
  dailyPlans, shops, agentLocations, commissions, returns, salesTargets, users,
} from "@db/schema";
import { makeConditionEvaluator } from "./helpers/fake-conditions";
import { calculateFraudMetrics } from "../services/anti-fraud";
import { predictStockouts } from "../services/stock-predictor";
import { calculateSalary } from "../services/kpi";
import * as cacheModule from "../lib/cache";

// ─────────────────────────────────────────────────────────────────────────────
// Поддельная база
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const TABLES: Record<string, unknown> = {
  orders, orderItems, products, arrivals, arrivalItems, warehouseStock,
  dailyPlans, shops, agentLocations, commissions, returns, salesTargets, users,
};

/** Колонка → «таблица.поле». Ключ уникален, поэтому склейка join'ов однозначна. */
const colKey = new Map<unknown, string>();
const tableOf = new Map<unknown, string>();
for (const [name, table] of Object.entries(TABLES)) {
  tableOf.set(table, name);
  for (const [field, col] of Object.entries(table as object)) {
    if (col && typeof col === "object") colKey.set(col, `${name}.${field}`);
  }
}

/** Данные стенда: имя таблицы → строки в camelCase. */
let data: Record<string, Row[]> = {};
/** Сколько обращений к базе сделал проверяемый код. */
let queryCount = 0;
let nextId = 1000;

function reset() {
  data = Object.fromEntries(Object.keys(TABLES).map(n => [n, [] as Row[]]));
  queryCount = 0;
  nextId = 1000;
  (cacheModule as any).__store.clear();
}

/** Строка таблицы в пространстве имён «таблица.поле». */
function namespaced(table: string, row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[`${table}.${k}`] = v;
  return out;
}

function fieldOf(col: unknown): string | undefined {
  return colKey.get(col);
}

/**
 * Сырой sql`` в условии. Поддерживаются сравнения вида `${колонка} ОП значение`,
 * сцепленные через AND (так устроены помощники date-range и фильтры периода).
 * Всё остальное — исключение: молчаливое «истина» здесь обесценило бы тесты.
 */
function rawSqlCondition(cond: Row, row: Row): boolean {
  const strings = (cond.strings ?? []) as string[];
  const values = (cond.values ?? []) as unknown[];
  const cmp = (a: unknown, op: string, b: unknown): boolean => {
    // Колонка типа timestamp против строкового литерала «2026-08-20 23:59:59» —
    // ровно так пишут фильтры периода. Сравнивать их как строки нельзя: слева
    // окажется число миллисекунд, и любое сравнение станет случайным.
    const bothTimes = a instanceof Date || b instanceof Date;
    const toTime = (v: unknown) => (v instanceof Date ? v.getTime() : Date.parse(String(v)));
    if (bothTimes) {
      const x = toTime(a), y = toTime(b);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`Стенд не смог сравнить «${String(a)}» и «${String(b)}» как моменты времени`);
      }
      switch (op) {
        case ">=": return x >= y;
        case "<=": return x <= y;
        case ">": return x > y;
        case "<": return x < y;
        case "=": return x === y;
        default: throw new Error(`Стенд не знает оператора «${op}» в сыром sql`);
      }
    }
    const an = Number(a), bn = Number(b);
    const numeric = a !== "" && b !== "" && Number.isFinite(an) && Number.isFinite(bn);
    const [x, y]: [any, any] = numeric ? [an, bn] : [String(a ?? ""), String(b ?? "")];
    switch (op) {
      case ">=": return x >= y;
      case "<=": return x <= y;
      case ">": return x > y;
      case "<": return x < y;
      case "=": return x === y;
      default: throw new Error(`Стенд не знает оператора «${op}» в сыром sql`);
    }
  };
  const valueOf = (col: unknown): unknown => {
    const key = fieldOf(col);
    if (key === undefined) throw new Error("Сырой sql ссылается на неизвестную колонку");
    if (!(key in row)) throw new Error(`Строка стенда не содержит «${key}»`);
    return row[key];
  };

  let ok = true;
  let handled = false;
  for (let i = 0; i < values.length; i += 2) {
    const opText = (strings[i + 1] ?? "").trim();
    if (i + 1 < values.length) {
      const m = opText.match(/^(>=|<=|>|<|=)$/);
      if (!m) throw new Error(`Стенд не разбирает сырое условие «${strings.join("?")}»`);
      ok = ok && cmp(valueOf(values[i]), m[1], values[i + 1]);
      const sep = (strings[i + 2] ?? "").trim();
      if (sep !== "" && sep.toUpperCase() !== "AND") {
        throw new Error(`Стенд не разбирает связку «${sep}» в сыром sql`);
      }
    } else {
      // Хвост вида `${колонка} > 0` — значение написано прямо в строке.
      const m = opText.match(/^(>=|<=|>|<|=)\s*(.+)$/);
      if (!m) throw new Error(`Стенд не разбирает сырое условие «${strings.join("?")}»`);
      ok = ok && cmp(valueOf(values[i]), m[1], m[2].replace(/^'|'$/g, ""));
    }
    handled = true;
  }
  if (!handled) throw new Error(`Стенд не разбирает сырое условие «${strings.join("?")}»`);
  return ok;
}

const evalCond = makeConditionEvaluator({
  fieldOf,
  treatMissingColumnAsMatch: false,
  rawSql: rawSqlCondition,
});

// ── Разбор выражений SELECT ─────────────────────────────────────────────────

/** Текст выражения с плейсхолдерами #0, #1 … и список подставленных узлов. */
function flatten(def: any): { text: string; args: unknown[] } {
  const strings = (def.strings ?? []) as string[];
  const values = (def.values ?? []) as unknown[];
  let text = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) text += `#${i}${strings[i + 1] ?? ""}`;
  return { text, args: values };
}

/** Разбить по разделителю верхнего уровня, не заглядывая внутрь скобок. */
function splitTop(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && text.startsWith(sep, i)) {
      out.push(text.slice(start, i));
      i += sep.length - 1;
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

const UNSUPPORTED = Symbol("выражение стенду незнакомо");

function evalExpr(text: string, args: unknown[], rows: Row[], row: Row, from: string): unknown {
  const t = text.trim();

  let m = t.match(/^COALESCE\((.*)\)$/is);
  if (m) {
    for (const part of splitTop(m[1], ",")) {
      const v = evalExpr(part, args, rows, row, from);
      if (v !== null && v !== undefined && v !== UNSUPPORTED) return v;
    }
    return null;
  }

  if (/^count\(\s*\*\s*\)$/i.test(t)) return rows.length;

  m = t.match(/^count\(\s*DISTINCT\s+(.*)\)$/is);
  if (m) {
    const seen = new Set<string>();
    for (const r of rows) seen.add(String(evalExpr(m[1], args, rows, r, from)));
    return seen.size;
  }

  m = t.match(/^SUM\((.*)\)$/is);
  if (m) {
    let total = 0;
    for (const r of rows) {
      const v = evalExpr(m[1], args, rows, r, from);
      if (v === UNSUPPORTED) return UNSUPPORTED;
      total += Number(v ?? 0);
    }
    return String(total);
  }

  m = t.match(/^CAST\((.*?)\s+AS\s+[^()]*(?:\([^()]*\))?\s*\)$/is);
  if (m) return evalExpr(m[1], args, rows, row, from);

  m = t.match(/^CASE\s+WHEN\s+([\s\S]*?)\s+THEN\s+([\s\S]*?)\s+ELSE\s+([\s\S]*?)\s+END$/i);
  if (m) {
    const [lhs, rhs] = splitTop(m[1], " = ");
    if (rhs === undefined) return UNSUPPORTED;
    const a = evalExpr(lhs, args, rows, row, from);
    const b = evalExpr(rhs, args, rows, row, from);
    return String(a) === String(b)
      ? evalExpr(m[2], args, rows, row, from)
      : evalExpr(m[3], args, rows, row, from);
  }

  const factors = splitTop(t, " * ");
  if (factors.length > 1) {
    return factors.reduce((acc, f) => acc * Number(evalExpr(f, args, rows, row, from) ?? 0), 1);
  }

  m = t.match(/^#(\d+)$/);
  if (m) {
    const arg: any = args[Number(m[1])];
    if (colKey.has(arg)) return row[colKey.get(arg)!] ?? null;
    if (arg?.__kind === "sql") {
      const inner = flatten(arg);
      return evalExpr(inner.text, inner.args, rows, row, from);
    }
    return arg ?? null;
  }

  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^'.*'$/.test(t)) return t.slice(1, -1);

  // Голое имя колонки в snake_case — так написаны sql`commission_rate`
  // и SUM(CAST(total AS …)).
  if (/^[a-z_]+$/.test(t)) {
    const camel = t.replace(/_(\w)/g, (_x, c) => c.toUpperCase());
    const key = `${from}.${camel}`;
    return key in row ? row[key] : null;
  }

  return UNSUPPORTED;
}

function isAggregate(def: any): boolean {
  if (def?.__kind !== "sql") return false;
  const text = (def.strings ?? []).join(" ");
  return /count\(|sum\(/i.test(text);
}

function projectValue(def: any, rows: Row[], row: Row, from: string): unknown {
  if (colKey.has(def)) return row[colKey.get(def)!] ?? null;
  if (def?.__kind === "sql") {
    const { text, args } = flatten(def);
    const v = evalExpr(text, args, rows, row, from);
    return v === UNSUPPORTED ? null : v;
  }
  return null;
}

// ── Построитель запросов ────────────────────────────────────────────────────

interface Pending {
  proj: any;
  from: string;
  rows: Row[];
  groupBy: any[];
  locking: boolean;
  limit?: number;
  cond?: unknown;
}

/** Какие таблицы обслужили производные таблицы — по одному входу на запуск. */
let subqueryRuns: string[] = [];

function runProjection(p: Pending): Row[] {
  const { proj, rows, from } = p;
  if (!proj || typeof proj !== "object") return rows;
  const entries = Object.entries(proj);
  const aggs = entries.filter(([, d]) => isAggregate(d));
  if (aggs.length === 0) {
    return rows.map(r => {
      const out: Row = {};
      for (const [alias, def] of entries) out[alias] = projectValue(def, [r], r, from);
      return out;
    });
  }
  const groups: Row[][] = [];
  if (p.groupBy.length > 0) {
    const byKey = new Map<string, Row[]>();
    for (const r of rows) {
      const key = p.groupBy.map(c => String(projectValue(c, [r], r, from))).join("|");
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(r);
    }
    groups.push(...byKey.values());
  } else {
    groups.push(rows);
  }
  return groups.map(g => {
    const out: Row = {};
    for (const [alias, def] of entries) out[alias] = projectValue(def, g, g[0] ?? {}, from);
    return out;
  });
}

// ── Блокировки: модель next-key lock под SELECT … FOR UPDATE ────────────────
let lockQueue: Promise<void> = Promise.resolve();
let releaseCurrent: (() => void) | null = null;

async function acquireLock(): Promise<void> {
  const previous = lockQueue;
  let release!: () => void;
  lockQueue = new Promise<void>(r => { release = r; });
  await previous;
  releaseCurrent = release;
}
function releaseLock() {
  releaseCurrent?.();
  releaseCurrent = null;
}

function makeDb(): any {
  const db: any = {};

  db.select = (proj?: any) => {
    const state: Pending = { proj, from: "", rows: [], groupBy: [], locking: false };
    const api: any = {};

    api.from = (table: unknown) => {
      if ((table as any)?.__subquery) {
        state.from = (table as any).__subquery;
        state.rows = (table as any).__rows;
      } else {
        state.from = tableOf.get(table) ?? "unknown";
        state.rows = (data[state.from] ?? []).map(r => namespaced(state.from, r));
      }
      return api;
    };

    const join = (other: unknown, cond: any, inner: boolean) => {
      const isSub = Boolean((other as any)?.__subquery);
      const otherName = isSub ? (other as any).__subquery : (tableOf.get(other) ?? "unknown");
      const otherRows: Row[] = isSub
        ? (other as any).__rows
        : (data[otherName] ?? []).map(r => namespaced(otherName, r));
      const leftKey = fieldOf(cond?.col) ?? (cond?.col as any)?.__key;
      const rightKey = fieldOf(cond?.val) ?? (cond?.val as any)?.__key;
      if (!leftKey || !rightKey) throw new Error("Стенд умеет только join по равенству колонок");
      const out: Row[] = [];
      for (const l of state.rows) {
        const matches = otherRows.filter(r => {
          const merged = { ...l, ...r };
          return merged[leftKey] != null && String(merged[leftKey]) === String(merged[rightKey]);
        });
        if (matches.length === 0) { if (!inner) out.push({ ...l }); }
        else for (const r of matches) out.push({ ...l, ...r });
      }
      state.rows = out;
      return api;
    };
    api.leftJoin = (other: unknown, cond: any) => join(other, cond, false);
    api.innerJoin = (other: unknown, cond: any) => join(other, cond, true);

    api.where = (cond: unknown) => {
      state.cond = cond;
      state.rows = state.rows.filter(r => evalCond(r, cond));
      return api;
    };
    api.groupBy = (...cols: any[]) => { state.groupBy = cols; return api; };
    api.orderBy = () => api;
    api.limit = (n: number) => { state.limit = n; return api; };
    api.for = () => { state.locking = true; return api; };

    /** Производная таблица: считается один раз, как и в настоящем SQL. */
    api.as = (alias: string) => {
      const rows = runProjection(state).map(r => {
        const out: Row = {};
        for (const [k, v] of Object.entries(r)) out[`${alias}.${k}`] = v;
        return out;
      });
      subqueryRuns.push(state.from);
      const handle: any = { __subquery: alias, __rows: rows };
      for (const key of Object.keys(state.proj ?? {})) {
        handle[key] = { __key: `${alias}.${key}` };
        colKey.set(handle[key], `${alias}.${key}`);
      }
      return handle;
    };

    api.then = async (resolve: any, reject: any) => {
      try {
        if (state.locking) {
          await acquireLock();
          // Блокирующее чтение перечитывает строки ПОСЛЕ ожидания — так же
          // ведёт себя InnoDB, когда чужая транзакция успела зафиксироваться.
          state.rows = (data[state.from] ?? [])
            .map(r => namespaced(state.from, r))
            .filter(r => evalCond(r, state.cond));
        }
        queryCount++;
        let out = runProjection(state);
        if (typeof state.limit === "number") out = out.slice(0, state.limit);
        return resolve(out);
      } catch (e) { return reject(e); }
    };

    return api;
  };

  db.insert = (table: unknown) => ({
    values: async (v: Row) => {
      queryCount++;
      const name = tableOf.get(table) ?? "unknown";
      const row: Row = { id: nextId++ };
      for (const [k, val] of Object.entries(v)) {
        row[k] = (val as any)?.__kind === "sql" ? (val as any).values?.[0] ?? (val as any).strings?.[0] : val;
      }
      if (row.status === undefined) row.status = "pending";
      (data[name] ??= []).push(row);
      return [{ insertId: row.id }];
    },
  });

  db.update = (table: unknown) => ({
    set: (patch: Row) => ({
      where: async (cond: unknown) => {
        queryCount++;
        const name = tableOf.get(table) ?? "unknown";
        let affected = 0;
        for (const row of data[name] ?? []) {
          if (!evalCond(namespaced(name, row), cond)) continue;
          for (const [k, v] of Object.entries(patch)) {
            row[k] = (v as any)?.__kind === "sql" ? (v as any).values?.[0] : v;
          }
          affected++;
        }
        return { affectedRows: affected };
      },
    }),
  });

  /**
   * Транзакция. Блокировки, взятые внутри, держатся до её конца — как в базе.
   * Кода без транзакции это не касается: он и не блокирует ничего, и потому
   * два одновременных вызова спокойно вставляют по строке каждый.
   */
  db.transaction = async (fn: (tx: any) => Promise<unknown>) => {
    const result = await fn(db);
    releaseLock();
    return result;
  };

  return db;
}

function ctxFor(role: "ceo" | "supervisor"): TrpcContext {
  return asTestContext({
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    db: mockDb,
    tenant: { id: 1, slug: "t", name: "T", plan: "pro" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    user: {
      id: 1, tenantId: 1, role, status: "active" as const, name: "Boss", email: "b@t.uz",
      passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date(),
    },
  });
}

const day = (offset: number): Date => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

beforeEach(() => {
  reset();
  subqueryRuns = [];
  lockQueue = Promise.resolve();
  releaseCurrent = null;
  mockDb = makeDb();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. P&L: себестоимость по удалённым заказам
// ─────────────────────────────────────────────────────────────────────────────

describe("analytics.pnl: себестоимость считается по тем же заказам, что и выручка", () => {
  function seedPnl() {
    // Ошибочно проведённый заказ, который оператор удалил штатным способом.
    data.orders = [
      { id: 1, tenantId: 1, status: "delivered", total: "9000000", discount: "0", paymentMethod: "cash", deletedAt: day(-3), createdAt: day(-3) },
      { id: 2, tenantId: 1, status: "delivered", total: "5000000", discount: "0", paymentMethod: "cash", deletedAt: null, createdAt: day(-2) },
    ];
    data.orderItems = [
      { id: 1, orderId: 1, productId: 1, quantity: "100", deliveredQuantity: null, costPrice: "60000", unitPrice: "90000", subtotal: "9000000" },
      { id: 2, orderId: 2, productId: 1, quantity: "100", deliveredQuantity: null, costPrice: "30000", unitPrice: "50000", subtotal: "5000000" },
    ];
    data.products = [{ id: 1, tenantId: 1, name: "Сахар", code: "S-1", costPrice: "30000", category: "Бакалея", reorderPoint: "10", status: "active", unit: "кг" }];
    data.arrivals = [];
  }

  it("удалённый заказ не даёт себестоимости — валовая прибыль не занижена", async () => {
    seedPnl();
    const { analyticsRouter } = await import("../analytics-router");
    const res: any = await analyticsRouter.createCaller(ctxFor("ceo")).pnl({
      from: ymd(day(-7)), to: ymd(day(0)), compareWithPrev: false,
    });

    // Выручка удалённый заказ уже не видела и раньше.
    expect(res.current.revenue).toBe(5_000_000);
    // А себестоимость видела: было 6 000 000 + 3 000 000.
    expect(res.current.cogs).toBe(3_000_000);
    expect(res.current.grossProfit).toBe(2_000_000);
  });

  it("живой заказ по-прежнему попадает в себестоимость", async () => {
    seedPnl();
    data.orders[0].deletedAt = null;
    const { analyticsRouter } = await import("../analytics-router");
    const res: any = await analyticsRouter.createCaller(ctxFor("ceo")).pnl({
      from: ymd(day(-7)), to: ymd(day(0)), compareWithPrev: false,
    });
    expect(res.current.revenue).toBe(14_000_000);
    expect(res.current.cogs).toBe(9_000_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Дашборд: окно валовой маржи
// ─────────────────────────────────────────────────────────────────────────────

describe("dashboard.kpis: маржа считается по окну, а не по всей истории", () => {
  beforeEach(() => {
    data.orders = [
      // Древний заказ с нулевой маржой — раньше он тянул процент вниз вечно.
      { id: 1, tenantId: 1, status: "delivered", total: "10000000", deletedAt: null, createdAt: day(-400), agentId: 2, shopId: 1 },
      // Свежий заказ: выручка 1 000 000, себестоимость 600 000 → маржа 40 %.
      { id: 2, tenantId: 1, status: "delivered", total: "1000000", deletedAt: null, createdAt: day(-1), agentId: 2, shopId: 1 },
    ];
    data.orderItems = [
      { id: 1, orderId: 1, productId: 1, quantity: "100", deliveredQuantity: null, costPrice: "100000" },
      { id: 2, orderId: 2, productId: 1, quantity: "10", deliveredQuantity: null, costPrice: "60000" },
    ];
    data.products = [{ id: 1, tenantId: 1, name: "Сахар", code: "S-1", costPrice: "60000", status: "active" }];
    data.users = [{ id: 2, tenantId: 1, role: "agent", status: "active", name: "Агент" }];
    data.shops = [{ id: 1, tenantId: 1, name: "Лавка", debt: "0", agentId: 2 }];
    data.warehouseStock = [{ id: 1, tenantId: 1, productId: 1, currentStock: "10", available: "10", reserved: "0" }];
  });

  it("заказ годичной давности в маржу не входит", async () => {
    const { dashboardRouter } = await import("../dashboard-router");
    const res = await dashboardRouter.createCaller(ctxFor("ceo")).kpis();
    // Только свежий заказ: (1 000 000 − 600 000) / 1 000 000 = 40 %.
    // По всей истории было бы (11 000 000 − 10 600 000) / 11 000 000 ≈ 3,6 %.
    expect(res.grossMargin).toBe(40);
  });

  it("свежий заказ вне окна тоже отбрасывается", async () => {
    data.orders[1].createdAt = day(-120);
    data.orders[0].createdAt = day(-121);
    const { dashboardRouter } = await import("../dashboard-router");
    const res = await dashboardRouter.createCaller(ctxFor("ceo")).kpis();
    // Оба заказа старше 90 дней — считать нечего, деления на ноль нет.
    expect(res.grossMargin).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. KPI агента: число запросов не растёт с числом визитов
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateFraudMetrics: обращения к базе не растут вместе с визитами", () => {
  /**
   * `mode: "far"` — магазины за тридцать километров от всех пингов агента;
   * `mode: "near"` — агент действительно стоял у магазина десять минут.
   */
  function seedVisits(visitCount: number, mode: "far" | "near") {
    const AGENT_LAT = "41.300000", AGENT_LNG = "69.240000";
    data.shops = [];
    data.dailyPlans = [];
    for (let i = 0; i < visitCount; i++) {
      const shopId = 100 + i;
      data.shops.push({
        id: shopId, tenantId: 1, name: `Лавка ${i}`,
        gpsLat: mode === "far" ? "41.500000" : AGENT_LAT,
        gpsLng: mode === "far" ? "69.500000" : AGENT_LNG,
        debt: "0", agentId: 7,
      });
      data.dailyPlans.push({
        id: 200 + i, tenantId: 1, agentId: 7, shopId,
        planDate: i % 2 === 0 ? day(-1) : day(-2),
        status: "visited", photoUrl: "p.jpg",
      });
    }
    const ping = (id: number, offset: number, minutes: number) => {
      const at = day(offset);
      at.setMinutes(at.getMinutes() + minutes);
      return { id, tenantId: 1, agentId: 7, lat: AGENT_LAT, lng: AGENT_LNG, createdAt: at };
    };
    data.agentLocations = [ping(1, -1, 0), ping(2, -1, 10), ping(3, -2, 0), ping(4, -2, 10)];
  }

  it("сорок визитов обходятся тем же числом запросов, что и четыре", async () => {
    seedVisits(4, "far");
    const small = await calculateFraudMetrics(mockDb, 7, 1, day(-10), day(0));
    const smallQueries = queryCount;

    reset();
    mockDb = makeDb();
    seedVisits(40, "far");
    const big = await calculateFraudMetrics(mockDb, 7, 1, day(-10), day(0));
    const bigQueries = queryCount;

    expect(small.totalVisits).toBe(4);
    expect(big.totalVisits).toBe(40);
    // Раньше каждый визит стоил трёх ДОПОЛНИТЕЛЬНЫХ запросов: на сорока
    // визитах их было бы больше сотни, и разрыв между прогонами рос бы линейно.
    expect(bigQueries).toBe(smallQueries);
    expect(bigQueries).toBeLessThanOrEqual(8);
  });

  it("визит вдалеке от магазина по-прежнему подозрительный", async () => {
    seedVisits(4, "far");
    const res = await calculateFraudMetrics(mockDb, 7, 1, day(-10), day(0));
    expect(res.suspiciousVisits).toBe(4);
    expect(res.fraudRate).toBe(100);
  });

  it("координаты магазина доезжают до проверки: честный визит даёт длительность", async () => {
    seedVisits(4, "near");
    const res = await calculateFraudMetrics(mockDb, 7, 1, day(-10), day(0));
    // Длительность считается только по пингам ВНУТРИ геозоны магазина, то есть
    // десять минут здесь получаются лишь тогда, когда координаты магазина
    // действительно дошли до verifyVisit из пакетной выборки.
    expect(res.avgVisitDuration).toBe(10);
    expect(res.suspiciousVisits).toBe(0);
    expect(res.fraudRate).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Оборачиваемость: агрегат продаж считается один раз на отчёт
// ─────────────────────────────────────────────────────────────────────────────

describe("warehouseReports.turnover: продажи считаются одним агрегатом", () => {
  beforeEach(() => {
    data.products = [
      { id: 1, tenantId: 1, name: "Сахар", code: "S-1", unit: "кг", costPrice: "1000", unitPrice: "1500", category: "Бакалея", reorderPoint: "5", status: "active" },
      { id: 2, tenantId: 1, name: "Мука", code: "M-1", unit: "кг", costPrice: "800", unitPrice: "1200", category: "Бакалея", reorderPoint: "5", status: "active" },
    ];
    data.warehouseStock = [];
    for (let i = 0; i < 60; i++) {
      data.warehouseStock.push({
        id: 300 + i, tenantId: 1, productId: (i % 2) + 1,
        currentStock: "100", available: "100", reserved: "0", reorderPoint: "5",
      });
    }
    data.orders = [
      { id: 1, tenantId: 1, status: "delivered", total: "1000", deletedAt: null, createdAt: day(-3) },
      { id: 2, tenantId: 1, status: "delivered", total: "1000", deletedAt: null, createdAt: day(-2) },
      // Удалённый заказ в продажи не идёт — общий помощник это гарантирует.
      { id: 3, tenantId: 1, status: "delivered", total: "9999", deletedAt: day(-2), createdAt: day(-2) },
    ];
    data.orderItems = [
      { id: 1, orderId: 1, productId: 1, quantity: "30", deliveredQuantity: null, costPrice: "1000" },
      { id: 2, orderId: 2, productId: 1, quantity: "20", deliveredQuantity: null, costPrice: "1000" },
      { id: 3, orderId: 2, productId: 2, quantity: "5", deliveredQuantity: null, costPrice: "800" },
      { id: 4, orderId: 3, productId: 2, quantity: "500", deliveredQuantity: null, costPrice: "800" },
    ];
  });

  it("шестьдесят строк склада — один агрегат по позициям заказов", async () => {
    const { warehouseReportsRouter } = await import("../warehouse-reports-router");
    const rows: any[] = await warehouseReportsRouter.createCaller(ctxFor("ceo")).turnover({ days: 30 });

    // Раньше SUM по order_items стоял коррелированным подзапросом и в SELECT,
    // и в ORDER BY: он выполнялся для каждой из шестидесяти строк склада, а не
    // один раз на отчёт.
    expect(subqueryRuns.filter(t => t === "orderItems")).toHaveLength(1);

    const sugar = rows.find(r => r.productCode === "S-1");
    const flour = rows.find(r => r.productCode === "M-1");
    expect(Number(sugar.soldQty)).toBe(50);
    expect(Number(flour.soldQty)).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Прогноз исчерпания: групповые запросы и кэш
// ─────────────────────────────────────────────────────────────────────────────

describe("predictStockouts: обращения к базе не растут вместе с товарами", () => {
  function seedProducts(count: number) {
    data.products = [];
    data.warehouseStock = [];
    data.orders = [{ id: 1, tenantId: 1, status: "delivered", total: "1000", deletedAt: null, createdAt: day(-5) }];
    data.orderItems = [];
    data.arrivals = [{ id: 1, tenantId: 1, status: "pending", totalExpense: "0", arrivalDate: day(-1), createdAt: day(-1) }];
    data.arrivalItems = [];
    for (let i = 1; i <= count; i++) {
      data.products.push({ id: i, tenantId: 1, name: `Товар ${i}`, code: `P-${i}`, costPrice: "100", unitPrice: "150", reorderPoint: "10", status: "active", category: "Бакалея", unit: "шт" });
      data.warehouseStock.push({ id: 500 + i, tenantId: 1, productId: i, currentStock: "60", available: "60", reserved: "0", reorderPoint: "10" });
      data.orderItems.push({ id: 600 + i, orderId: 1, productId: i, quantity: "30", deliveredQuantity: null, costPrice: "100" });
      data.arrivalItems.push({ id: 700 + i, arrivalId: 1, productId: i, quantity: "15" });
    }
  }

  it("двадцать пять товаров стоят тех же трёх запросов, что и два", async () => {
    seedProducts(2);
    await predictStockouts(1, 30);
    const smallQueries = queryCount;

    reset();
    mockDb = makeDb();
    seedProducts(25);
    const big = await predictStockouts(1, 30);
    const bigQueries = queryCount;

    expect(big).toHaveLength(25);
    // Раньше на каждую строку склада приходилось два запроса: 25 товаров —
    // это полсотни round-trip подряд плюс начальный.
    expect(bigQueries).toBe(smallQueries);
    expect(bigQueries).toBeLessThanOrEqual(4);
  });

  it("числа сходятся: 30 продаж за 30 дней — один в день, запас с приходом на 75 дней", async () => {
    seedProducts(1);
    const [p] = await predictStockouts(1, 30);
    expect(p.avgDailyConsumption).toBe(1);
    expect(p.pendingArrivals).toBe(15);
    expect(p.daysUntilStockout).toBe(75);
    expect(p.needsReorder).toBe(false);
  });

  it("повторный вызов отдаётся из кэша и в базу не ходит", async () => {
    seedProducts(3);
    await predictStockouts(1, 30);
    const afterFirst = queryCount;
    expect(afterFirst).toBeGreaterThan(0);

    await predictStockouts(1, 30);
    expect(queryCount).toBe(afterFirst);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Комиссия: два одновременных открытия зарплаты
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateSalary: одновременные открытия не плодят строк комиссии", () => {
  const KPI: any = { agentId: 7, agentName: "Агент", kpiScore: 50, fraudRate: 0 };

  beforeEach(() => {
    data.commissions = [{
      id: 1, tenantId: 1, userId: 7, commissionRate: "5.00", periodType: "monthly",
      periodStart: "2026-07-01", periodEnd: "2026-07-31",
      salesAmount: "1000000", commissionAmount: "50000", status: "paid",
    }];
    data.orders = [{ id: 1, tenantId: 1, agentId: 7, status: "delivered", total: "4000000", deletedAt: null, createdAt: new Date(Date.UTC(2026, 7, 3)) }];
    data.returns = [];
    data.salesTargets = [{ id: 1, tenantId: 1, userId: 7, periodType: "monthly", periodStart: "2026-08-01", targetAmount: "2000000" }];
    data.users = [{ id: 7, tenantId: 1, name: "Агент", role: "agent", status: "active" }];
  });

  const AUG = { from: new Date(Date.UTC(2026, 7, 1)), to: new Date(Date.UTC(2026, 7, 6, 23, 59, 59)) };

  it("супервайзер и агент, открывшие экран одновременно, дают ОДНУ строку за месяц", async () => {
    await Promise.all([
      calculateSalary(mockDb, 7, 1, AUG.from, AUG.to, KPI, true),
      calculateSalary(mockDb, 7, 1, AUG.from, AUG.to, KPI, true),
    ]);

    const august = data.commissions.filter(c => String(c.periodStart).slice(0, 10) === "2026-08-01");
    // Раньше оба запроса не видели строки за август и оба её вставляли: у
    // агента было две одинаковые строки, и одобрить с оплатой можно было обе.
    expect(august).toHaveLength(1);
    expect(Number(august[0].commissionAmount)).toBe(200000);
  });

  it("июльская строка со статусом paid остаётся нетронутой", async () => {
    await Promise.all([
      calculateSalary(mockDb, 7, 1, AUG.from, AUG.to, KPI, true),
      calculateSalary(mockDb, 7, 1, AUG.from, AUG.to, KPI, true),
    ]);
    const july = data.commissions.find(c => String(c.periodStart).slice(0, 10) === "2026-07-01")!;
    expect(july.status).toBe("paid");
    expect(Number(july.commissionAmount)).toBe(50000);
  });
});
