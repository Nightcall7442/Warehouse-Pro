/**
 * Чужие сущности: ссылки на users и territories, приходящие от клиента.
 *
 * Общая беда всех проверок ниже одна. Таблицы users и territories общие для
 * всей платформы, а идентификатор в них приходит из запроса и записывался как
 * есть. Дальше своя же строка (комиссия, рабочая зона, магазин) соединялась с
 * этой таблицей БЕЗ условия по организации — и отдавала наружу имя сотрудника
 * или название территории другой компании. Перебором так выгружался чужой
 * справочник целиком.
 *
 * Стенд здесь честный: поддельная база разбирает условия соединений, а не
 * игнорирует их. Иначе проверка «в выдаче нет чужого имени» подтверждала бы
 * что угодно — именно потому, что чужое имя не появлялось бы и без правки.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  return drizzleMock();
});

vi.mock("../lib/feature-gating", () => ({
  hasSubscriptionAccess: vi.fn(async () => true),
  checkSubscriptionAccess: vi.fn(async () => true),
  invalidateSubscriptionAccess: vi.fn(),
}));

vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());

vi.mock("../lib/sse", () => ({ sseBus: { emit: vi.fn() } }));

vi.mock("../lib/sanitize", () => ({
  sanitizeString: (s: string) => s.replace(/<[^>]*>/g, "").trim(),
  sanitizeSearch: (s: string) => s,
}));

vi.mock("../lib/cache", () => {
  const store = new Map<string, unknown>();
  return {
    withCache: async (key: string, _ttl: number, produce: () => unknown) => {
      if (store.has(key)) return store.get(key);
      const value = await produce();
      store.set(key, value);
      return value;
    },
    cache: {
      get: (key: string) => store.get(key),
      set: (key: string, val: unknown) => store.set(key, val),
      invalidate: (key: string) => store.delete(key),
      invalidatePrefix: (prefix: string) => {
        for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
      },
    },
    CacheKeys: { commissions: (tid: number) => `commissions:${tid}` },
    CacheTTL: { commissions: 60_000, shops: 60_000 },
  };
});

import {
  commissions, users, territories, shops, agentTerritories, agentLocations, orders, returns,
} from "@db/schema";

// ── Поддельная база ──────────────────────────────────────────────────────────
//
// Отличие от соседних стендов: соединения здесь настоящие. leftJoin/innerJoin
// получают условие и оно РАЗБИРАЕТСЯ, включая сравнение колонки с колонкой.
// Без этого ни одну из находок про «чужое имя в выдаче» проверить нельзя:
// стенд, игнорирующий условие соединения, зелен и до правки, и после.

type Row = Record<string, unknown>;
/** Строка запроса: имя таблицы → её часть строки (null у не совпавшего LEFT JOIN). */
type Joined = Record<string, Row | null>;

const TABLES: Record<string, object> = {
  commissions, users, territories, shops, agentTerritories, agentLocations, orders, returns,
};

const colInfo = new Map<unknown, { table: string; field: string }>();
const tableName = new Map<unknown, string>();
for (const [name, table] of Object.entries(TABLES)) {
  tableName.set(table, name);
  for (const [field, col] of Object.entries(table)) {
    if (col && typeof col === "object" && !colInfo.has(col)) colInfo.set(col, { table: name, field });
  }
}

let data: Record<string, Row[]>;
/** Сколько операторов UPDATE ушло в базу — по нему проверяется пакетная запись. */
let updateStatements = 0;
let nextId = 100;

function resolve(joined: Joined, col: unknown): unknown {
  const info = colInfo.get(col);
  if (!info) throw new Error("Стенд не знает эту колонку");
  if (!(info.table in joined)) {
    throw new Error(`Запрос ссылается на «${info.table}.${info.field}», но эта таблица в него не входит`);
  }
  const row = joined[info.table];
  if (row === null) return null;
  if (!Object.prototype.hasOwnProperty.call(row, info.field)) {
    throw new Error(`В строке стенда «${info.table}» нет поля «${info.field}» — фильтр по нему ничего не проверит`);
  }
  return row[info.field];
}

function loose(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a !== "" && b !== "") {
    const na = Number(a), nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  }
  return String(a) === String(b);
}

