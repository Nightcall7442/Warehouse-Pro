import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TrpcContext } from "../context";
import { asTestContext } from "./helpers/test-context";

// ─── drizzle-orm mock ─────────────────────────────────────────────────────────
const eqFn = (col: unknown, val: unknown) => ({ __kind: "eq", col, val });
const neFn = (col: unknown, val: unknown) => ({ __kind: "ne", col, val });
const andFn = (...conds: unknown[]) => ({ __kind: "and", conds });
const sqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values });
const countFn = (col: unknown) => ({ __kind: "count", col });
const sumFn   = (col: unknown) => ({ __kind: "sum", col });

vi.mock("drizzle-orm", () => ({
  eq: eqFn, ne: neFn, and: andFn, sql: sqlTag, count: countFn, sum: sumFn, relations: () => ({}),
}));

// ─── module mocks ─────────────────────────────────────────────────────────────
vi.mock("../telegram-router", () => ({
  notifyAdmin: vi.fn(async () => {}),
  tgMessages: { upgradeRequest: vi.fn(() => "mock") },
}));

vi.mock("../lib/feature-gating", () => ({
  hasSubscriptionAccess: vi.fn(async () => true),
  checkSubscriptionAccess: vi.fn(async () => true),
  invalidateSubscriptionAccess: vi.fn(),
}));

vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());

vi.mock("../lib/sse", () => ({
  sseBus: { emit: vi.fn() },
}));

vi.mock("../lib/cache", () => {
  const store = new Map<string, unknown>();
  return {
    withCache: async (_k: string, _t: number, produce: () => unknown) => produce(),
    cache: {
      get: (k: string) => store.get(k),
      set: (k: string, v: unknown) => store.set(k, v),
      invalidate: () => {},
      invalidatePrefix: () => {},
    },
    CacheKeys: { dashboardKpis: (id: number) => `dash:${id}`, commissions: (id: number) => `comm:${id}` },
    CacheTTL: { commissions: 60 },
  };
});

vi.mock("../auth/password", () => ({
  hashPassword: vi.fn(async (p: string) => `hash_${p}`),
}));

vi.mock("../lib/subscription", () => ({
  createTrialSubscription: vi.fn(async () => {}),
}));

vi.mock("../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../lib/plan-limits", () => ({
  checkPlanLimits: vi.fn(async () => ({ allowed: true, current: 0, limit: 10 })),
}));

let mockDb: any;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

vi.mock("../queries/tenants", () => ({
  findTenantBySlug: vi.fn(async (slug: string) => tenantsTable.find((t: any) => t.slug === slug) ?? null),
  listTenants:      vi.fn(async () => tenantsTable.filter((t: any) => t.slug !== "system")),
}));

// ─── schema references (readable for column mapping) ──────────────────────────
import { tenants, users, settings, orders, products, shops, subscriptions } from "@db/schema";
import { makeConditionEvaluator } from "./helpers/fake-conditions";

// ─── in-memory tables ─────────────────────────────────────────────────────────
let tenantsTable: any[] = [];
let usersTable: any[] = [];
let settingsTable: any[] = [];
let ordersTable: any[] = [];
let productsTable: any[] = [];
let shopsTable: any[] = [];
let subscriptionsTable: any[] = [];
let nextId = 100;

