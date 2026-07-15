/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock drizzle-orm ──────────────────────────────────────────────────────
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
  and: (...conds: unknown[]) => ({ __kind: "and", conds }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values }),
  ne: (col: unknown, val: unknown) => ({ __kind: "ne", col, val }),
}));

// ── Mock cookie ───────────────────────────────────────────────────────────
vi.mock("cookie", () => ({
  serialize: vi.fn((name: string, value: string, opts?: Record<string, unknown>) => {
    const parts = [`${name}=${value}`];
    if (opts?.httpOnly) parts.push("HttpOnly");
    if (opts?.path) parts.push(`Path=${opts.path}`);
    if (opts?.secure) parts.push("Secure");
    if (opts?.sameSite) parts.push(`SameSite=${String(opts.sameSite)}`);
    if (opts?.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
    return parts.join("; ");
  }),
}));

// ── Mock lib modules ──────────────────────────────────────────────────────
vi.mock("../lib/env", () => ({
  env: { isProduction: false },
}));

vi.mock("../lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("../lib/feature-gating", () => ({
  checkSubscriptionAccess: vi.fn(async () => true),
}));

vi.mock("../lib/cookies", () => ({
  getSessionCookieOptions: vi.fn(() => ({
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: false,
  })),
}));

// ── Mock auth modules ─────────────────────────────────────────────────────
vi.mock("../auth/session", () => ({
  signSessionToken: vi.fn(async ({ userId }: { userId: number }) => `token-${userId}`),
  verifySessionToken: vi.fn(async () => null),
}));

vi.mock("../auth/password", () => ({
  verifyPassword: vi.fn(async () => false),
  hashPassword: vi.fn(async () => "mock-hashed-password"),
}));

// ── Mock query modules ────────────────────────────────────────────────────
vi.mock("../queries/users", () => ({
  findUserByEmailAnyTenant: vi.fn(async () => null),
  updateUserLastSignIn: vi.fn(async () => {}),
}));

vi.mock("../queries/tenants", () => ({
  findTenantById: vi.fn(async () => null),
  findTenantBySlug: vi.fn(async () => null),
}));

vi.mock("../lib/subscription", () => ({
  createTrialSubscription: vi.fn(async () => {}),
}));

// ── In-memory fake DB ─────────────────────────────────────────────────────
import { tenants, users, settings } from "@db/schema";

interface FakeRow {
  id: number;
  [key: string]: unknown;
}

let usersTable: FakeRow[];
let tenantsTable: FakeRow[];
let settingsTable: FakeRow[];

function resetTables() {
  tenantsTable = [
    { id: 1, slug: "test-co", name: "Test Co", plan: "trial", status: "active", createdAt: new Date(), updatedAt: new Date() },
  ];
  usersTable = [
    { id: 10, tenantId: 1, name: "Admin", email: "admin@test.com", passwordHash: "pbkdf2$100000$abc$def", role: "ceo", status: "active" },
  ];
  settingsTable = [];
}

function tableOf(ref: unknown): string {
  if (ref === tenants) return "tenants";
  if (ref === users) return "users";
  if (ref === settings) return "settings";
  return "other";
}

function rowsFor(table: string): FakeRow[] {
  if (table === "tenants") return tenantsTable;
  if (table === "users") return usersTable;
  if (table === "settings") return settingsTable;
  return [];
}

const columnToFieldName = new Map<unknown, string>();
for (const [field, col] of Object.entries(tenants)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(users)) columnToFieldName.set(col, field);
for (const [field, col] of Object.entries(settings)) columnToFieldName.set(col, field);

function evalCond(row: FakeRow, cond: unknown): boolean {
  if (!cond || typeof cond !== "object") return true;
  const c = cond as Record<string, unknown>;
  if (c.__kind === "and") return (c.conds as unknown[]).every((inner: unknown) => evalCond(row, inner));
  if (c.__kind === "eq") {
    const fieldName = columnToFieldName.get(c.col) ?? (c.col as Record<string, unknown>)?.name ?? c.col;
    return String(row[fieldName as string]) === String(c.val);
  }
  return true;
}