function likeMatch(value: unknown, pattern: unknown): boolean {
  const rx = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${rx}$`, "i").test(String(value ?? ""));
}

function cmp(a: unknown, b: unknown): number {
  const na = a instanceof Date ? a.getTime() : Number(a);
  const nb = b instanceof Date ? b.getTime() : Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  const sa = a instanceof Date ? a.toISOString() : String(a);
  const sb = b instanceof Date ? b.toISOString() : String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** Значение стороны условия: либо колонка, либо литерал. */
function side(joined: Joined, v: unknown): unknown {
  return colInfo.has(v) ? resolve(joined, v) : v;
}

/**
 * Сырой sql``.
 *
 * Разобраны ровно три формы, которые встречаются в проверяемых маршрутах;
 * всё остальное — ошибка, а не молчаливое «условие выполнено». Стенд, который
 * считает непонятое условие истинным, подтверждает что угодно.
 */
function evalRawSql(joined: Joined, cond: any): boolean {
  const strings: string[] = cond.strings ?? [];
  const values: unknown[] = cond.values ?? [];
  const text = strings.join("?");

  // `${col} IN (${sql.join(...)})`
  const list = values.find((v: any) => v?.__kind === "sql_join") as any;
  if (list && /\bIN\b/i.test(text) && colInfo.has(values[0])) {
    const ids = (list.chunks as any[]).map(c => (c?.values ? c.values[0] : c));
    return ids.some(id => loose(resolve(joined, values[0]), id));
  }

  // `${col} IS NOT NULL [AND ${col2} IS NOT NULL]`
  if (/IS NOT NULL/i.test(text)) {
    return values.every(v => (colInfo.has(v) ? resolve(joined, v) != null : true));
  }

  // `(${col} LIKE ${p} OR ${col2} LIKE ${p} …)` — серверный поиск справочника.
  if (/\bLIKE\b/i.test(text)) {
    for (let i = 0; i + 1 < values.length; i += 2) {
      if (colInfo.has(values[i]) && likeMatch(resolve(joined, values[i]), values[i + 1])) return true;
    }
    return false;
  }

  // `${col} <оператор> ${литерал}` — сюда попадают onDate и границы периода.
  if (strings.length === 3 && values.length === 2 && colInfo.has(values[0])) {
    const op = strings[1].trim();
    const c = cmp(resolve(joined, values[0]), values[1]);
    if (op === "=")  return c === 0;
    if (op === ">=") return c >= 0;
    if (op === "<=") return c <= 0;
    if (op === ">")  return c > 0;
    if (op === "<")  return c < 0;
  }

  throw new Error(`Стенд не умеет разбирать sql\`${text}\``);
}

function evalCond(joined: Joined, cond: any): boolean {
  if (cond == null) return true;
  switch (cond.__kind) {
    case "and": return (cond.conds as any[]).every(c => evalCond(joined, c));
    case "or":  return (cond.conds as any[]).some(c => evalCond(joined, c));
    case "not": return !evalCond(joined, cond.conds?.[0] ?? cond.cond);
    case "eq":  return loose(resolve(joined, cond.col), side(joined, cond.val));
    case "ne":  return !loose(resolve(joined, cond.col), side(joined, cond.val));
    case "gt":  return cmp(resolve(joined, cond.col), side(joined, cond.val)) > 0;
    case "gte": return cmp(resolve(joined, cond.col), side(joined, cond.val)) >= 0;
    case "lt":  return cmp(resolve(joined, cond.col), side(joined, cond.val)) < 0;
    case "lte": return cmp(resolve(joined, cond.col), side(joined, cond.val)) <= 0;
    case "isNull":    return resolve(joined, cond.col) == null;
    case "isNotNull": return resolve(joined, cond.col) != null;
    case "inArray":   return (cond.values as unknown[]).some(v => loose(resolve(joined, cond.col), v));
    case "like": return likeMatch(resolve(joined, cond.col), cond.val);
    case "sql": return evalRawSql(joined, cond);
    default: throw new Error(`Стенд не умеет условие «${cond.__kind}»`);
  }
}