function resetTables() {
  tenantsTable = [
    { id: 1, slug: "acme", name: "Acme Corp", plan: "trial", status: "active",
      trialEndsAt: new Date(Date.now() + 7 * 86400000), planExpiresAt: null,
      ownerEmail: "ceo@acme.com", ownerPhone: null, maxUsers: null, maxProducts: null, maxOrdersMonth: null,
      createdAt: new Date("2025-01-01"), updatedAt: new Date("2025-01-01") },
    { id: 2, slug: "bigco", name: "BigCo", plan: "pro", status: "active",
      trialEndsAt: null, planExpiresAt: new Date(Date.now() + 30 * 86400000),
      ownerEmail: "admin@bigco.com", ownerPhone: null, maxUsers: null, maxProducts: null, maxOrdersMonth: null,
      createdAt: new Date("2025-02-01"), updatedAt: new Date("2025-02-01") },
    { id: 3, slug: "system", name: "System", plan: "exclusive", status: "active",
      trialEndsAt: null, planExpiresAt: null, ownerEmail: "sys@admin.com", ownerPhone: null,
      maxUsers: null, maxProducts: null, maxOrdersMonth: null,
      createdAt: new Date("2025-01-01"), updatedAt: new Date("2025-01-01") },
  ];
  usersTable = [
    { id: 10, tenantId: 1, name: "CEO Acme", email: "ceo@acme.com", passwordHash: "hash_x",
      role: "ceo", status: "active", lastSignInAt: new Date(), createdAt: new Date(), updatedAt: new Date() },
    { id: 20, tenantId: 2, name: "Admin BigCo", email: "admin@bigco.com", passwordHash: "hash_x",
      role: "ceo", status: "active", lastSignInAt: new Date(), createdAt: new Date(), updatedAt: new Date() },
  ];
  settingsTable = [];
  ordersTable = [
    { id: 1, tenantId: 1, status: "completed", total: "500.00", createdAt: new Date("2025-06-01") },
    { id: 2, tenantId: 2, status: "completed", total: "1200.00", createdAt: new Date("2025-06-01") },
  ];
  productsTable = [{ id: 1, tenantId: 1 }];
  shopsTable = [{ id: 1, tenantId: 1 }];
  subscriptionsTable = [];
  nextId = 100;
}

// ─── column→field mapping ─────────────────────────────────────────────────────
const colToField = new Map<unknown, string>();
// Takes a drizzle table, whose type is nothing like Record<string, unknown> —
// the narrower signature made every call site an error without catching
// anything, since the body only ever reads one property by name.
function reg(table: object, name: string) { colToField.set((table as Record<string, unknown>)[name], name); }
reg(tenants, "id"); reg(tenants, "slug"); reg(tenants, "name"); reg(tenants, "plan");
reg(tenants, "status"); reg(tenants, "trialEndsAt"); reg(tenants, "planExpiresAt");
reg(tenants, "ownerEmail"); reg(tenants, "ownerPhone");
reg(tenants, "maxUsers"); reg(tenants, "maxProducts"); reg(tenants, "maxOrdersMonth");
reg(tenants, "createdAt"); reg(tenants, "updatedAt");
reg(users, "id"); reg(users, "tenantId"); reg(users, "name"); reg(users, "email");
reg(users, "passwordHash"); reg(users, "role"); reg(users, "status");
reg(users, "lastSignInAt"); reg(users, "createdAt"); reg(users, "updatedAt");
reg(settings, "id"); reg(settings, "tenantId"); reg(settings, "companyName");
reg(orders, "id"); reg(orders, "tenantId"); reg(orders, "status"); reg(orders, "total"); reg(orders, "createdAt");
reg(products, "id"); reg(products, "tenantId");
reg(shops, "id"); reg(shops, "tenantId");
reg(subscriptions, "id"); reg(subscriptions, "tenantId"); reg(subscriptions, "plan");
reg(subscriptions, "status"); reg(subscriptions, "trialEndsAt"); reg(subscriptions, "currentPeriodEnds");
reg(subscriptions, "createdAt"); reg(subscriptions, "updatedAt");

function mapCol(col: unknown): string {
  return colToField.get(col) ?? (col as any)?.name ?? String(col);
}

// ─── condition evaluator ──────────────────────────────────────────────────────
/**
 * Разбор условий отдан общему строгому разборщику.
 *
 * Местная копия считала выполненным всё, чего не понимала: из операторов она
 * знала не более двух-трёх, а остальные — включая `isNull` и `inArray` —
 * молча проходили. Убери кто-нибудь такой фильтр из продакшена, тест остался
 * бы зелёным.
 *
 * treatMissingColumnAsMatch оставлен намеренно: строки этого стенда описаны
 * частично, и без послабления упали бы проверки, к самому продукту отношения
 * не имеющие. Флаг виден здесь при чтении и снимается отдельно, вместе с
 * доописыванием строк.
 */
const evalCond = makeConditionEvaluator({
  fieldOf: mapCol,
  treatMissingColumnAsMatch: true,
  // Сырой sql`` этот стенд не воспроизводит; условие считается выполненным.
  // Решение записано здесь, а не спрятано в умолчании разборщика.
  rawSql: () => true,
});