let nextInsertId = 100;

function makeMockDb() {
  function selectBuilder(proj?: unknown) {
    let currentTable = "other";
    const isCount = proj && typeof proj === "object" && !Array.isArray(proj) &&
      (proj as Record<string, unknown>).c && ((proj as Record<string, unknown>).c as Record<string, unknown>).__kind === "sql";

    const api: Record<string, unknown> = {
      from(ref: unknown) {
        currentTable = tableOf(ref);
        return api;
      },
      where(cond: unknown) {
        const filtered = rowsFor(currentTable).filter((r) => evalCond(r, cond));
        if (isCount) return Promise.resolve([{ c: filtered.length }]);
        return Object.assign(Promise.resolve(filtered), {
          limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
        });
      },
      limit(n: number) {
        const rows = rowsFor(currentTable).slice(0, n);
        return Promise.resolve(rows);
      },
    };
    return api;
  }

  return {
    select: selectBuilder,
    insert: (_ref: unknown) => ({
      values(_patch: Record<string, unknown>) {
        const id = nextInsertId++;
        return Promise.resolve([{ insertId: id }]);
      },
    }),
    update: (ref: unknown) => ({
      set(_patch: Record<string, unknown>) {
        return {
          where(cond: unknown) {
            for (const row of rowsFor(tableOf(ref))) {
              if (!evalCond(row, cond)) continue;
              for (const [key, val] of Object.entries(_patch)) {
                row[key] = val;
              }
            }
            return Promise.resolve();
          },
        };
      },
    }),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
    insert: (ref: unknown) => ({
          values(patch: Record<string, unknown>) {
            const table = tableOf(ref);
            const id = nextInsertId++;
            rowsFor(table).push({ id, ...patch });
            return Promise.resolve([{ insertId: id }]);
          },
        }),
      };
      return fn(tx);
    }),
  };
}

let mockDb: ReturnType<typeof makeMockDb>;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

// ── Imports (after mocks) ─────────────────────────────────────────────────
import { checkRateLimit } from "../lib/rate-limit";

const mockCheckRateLimit = vi.mocked(checkRateLimit);

// ── Helpers ────────────────────────────────────────────────────────────────
function makeAuthCtx(tenantId = 1, userId = 10, role = "ceo"): any {
  return {
    req: new Request("http://localhost/auth"),
    resHeaders: new Headers(),
    user: {
      id: userId,
      tenantId,
      role,
      status: "active" as const,
      name: "Admin User",
      email: "admin@test.com",
      passwordHash: "pbkdf2$100000$abc$def",
      avatar: null,
      phone: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignInAt: new Date(),
    },
    tenant: {
      id: tenantId,
      slug: "test-co",
      name: "Test Co",
      plan: "trial" as const,
      status: "active" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    db: mockDb,
  };
}

// ── Default mock implementations ───────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  resetTables();
  nextInsertId = 100;
  mockDb = makeMockDb();
  mockCheckRateLimit.mockReturnValue(true);
});

// ═══════════════════════════════════════════════════════════════════════════
// auth.me
// ═══════════════════════════════════════════════════════════════════════════
describe("auth.me", () => {
  it("returns current user when authenticated", async () => {
    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makeAuthCtx(1, 10, "ceo"));
    const result = await caller.me();

    expect(result.id).toBe(10);
    expect(result.name).toBe("Admin User");
    expect(result.email).toBe("admin@test.com");
    expect(result.role).toBe("ceo");
    expect(result.tenantId).toBe(1);
    expect(result.status).toBe("active");
  });

  it("returns user with correct role", async () => {
    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makeAuthCtx(1, 10, "operator"));
    const result = await caller.me();

    expect(result.role).toBe("operator");
    expect(result.status).toBe("active");
  });

  it("throws UNAUTHORIZED when not authenticated", async () => {
    const { authRouter } = await import("../auth-router");
    const noAuthCtx: any = {
      req: new Request("http://localhost/auth"),
      resHeaders: new Headers(),
      db: mockDb,
    };
    const caller = authRouter.createCaller(noAuthCtx);
    await expect(caller.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