function isAggregate(def: any): boolean {
  return def?.__kind === "sql" && /\b(count|sum|max|min|avg)\s*\(/i.test((def.strings ?? []).join("?"));
}

function projectRow(fields: any, group: Joined[]): Row {
  const head = group[0] ?? {};
  const out: Row = {};
  for (const [alias, def] of Object.entries<any>(fields)) {
    if (colInfo.has(def)) { out[alias] = resolve(head, def); continue; }
    if (def?.__kind !== "sql") { out[alias] = null; continue; }

    const text = (def.strings as string[]).join("?");
    const cols = (def.values as unknown[]).filter(v => colInfo.has(v));
    if (/\bcount\s*\(/i.test(text)) {
      out[alias] = group.filter(r => resolve(r, cols[0]) != null).length;
    } else if (/\bsum\s*\(/i.test(text)) {
      out[alias] = String(group.reduce((s, r) => s + Number(resolve(r, cols[0]) ?? 0), 0));
    } else if (/\bmax\s*\(/i.test(text)) {
      out[alias] = group.reduce<number>((m, r) => Math.max(m, Number(resolve(r, cols[0]) ?? 0)), 0);
    } else if (/COALESCE/i.test(text)) {
      out[alias] = cols.map(c => resolve(head, c)).find(v => v != null) ?? null;
    } else {
      // Например photoRef: CASE … — в проверках ниже его значение не важно.
      out[alias] = null;
    }
  }
  return out;
}

function makeBuilder(fields: any) {
  let base: string | null = null;
  let rows: Joined[] = [];
  let groupCol: unknown = null;

  const join = (kind: "left" | "inner", table: unknown, cond: unknown) => {
    const name = tableName.get(table)!;
    const next: Joined[] = [];
    for (const r of rows) {
      const matches = data[name].filter(other => evalCond({ ...r, [name]: other }, cond));
      if (matches.length > 0) for (const m of matches) next.push({ ...r, [name]: m });
      else if (kind === "left") next.push({ ...r, [name]: null });
    }
    rows = next;
    return api;
  };

  const run = (): Row[] => {
    if (!fields) return rows.map(r => ({ ...(r[base!] as Row) }));
    if (groupCol) {
      const groups = new Map<string, Joined[]>();
      for (const r of rows) {
        const key = String(resolve(r, groupCol));
        const bucket = groups.get(key);
        if (bucket) bucket.push(r); else groups.set(key, [r]);
      }
      return [...groups.values()].map(g => projectRow(fields, g));
    }
    // Агрегат без GROUP BY — всегда ровно одна строка, даже над пустым набором.
    if (Object.values(fields).some(isAggregate)) return [projectRow(fields, rows)];
    return rows.map(r => projectRow(fields, [r]));
  };

  const api: any = {
    from(table: unknown) {
      base = tableName.get(table)!;
      rows = data[base].map(r => ({ [base!]: r }));
      return api;
    },
    leftJoin:  (t: unknown, c: unknown) => join("left", t, c),
    innerJoin: (t: unknown, c: unknown) => join("inner", t, c),
    where(cond: unknown) { rows = rows.filter(r => evalCond(r, cond)); return api; },
    groupBy(col: unknown) { groupCol = col; return api; },
    orderBy() { return api; },
    limit(n: number) { rows = rows.slice(0, n); return api; },
    offset(n: number) { rows = rows.slice(n); return api; },
    then(onOk: (v: Row[]) => unknown, onErr?: (e: unknown) => unknown) {
      try { return Promise.resolve(run()).then(onOk, onErr); }
      catch (e) { return onErr ? Promise.resolve(onErr(e)) : Promise.reject(e); }
    },
  };
  return api;
}

/** sql`${x}` в значениях INSERT — распаковываем до самого значения. */
function unwrap(v: unknown): unknown {
  return (v as any)?.__kind === "sql" ? (v as any).values?.[0] ?? null : v;
}

function makeDb(): any {
  return {
    select: (fields?: any) => makeBuilder(fields),
    insert: (table: unknown) => ({
      values: (vals: Row | Row[]) => {
        const name = tableName.get(table)!;
        const list = Array.isArray(vals) ? vals : [vals];
        let last = 0;
        for (const v of list) {
          last = nextId++;
          const row: Row = { id: last };
          for (const [k, val] of Object.entries(v)) row[k] = unwrap(val);
          data[name].push(row);
        }
        return Promise.resolve([{ insertId: last }]);
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Row) => ({
        where: (cond: unknown) => {
          updateStatements++;
          const name = tableName.get(table)!;
          let affected = 0;
          for (const row of data[name]) {
            if (!evalCond({ [name]: row }, cond)) continue;
            for (const [k, v] of Object.entries(patch)) if (v !== undefined) row[k] = unwrap(v);
            affected++;
          }
          return Promise.resolve({ affectedRows: affected });
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: (cond: unknown) => {
        const name = tableName.get(table)!;
        data[name] = data[name].filter(row => !evalCond({ [name]: row }, cond));
        return Promise.resolve({ affectedRows: 0 });
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb),
  };
}

let mockDb: any;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

// ── Данные двух организаций ──────────────────────────────────────────────────
//
// Границы месяца считаются ровно так же, как их считает setRate: он ищет свою
// строку по «YYYY-MM-DD» текущего месяца, и фиксированная дата в фикстуре
// проверяла бы только ветку вставки, никогда не доходя до обновления.
const TODAY = new Date();
const MONTH_START = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1).toISOString().split("T")[0];
const MONTH_END = new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 0).toISOString().split("T")[0];

function reset() {
  updateStatements = 0;
  nextId = 100;
  data = {
    commissions: [
      { id: 1, tenantId: 1, userId: 10, commissionRate: "5.00", periodType: "monthly", periodStart: MONTH_START, periodEnd: MONTH_END, salesAmount: "0.00", commissionAmount: "0.00", status: "pending" },
      { id: 2, tenantId: 1, userId: 11, commissionRate: "4.00", periodType: "monthly", periodStart: MONTH_START, periodEnd: MONTH_END, salesAmount: "5000000.00", commissionAmount: "200000.00", status: "paid" },
    ],
    users: [
      { id: 1, tenantId: 1, name: "Директор A", role: "ceo" },
      { id: 10, tenantId: 1, name: "Агент A1", role: "agent" },
      { id: 11, tenantId: 1, name: "Агент A2", role: "agent" },
      { id: 90, tenantId: 2, name: "Директор ЧУЖОЙ", role: "ceo" },
    ],
    territories: [
      { id: 1, tenantId: 1, name: "Чиланзар", color: "#111111", centerLat: "41.30000000", centerLng: "69.20000000", radiusKm: "50.00" },
      { id: 2, tenantId: 1, name: "Юнусабад", color: "#222222", centerLat: null, centerLng: null, radiusKm: "10.00" },
      { id: 90, tenantId: 2, name: "ЧУЖОЙ филиал", color: "#999999", centerLat: "55.75000000", centerLng: "37.60000000", radiusKm: "10.00" },
    ],
    shops: [
      { id: 1, tenantId: 1, name: "Магазин A1", status: "active", agentId: 10, territoryId: null, gpsLat: "41.30100000", gpsLng: "69.20100000", debt: "100.00", idempotencyKey: null, ownerName: null, phone: null, address: null, city: null, district: null, notes: null, photoUrl: null, updatedAt: new Date() },
      { id: 2, tenantId: 1, name: "Магазин A2", status: "active", agentId: 10, territoryId: null, gpsLat: "41.30200000", gpsLng: "69.20200000", debt: "200.00", idempotencyKey: null, ownerName: null, phone: null, address: null, city: null, district: null, notes: null, photoUrl: null, updatedAt: new Date() },
      { id: 3, tenantId: 1, name: "Магазин A3", status: "active", agentId: 11, territoryId: null, gpsLat: "41.30300000", gpsLng: "69.20300000", debt: "300.00", idempotencyKey: null, ownerName: null, phone: null, address: null, city: null, district: null, notes: null, photoUrl: null, updatedAt: new Date() },
    ],
    agentTerritories: [],
    agentLocations: [],
    orders: [],
    returns: [],
  };
}

function ctx(role: string, userId: number, tenantId = 1): any {
  return {
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    db: mockDb,
    tenant: { id: tenantId, slug: "t", name: "T", plan: "pro" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    user: { id: userId, tenantId, role, status: "active" as const, name: "U", email: "u@u.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
  };
}

beforeEach(() => {
  reset();
  mockDb = makeDb();
});

// ── 1. commission.setRate / commission.list ──────────────────────────────────

describe("commission: ставка чужому сотруднику", () => {
  it("setRate отклоняет userId другой организации и ничего не пишет", async () => {
    const { commissionRouter } = await import("../commission-router");
    const before = data.commissions.length;

    await expect(commissionRouter.createCaller(ctx("operator", 1)).setRate({ userId: 90, commissionRate: 1 }))
      .rejects.toThrow(TRPCError);

    expect(data.commissions).toHaveLength(before);
    expect(data.commissions.some(c => c.userId === 90)).toBe(false);
  });

  it("setRate по-прежнему заводит строку своему сотруднику", async () => {
    const { commissionRouter } = await import("../commission-router");
    const res = await commissionRouter.createCaller(ctx("operator", 1)).setRate({ userId: 10, commissionRate: 7.5 });
    expect(res.success).toBe(true);
    expect(data.commissions.find(c => c.userId === 10)!.commissionRate).toBe("7.50");
  });

  it("list не отдаёт имя владельца чужого аккаунта по строке, записанной до правки", async () => {
    // Ровно то, что лежит в базе после эксплуатации: своя строка, чужой user_id.
    data.commissions.push({
      id: 3, tenantId: 1, userId: 90, commissionRate: "1.00", periodType: "monthly",
      periodStart: MONTH_START, periodEnd: MONTH_END, salesAmount: "0.00", commissionAmount: "0.00", status: "pending",
    });

    const { commissionRouter } = await import("../commission-router");
    const rows = await commissionRouter.createCaller(ctx("operator", 1)).list({});

    const leaked = rows.find((r: any) => r.userId === 90);
    expect(leaked).toBeDefined();
    expect(leaked!.userName).toBeNull();
    expect(rows.some((r: any) => r.userName === "Директор ЧУЖОЙ")).toBe(false);
  });
});

// ── 2. commission.calculate ──────────────────────────────────────────────────

describe("commission.calculate и уже выплаченные строки", () => {
  it("не трогает строку со статусом paid", async () => {
    const { commissionRouter } = await import("../commission-router");
    const res = await commissionRouter.createCaller(ctx("operator", 1))
      .calculate({ periodType: "monthly", periodStart: MONTH_START, periodEnd: MONTH_END });

    const paid = data.commissions.find(c => c.id === 2)!;
    expect(paid.salesAmount).toBe("5000000.00");
    expect(paid.commissionAmount).toBe("200000.00");

    // Строка в статусе pending пересчитана — заказов нет, значит ноль.
    expect(data.commissions.find(c => c.id === 1)!.commissionAmount).toBe("0.00");
    expect(res.updated).toBe(1);
  });
});

// ── 3. agent.setWorkZones / listWorkZones / myWorkZones ──────────────────────

describe("agent: рабочие зоны по чужим территориям", () => {
  it("setWorkZones отклоняет чужой territoryId и НЕ стирает уже назначенные зоны", async () => {
    data.agentTerritories.push({ id: 1, tenantId: 1, agentId: 10, territoryId: 1 });

    const { agentRouter } = await import("../agent-router");
    await expect(agentRouter.createCaller(ctx("supervisor", 1)).setWorkZones({ agentId: 10, territoryIds: [1, 90] }))
      .rejects.toThrow(TRPCError);

    expect(data.agentTerritories).toHaveLength(1);
    expect(data.agentTerritories[0].territoryId).toBe(1);
  });

  it("setWorkZones отклоняет чужого агента", async () => {
    const { agentRouter } = await import("../agent-router");
    await expect(agentRouter.createCaller(ctx("supervisor", 1)).setWorkZones({ agentId: 90, territoryIds: [1] }))
      .rejects.toThrow(TRPCError);
    expect(data.agentTerritories).toHaveLength(0);
  });

  it("setWorkZones назначает свои территории", async () => {
    const { agentRouter } = await import("../agent-router");
    const res = await agentRouter.createCaller(ctx("supervisor", 1)).setWorkZones({ agentId: 10, territoryIds: [1, 2] });
    expect(res.count).toBe(2);
    expect(data.agentTerritories.map(r => r.territoryId).sort()).toEqual([1, 2]);
  });

  it("listWorkZones не показывает название чужой территории по строке, записанной до правки", async () => {
    data.agentTerritories.push({ id: 1, tenantId: 1, agentId: 10, territoryId: 90 });
    data.agentTerritories.push({ id: 2, tenantId: 1, agentId: 10, territoryId: 1 });

    const { agentRouter } = await import("../agent-router");
    const zones = await agentRouter.createCaller(ctx("supervisor", 1)).listWorkZones({ agentId: 10 });

    expect(zones.map((z: any) => z.name)).toEqual(["Чиланзар"]);
  });

  it("myWorkZones не показывает название чужой территории самому агенту", async () => {
    data.agentTerritories.push({ id: 1, tenantId: 1, agentId: 10, territoryId: 90 });

    const { agentRouter } = await import("../agent-router");
    const zones = await agentRouter.createCaller(ctx("agent", 10)).myWorkZones();

    expect(zones).toHaveLength(0);
  });
});

// ── 4. agent.createShop / agent.updateMyShop ─────────────────────────────────

describe("agent: чужая территория в карточке магазина", () => {
  it("createShop отклоняет чужой territoryId и не создаёт магазин", async () => {
    const { agentRouter } = await import("../agent-router");
    await expect(agentRouter.createCaller(ctx("agent", 10)).createShop({ name: "Новый", territoryId: 90 }))
      .rejects.toThrow(TRPCError);
    expect(data.shops).toHaveLength(3);
  });

  it("createShop принимает свой territoryId", async () => {
    const { agentRouter } = await import("../agent-router");
    const res = await agentRouter.createCaller(ctx("agent", 10)).createShop({ name: "Новый", territoryId: 1 });
    expect(data.shops.find(s => s.id === res.id)!.territoryId).toBe(1);
  });

  it("updateMyShop отклоняет чужой territoryId и оставляет карточку как была", async () => {
    const { agentRouter } = await import("../agent-router");
    await expect(agentRouter.createCaller(ctx("agent", 10)).updateMyShop({ id: 1, territoryId: 90 }))
      .rejects.toThrow(TRPCError);
    expect(data.shops.find(s => s.id === 1)!.territoryId).toBeNull();
  });
});

// ── 5. agent.getLocations ────────────────────────────────────────────────────

describe("agent.getLocations: окно по времени", () => {
  it("не поднимает точки старше суток", async () => {
    const now = Date.now();
    data.agentLocations.push(
      { id: 1, tenantId: 1, agentId: 10, lat: "41.30", lng: "69.20", accuracy: null, batteryLevel: null, recordedAt: null, createdAt: new Date(now - 3 * 24 * 60 * 60 * 1000) },
      { id: 2, tenantId: 1, agentId: 11, lat: "41.31", lng: "69.21", accuracy: null, batteryLevel: null, recordedAt: null, createdAt: new Date(now - 60 * 1000) },
    );

    const { agentRouter } = await import("../agent-router");
    const points = await agentRouter.createCaller(ctx("supervisor", 1)).getLocations();

    expect(points.map((p: any) => p.agentId)).toEqual([11]);
  });
});

// ── 6. territory: пакетная запись и чужие магазины в сводке ──────────────────

describe("territory.autoAssign: одна запись на территорию, а не на магазин", () => {
  it("три магазина одной территории закрываются одним UPDATE", async () => {
    const { territoryRouter } = await import("../territory-router");
    updateStatements = 0;

    const res = await territoryRouter.createCaller(ctx("supervisor", 1)).autoAssign();

    expect(res.assigned).toBe(3);
    expect(data.shops.every(s => s.territoryId === 1)).toBe(true);
    expect(updateStatements).toBe(1);
  });
});

describe("territory.update: переразметка тоже одним UPDATE", () => {
  it("radiusKm меняется — магазины привязываются пакетом", async () => {
    const { territoryRouter } = await import("../territory-router");
    updateStatements = 0;

    await territoryRouter.createCaller(ctx("supervisor", 1)).update({ id: 1, radiusKm: 60 });

    expect(data.shops.every(s => s.territoryId === 1)).toBe(true);
    // Один UPDATE на саму территорию и один на всю пачку магазинов.
    expect(updateStatements).toBe(2);
  });
});

describe("territory.list: чужой магазин в счётчиках своей территории", () => {
  it("shopCount и totalDebt считают только свои магазины", async () => {
    data.shops.push({
      id: 90, tenantId: 2, name: "ЧУЖОЙ магазин", status: "active", agentId: null, territoryId: 1,
      gpsLat: null, gpsLng: null, debt: "999999.00", idempotencyKey: null, ownerName: null, phone: null,
      address: null, city: null, district: null, notes: null, photoUrl: null, updatedAt: new Date(),
    });
    data.shops[0].territoryId = 1;

    const { territoryRouter } = await import("../territory-router");
    const rows = await territoryRouter.createCaller(ctx("ceo", 1)).list();

    const own = rows.find((r: any) => r.id === 1)!;
    expect(Number(own.shopCount)).toBe(1);
    expect(Number(own.totalDebt)).toBe(100);
  });
});