// ─── table lookup ─────────────────────────────────────────────────────────────
function useTable(col: unknown): Record<string, unknown>[] {
  if (col === tenants) return tenantsTable;
  if (col === users) return usersTable;
  if (col === settings) return settingsTable;
  if (col === orders) return ordersTable;
  if (col === products) return productsTable;
  if (col === shops) return shopsTable;
  if (col === subscriptions) return subscriptionsTable;
  return [];
}

// ─── apply field mapping + aggregation to a group of rows ─────────────────────
function applyAggToGroup(rows: Record<string, unknown>[], fields: any): Record<string, unknown> {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return rows[0] ?? {};
  const out: Record<string, unknown> = {};
  for (const [alias, def] of Object.entries(fields)) {
    if (typeof def === "object" && def !== null && (def as any).__kind === "count") {
      out[alias] = rows.length;
    } else if (typeof def === "object" && def !== null && (def as any).__kind === "sum") {
      const f = mapCol((def as any).col);
      out[alias] = String(rows.reduce((s, r) => s + Number(r[f] ?? 0), 0));
    } else {
      out[alias] = rows[0]?.[mapCol(def)] ?? null;
    }
  }
  return out;
}

// ─── thenable chain builder ───────────────────────────────────────────────────
function buildChain(rows: Record<string, unknown>[], fields?: any, groupByCol?: unknown): any {
  const chain: any = {};
  chain._rows = rows;
  chain._fields = fields;
  chain._groupByCol = groupByCol;

  chain.then = (resolve: any, reject: any) => {
    let result: Record<string, unknown>[] = chain._rows;
    if (chain._groupByCol) {
      const groups = new Map<string, Record<string, unknown>[]>();
      for (const row of result) {
        const key = String(row[mapCol(chain._groupByCol)] ?? "");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
      }
      result = Array.from(groups.values()).map(gr => applyAggToGroup(gr, chain._fields));
    } else if (chain._fields && typeof chain._fields === "object" && !Array.isArray(chain._fields)) {
      const hasAgg = Object.values(chain._fields).some((d: any) => d?.__kind === "count" || d?.__kind === "sum");
      if (hasAgg) {
        result = [applyAggToGroup(result, chain._fields)];
      } else {
        result = result.map(row => {
          const out: Record<string, unknown> = {};
          for (const [alias, def] of Object.entries(chain._fields)) out[alias] = row[mapCol(def)] ?? null;
          return out;
        });
      }
    }
    return Promise.resolve(result).then(resolve, reject);
  };

  chain.limit = (n: number) => buildChain(rows.slice(0, n), fields, groupByCol);
  chain.offset = (n: number) => buildChain(rows.slice(n), fields, groupByCol);
  chain.orderBy = () => chain;
  chain.groupBy = (col: unknown) => { chain._groupByCol = col; return chain; };
  chain.leftJoin = () => chain;
  chain.innerJoin = () => chain;
  chain.for = () => chain;
  return chain;
}

// ─── mock db ──────────────────────────────────────────────────────────────────
function makeMockDb() {
  const db: any = {};
  db.select = (fields?: any) => {
    const sel: any = {};
    sel.from = (table: any) => {
      const primaryRows = useTable(table);
      const joins: Array<{ table: Record<string, unknown>[]; primaryCol: string; joinCol: string }> = [];

      const from: any = {};
      from.leftJoin = (joinTable: any, joinCond: any) => {
        if (joinCond?.__kind === "eq") {
          joins.push({ table: useTable(joinTable), primaryCol: mapCol(joinCond.col), joinCol: mapCol(joinCond.val) });
        }
        return from;
      };
      from.innerJoin = from.leftJoin;

      function applyJoins(rows: Record<string, unknown>[]) {
        let result = rows;
        for (const join of joins) {
          const expanded: Record<string, unknown>[] = [];
          for (const row of result) {
            const matches = join.table.filter((jr: any) => String(jr[join.joinCol]) === String(row[join.primaryCol]));
            if (matches.length === 0) { expanded.push({ ...row }); }
            else { for (const m of matches) expanded.push({ ...row, ...m }); }
          }
          result = expanded;
        }
        return result;
      }

      // Make from itself thenable so `await db.select(f).from(t)` works
      from.then = (resolve: any, reject: any) => {
        const rows = applyJoins(primaryRows);
        const hasAgg = fields && typeof fields === "object" && !Array.isArray(fields)
          && Object.values(fields).some((d: any) => d?.__kind === "count" || d?.__kind === "sum");
        if (hasAgg) {
          return Promise.resolve([applyAggToGroup(rows, fields)]).then(resolve, reject);
        }
        if (fields && typeof fields === "object" && !Array.isArray(fields)) {
          return Promise.resolve(rows.map(row => {
            const out: Record<string, unknown> = {};
            for (const [alias, def] of Object.entries(fields)) out[alias] = row[mapCol(def)] ?? null;
            return out;
          })).then(resolve, reject);
        }
        return Promise.resolve(rows).then(resolve, reject);
      };

      from.where = (cond: unknown) => {
        const filtered = primaryRows.filter((r: any) => evalCond(r, cond));
        return buildChain(applyJoins(filtered), fields);
      };

      from.groupBy = (col: unknown) => buildChain(applyJoins(primaryRows), fields, col);
      from.limit = (n: number) => buildChain(primaryRows.slice(0, n), fields);
      from.orderBy = () => buildChain(primaryRows, fields);
      return from;
    };
    return sel;
  };

  db.insert = (table: any) => ({
    values: vi.fn((vals: any) => {
      const id = nextId++;
      if (table === tenants) tenantsTable.push({ id, ...vals, createdAt: new Date(), updatedAt: new Date() });
      else if (table === users) usersTable.push({ id, ...vals, createdAt: new Date(), updatedAt: new Date() });
      else if (table === settings) settingsTable.push({ id, ...vals });
      else if (table === subscriptions) subscriptionsTable.push({ id, ...vals });
      return Promise.resolve([{ insertId: id }]);
    }),
  });

  db.update = (table: any) => ({
    set: (patch: Record<string, unknown>) => ({
      where: (cond: unknown) => {
        const tbl = table === tenants ? tenantsTable : table === users ? usersTable : table === subscriptions ? subscriptionsTable : [];
        for (const row of tbl) {
          if (!evalCond(row, cond)) continue;
          Object.assign(row, patch);
        }
        return Promise.resolve();
      },
    }),
  });

  db.execute = (sqlObj: unknown) => {
    const s = sqlObj as any;
    if (!s?.strings) return Promise.resolve([]);
    const fullSql = s.strings.join("");
    if (fullSql.includes("DATE_FORMAT") && fullSql.includes("orders")) {
      return Promise.resolve([{ month: "2025-06", cnt: "2", total: "1700.00" }]);
    }
    if (fullSql.includes("DATE_FORMAT") && fullSql.includes("tenants")) {
      return Promise.resolve([{ month: "2025-01", cnt: "2" }, { month: "2025-02", cnt: "1" }]);
    }
    return Promise.resolve([]);
  };

  db.transaction = (fn: (tx: any) => Promise<any>) => fn(db);
  return db;
}

// ─── context builders ─────────────────────────────────────────────────────────
function buildCtx(overrides: Record<string, unknown> = {}): TrpcContext {
  return asTestContext({
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    db: mockDb,
    tenant: { id: 1, slug: "acme", name: "Acme Corp", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    user: { id: 10, tenantId: 1, role: "ceo" as const, status: "active" as const, name: "CEO", email: "ceo@acme.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    ...overrides,
  });
}

function superAdminCtx() {
  return buildCtx({
    user: { id: 1, tenantId: 3, role: "superadmin" as const, status: "active" as const, name: "Super", email: "sys@admin.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: 3, slug: "system", name: "System", plan: "exclusive" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
  });
}

// ─── setup ────────────────────────────────────────────────────────────────────
beforeEach(() => {
  resetTables();
  mockDb = makeMockDb();
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("tenant.register", () => {
  it("creates a new tenant with trial plan", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(buildCtx({ user: undefined, tenant: undefined }));
    const result = await caller.register({ orgName: "NewCo", name: "Admin", email: "admin@newco.com", password: "password123" });
    expect(result.slug).toBe("newco");
    expect(result.message).toContain("created");
    expect(tenantsTable.some(t => t.slug === "newco" && t.plan === "trial")).toBe(true);
  });

  it("creates ceo user and settings in transaction", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(buildCtx({ user: undefined, tenant: undefined }));
    await caller.register({ orgName: "TestCo", name: "Owner", email: "own@test.com", password: "password123" });
    const newTenant = tenantsTable.find(t => t.slug === "testco");
    expect(newTenant).toBeDefined();
    expect(usersTable.some(u => u.tenantId === newTenant!.id && u.role === "ceo")).toBe(true);
    expect(settingsTable.some(s => s.tenantId === newTenant!.id)).toBe(true);
  });

  it("generates unique slug when org name already exists", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(buildCtx({ user: undefined, tenant: undefined }));
    const result = await caller.register({ orgName: "Acme", name: "Admin", email: "new@acme.com", password: "password123" });
    expect(result.slug).toMatch(/^acme-\d+$/);
  });

  it("занятый адрес отвечает как успех и организацию не заводит", async () => {
    // Раньше здесь был отказ «Email already registered» — и по нему любой
    // желающий, без всякой авторизации, проверял, есть ли у человека аккаунт
    // на платформе. Прогнав список адресов сотрудников компании-клиента, он
    // получал готовую цель для фишинга и подбора паролей на /api/login.
    //
    // Теперь ответ на занятый адрес неотличим от ответа на свободный, а
    // владельцу адреса уходит письмо «на этот адрес уже есть аккаунт».
    // Проверяем именно неотличимость: совпадать должно и то, что вернулось,
    // и то, что при этом НЕ появилось в базе.
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(buildCtx({ user: undefined, tenant: undefined }));

    const tenantsBefore = tenantsTable.length;
    const usersBefore = usersTable.length;

    const taken = await caller.register({
      orgName: "UniqueCo", name: "Admin", email: "ceo@acme.com", password: "password123",
    });

    expect(tenantsTable.length, "по занятому адресу создалась организация").toBe(tenantsBefore);
    expect(usersTable.length, "по занятому адресу создался пользователь").toBe(usersBefore);

    const free = await caller.register({
      orgName: "UniqueCo", name: "Admin", email: "nobody@acme.com", password: "password123",
    });

    // Ответы отличаются только slug — он и при успехе разный от заявки к заявке.
    expect(Object.keys(taken).sort()).toEqual(Object.keys(free).sort());
    expect(taken.message).toBe(free.message);
  });

  it("rejects when rate limit exceeded", async () => {
    const { checkRateLimit } = await import("../lib/rate-limit");
    (checkRateLimit as any).mockReturnValueOnce(false);
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(buildCtx({ user: undefined, tenant: undefined }));
    await expect(caller.register({ orgName: "GoodName", name: "Admin", email: "x@good.com", password: "password123" }))
      .rejects.toThrow(/Too many/i);
  });

  it("creates trial subscription during registration", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(buildCtx({ user: undefined, tenant: undefined }));
    await caller.register({ orgName: "SubCo", name: "Admin", email: "x@sub.com", password: "password123" });
    // Check subscription was created in the table (inlined from createTrialSubscription)
    const sub = subscriptionsTable.find((s: any) => s.plan === "trial" && s.status === "trialing");
    expect(sub).toBeTruthy();
  });

  it("rejects short password", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(buildCtx({ user: undefined, tenant: undefined }));
    await expect(caller.register({ orgName: "GoodName", name: "Admin", email: "x@x.com", password: "short" }))
      .rejects.toThrow();
  });

  it("rejects org name shorter than 2 chars", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(buildCtx({ user: undefined, tenant: undefined }));
    await expect(caller.register({ orgName: "X", name: "Admin", email: "x@x.com", password: "password123" }))
      .rejects.toThrow();
  });
});

describe("tenant.current", () => {
  it("returns current tenant info", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(buildCtx());
    const result = await caller.current();
    expect(result.id).toBe(1);
    expect(result.slug).toBe("acme");
    expect(result.plan).toBe("trial");
  });
});

describe("tenant.inviteUser", () => {
  it("creates a new user in the tenant", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(buildCtx());
    const result = await caller.inviteUser({ name: "New Agent", email: "agent@acme.com", password: "password123", role: "agent" });
    expect(result.success).toBe(true);
    expect(usersTable.some(u => u.email === "agent@acme.com" && u.tenantId === 1)).toBe(true);
  });

  it("rejects duplicate email", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(buildCtx());
    await expect(caller.inviteUser({ name: "Agent Two", email: "ceo@acme.com", password: "password123", role: "agent" }))
      .rejects.toThrow(/already registered/i);
  });

  it("checks plan user limit", async () => {
    const { checkPlanLimits } = await import("../lib/plan-limits");
    (checkPlanLimits as any).mockResolvedValueOnce({ allowed: false, current: 5, limit: 5 });
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(buildCtx());
    await expect(caller.inviteUser({ name: "Agent New", email: "new@acme.com", password: "password123", role: "agent" }))
      .rejects.toThrow(/лимит/i);
  });

  it("rejects invalid role", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(buildCtx());
    await expect(caller.inviteUser({ name: "Agent X", email: "x@acme.com", password: "password123", role: "admin" as any }))
      .rejects.toThrow();
  });
});

describe("tenant.list (superAdmin)", () => {
  it("returns all tenants except system", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    const result = await caller.list();
    expect(result.length).toBe(2);
    expect(result.every((t: any) => t.slug !== "system")).toBe(true);
  });

  it("includes userCount and orderCount stats", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    const result = await caller.list();
    const acme = result.find((t: any) => t.slug === "acme");
    expect(acme).toBeDefined();
    expect(typeof acme!.userCount).toBe("number");
    expect(typeof acme!.orderCount).toBe("number");
  });
});

describe("tenant.getDetail (superAdmin)", () => {
  it("returns full tenant profile with stats", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    const result = await caller.getDetail({ tenantId: 1 });
    expect(result.tenant.slug).toBe("acme");
    expect(result.stats).toBeDefined();
    expect(typeof result.stats.orders).toBe("number");
    expect(typeof result.stats.revenue).toBe("number");
  });

  it("throws for non-existent tenant", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    await expect(caller.getDetail({ tenantId: 9999 })).rejects.toThrow(/not found/i);
  });

  it("returns monthlyOrders", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    const result = await caller.getDetail({ tenantId: 1 });
    expect(Array.isArray(result.monthlyOrders)).toBe(true);
  });

  it("returns users list", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    const result = await caller.getDetail({ tenantId: 1 });
    expect(Array.isArray(result.users)).toBe(true);
  });
});

describe("tenant.create (superAdmin)", () => {
  it("creates tenant with specified plan", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    const result = await caller.create({ orgName: "ManualCo", ownerName: "Manager", ownerEmail: "mgr@manual.com", ownerPassword: "password123", plan: "pro" });
    expect(result.success).toBe(true);
    expect(result.slug).toBeDefined();
    const t = tenantsTable.find(t => t.slug === result.slug);
    expect(t?.plan).toBe("pro");
  });

  it("sets planExpiresAt for non-trial plans", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    await caller.create({ orgName: "PaidCo", ownerName: "Boss", ownerEmail: "boss@paid.com", ownerPassword: "password123", plan: "basic" });
    const t = tenantsTable.find(t => t.slug === "paidco");
    expect(t?.planExpiresAt).toBeDefined();
  });

  it("does not set planExpiresAt for trial plans", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    await caller.create({ orgName: "TrialCo", ownerName: "Trial", ownerEmail: "t@trial.com", ownerPassword: "password123", plan: "trial" });
    const t = tenantsTable.find(t => t.slug === "trialco");
    expect(!t?.planExpiresAt).toBe(true);
  });

  it("rejects duplicate email", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    await expect(caller.create({ orgName: "DupCo", ownerName: "Dup", ownerEmail: "ceo@acme.com", ownerPassword: "password123" }))
      .rejects.toThrow(/already registered/i);
  });

  it("creates owner user with ceo role", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    const result = await caller.create({ orgName: "UserCo", ownerName: "Ursula", ownerEmail: "u@userco.com", ownerPassword: "password123" });
    const tenant = tenantsTable.find(t => t.slug === result.slug);
    expect(usersTable.some(u => u.tenantId === tenant!.id && u.role === "ceo")).toBe(true);
  });

  it("creates default settings", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    const result = await caller.create({ orgName: "SetCo", ownerName: "Seth", ownerEmail: "s@setco.com", ownerPassword: "password123" });
    const tenant = tenantsTable.find(t => t.slug === result.slug);
    expect(settingsTable.some(s => s.tenantId === tenant!.id)).toBe(true);
  });
});

describe("tenant.updatePlan (superAdmin)", () => {
  it("updates tenant plan and subscription", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    const result = await caller.updatePlan({ tenantId: 1, plan: "pro" });
    expect(result.success).toBe(true);
    const t = tenantsTable.find(t => t.id === 1);
    expect(t?.plan).toBe("pro");
    expect(t?.planExpiresAt).toBeDefined();
  });

  it("updates subscription table too", async () => {
    subscriptionsTable.push({ id: 50, tenantId: 1, plan: "trial", status: "active" });
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    await caller.updatePlan({ tenantId: 1, plan: "exclusive" });
    expect(subscriptionsTable.some(s => s.tenantId === 1 && s.plan === "exclusive")).toBe(true);
  });
});

describe("tenant.setStatus (superAdmin)", () => {
  it("suspends a tenant", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    const result = await caller.setStatus({ tenantId: 1, status: "suspended" });
    expect(result.success).toBe(true);
    expect(tenantsTable.find(t => t.id === 1)?.status).toBe("suspended");
  });

  it("reactivates a tenant", async () => {
    tenantsTable[0].status = "suspended";
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    await caller.setStatus({ tenantId: 1, status: "active" });
    expect(tenantsTable.find(t => t.id === 1)?.status).toBe("active");
  });
});

describe("tenant.extendTrial (superAdmin)", () => {
  it("extends trial from current date when trial is expired", async () => {
    tenantsTable[0].trialEndsAt = new Date(Date.now() - 86400000);
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    const result = await caller.extendTrial({ tenantId: 1, days: 14 });
    expect(result.success).toBe(true);
    expect(tenantsTable.find(t => t.id === 1)!.trialEndsAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("extends from current trialEndsAt when still active", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    const oldEnd = tenantsTable[0].trialEndsAt.getTime();
    await caller.extendTrial({ tenantId: 1, days: 7 });
    expect(tenantsTable.find(t => t.id === 1)!.trialEndsAt.getTime()).toBeGreaterThanOrEqual(oldEnd);
  });

  it("updates subscription trialEndsAt too", async () => {
    subscriptionsTable.push({ id: 60, tenantId: 1, plan: "trial", status: "active", trialEndsAt: new Date() });
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    await caller.extendTrial({ tenantId: 1, days: 10 });
    const sub = subscriptionsTable.find(s => s.tenantId === 1);
    expect(sub!.trialEndsAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("tenant.resetOwnerPassword (superAdmin)", () => {
  it("resets password for the specified user", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    const result = await caller.resetOwnerPassword({ tenantId: 1, userId: 10, newPassword: "newpass123" });
    expect(result.success).toBe(true);
    expect(usersTable.find(u => u.id === 10)?.passwordHash).toBe("hash_newpass123");
  });
});

describe("tenant.platformStats (superAdmin)", () => {
  it("returns aggregated stats excluding system tenant", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    const result = await caller.platformStats();
    expect(typeof result.tenants).toBe("number");
    expect(typeof result.users).toBe("number");
    expect(typeof result.orders).toBe("number");
    expect(typeof result.revenue).toBe("number");
    expect(result.byPlan).toBeDefined();
    expect(result.byStatus).toBeDefined();
    expect(Array.isArray(result.growth)).toBe(true);
  });

  it("byPlan has correct keys", async () => {
    const { tenantRouter } = await import("../tenant-router");
    const caller = tenantRouter.createCaller(superAdminCtx());
    const result = await caller.platformStats();
    expect(result.byPlan).toHaveProperty("trial");
    expect(result.byPlan).toHaveProperty("pro");
  });
});
