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
import * as cookie from "cookie";
import { checkRateLimit } from "../lib/rate-limit";
import { signSessionToken } from "../auth/session";
import { verifyPassword, hashPassword } from "../auth/password";
import { findUserByEmailAnyTenant, updateUserLastSignIn } from "../queries/users";
import { findTenantById, findTenantBySlug } from "../queries/tenants";
import { createTrialSubscription } from "../lib/subscription";

const mockCheckRateLimit = vi.mocked(checkRateLimit);
const mockFindUser = vi.mocked(findUserByEmailAnyTenant);
const mockVerifyPassword = vi.mocked(verifyPassword);
const mockUpdateLastSignIn = vi.mocked(updateUserLastSignIn);
const mockFindTenantById = vi.mocked(findTenantById);
const mockFindTenantBySlug = vi.mocked(findTenantBySlug);
const mockSignToken = vi.mocked(signSessionToken);
const mockCreateTrialSub = vi.mocked(createTrialSubscription);
const mockHashPassword = vi.mocked(hashPassword);
const mockCookieSerialize = vi.mocked(cookie.serialize);

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

function makePublicCtx(): any {
  return {
    req: new Request("http://localhost/auth"),
    resHeaders: new Headers(),
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
  mockFindUser.mockResolvedValue(null);
  mockVerifyPassword.mockResolvedValue(false);
  mockUpdateLastSignIn.mockResolvedValue(undefined);
  mockFindTenantById.mockResolvedValue(null);
  mockFindTenantBySlug.mockResolvedValue(null);
  mockSignToken.mockResolvedValue("mock-jwt-token");
  mockCreateTrialSub.mockResolvedValue(undefined);
  mockHashPassword.mockResolvedValue("mock-hashed-password");
});

// ═══════════════════════════════════════════════════════════════════════════
// auth.me
// ═══════════════════════════════════════════════════════════════════════════
describe("auth.me", () => {
  it("returns current user and tenant when authenticated", async () => {
    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makeAuthCtx(1, 10, "ceo"));
    const result = await caller.me();

    expect(result.id).toBe(10);
    expect(result.name).toBe("Admin User");
    expect(result.email).toBe("admin@test.com");
    expect(result.role).toBe("ceo");
    expect(result.tenant).toEqual({
      id: 1,
      slug: "test-co",
      name: "Test Co",
      plan: "trial",
    });
  });

  it("returns user with correct role and status", async () => {
    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makeAuthCtx(1, 10, "operator"));
    const result = await caller.me();

    expect(result.role).toBe("operator");
    expect(result.status).toBe("active");
  });

  it("returns tenant with plan info", async () => {
    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makeAuthCtx(1, 10, "ceo"));
    const result = await caller.me();

    expect(result.tenant.plan).toBe("trial");
    expect(result.tenant.id).toBe(1);
    expect(result.tenant.slug).toBe("test-co");
    expect(result.tenant.name).toBe("Test Co");
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



// ═══════════════════════════════════════════════════════════════════════════
// auth.login
// ═══════════════════════════════════════════════════════════════════════════
describe("auth.login", () => {
  const loginInput = { email: "admin@test.com", password: "SecurePass123!" };

  function setupSuccessfulLogin() {
    mockFindUser.mockResolvedValue({
      id: 10,
      tenantId: 1,
      name: "Admin",
      email: "admin@test.com",
      passwordHash: "pbkdf2$100000$abc$def",
      role: "ceo",
      status: "active",
    } as any);
    mockVerifyPassword.mockResolvedValue(true);
    mockFindTenantById.mockResolvedValue({
      id: 1,
      slug: "test-co",
      name: "Test Co",
      plan: "trial",
      status: "active",
    } as any);
  }

  it("returns success with correct credentials", async () => {
    setupSuccessfulLogin();
    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makePublicCtx());
    const result = await caller.login(loginInput);

    expect(result.success).toBe(true);
    expect(result.token).toBe("mock-jwt-token");
    expect(result.user.id).toBe(10);
    expect(result.user.email).toBe("admin@test.com");
    expect(result.user.role).toBe("ceo");
    expect(result.user.tenant).toEqual({ id: 1, name: "Test Co", slug: "test-co" });
  });

  it("sets session cookie on success", async () => {
    setupSuccessfulLogin();
    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makePublicCtx());
    await caller.login(loginInput);

    expect(mockCookieSerialize).toHaveBeenCalledWith(
      "app_sid",
      "mock-jwt-token",
      expect.objectContaining({
        httpOnly: true,
        path: "/",
        maxAge: expect.any(Number),
      }),
    );
  });

  it("rejects invalid email", async () => {
    mockFindUser.mockResolvedValue(null);
    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makePublicCtx());

    await expect(caller.login({ email: "nonexistent@test.com", password: "pass" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects invalid password", async () => {
    mockFindUser.mockResolvedValue({
      id: 10, tenantId: 1, name: "Admin", email: "admin@test.com",
      passwordHash: "pbkdf2$100000$abc$def", role: "ceo", status: "active",
    } as any);
    mockVerifyPassword.mockResolvedValue(false);

    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makePublicCtx());

    await expect(caller.login({ email: "admin@test.com", password: "wrong" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("updates lastSignIn timestamp", async () => {
    setupSuccessfulLogin();
    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makePublicCtx());
    await caller.login(loginInput);

    expect(mockUpdateLastSignIn).toHaveBeenCalledWith(10);
  });

  it("rate limits login attempts", async () => {
    mockCheckRateLimit.mockReturnValue(false);

    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makePublicCtx());

    await expect(caller.login(loginInput)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("rejects inactive user account", async () => {
    mockFindUser.mockResolvedValue({
      id: 10, tenantId: 1, name: "Admin", email: "admin@test.com",
      passwordHash: "pbkdf2$100000$abc$def", role: "ceo", status: "suspended",
    } as any);
    mockVerifyPassword.mockResolvedValue(true);

    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makePublicCtx());

    await expect(caller.login(loginInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects suspended tenant", async () => {
    mockFindUser.mockResolvedValue({
      id: 10, tenantId: 1, name: "Admin", email: "admin@test.com",
      passwordHash: "pbkdf2$100000$abc$def", role: "ceo", status: "active",
    } as any);
    mockVerifyPassword.mockResolvedValue(true);
    mockFindTenantById.mockResolvedValue({
      id: 1, slug: "test-co", name: "Test Co", plan: "trial", status: "suspended",
    } as any);

    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makePublicCtx());

    await expect(caller.login(loginInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects when tenant not found", async () => {
    mockFindUser.mockResolvedValue({
      id: 10, tenantId: 1, name: "Admin", email: "admin@test.com",
      passwordHash: "pbkdf2$100000$abc$def", role: "ceo", status: "active",
    } as any);
    mockVerifyPassword.mockResolvedValue(true);
    mockFindTenantById.mockResolvedValue(null);

    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makePublicCtx());

    await expect(caller.login(loginInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("validates email format", async () => {
    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makePublicCtx());

    await expect(caller.login({ email: "not-an-email", password: "pass" }))
      .rejects.toThrow();
  });

  it("validates password is non-empty", async () => {
    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makePublicCtx());

    await expect(caller.login({ email: "a@b.com", password: "" }))
      .rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// auth.logout
// ═══════════════════════════════════════════════════════════════════════════
describe("auth.logout", () => {
  it("clears session cookie", async () => {
    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makeAuthCtx());
    await caller.logout();

    expect(mockCookieSerialize).toHaveBeenCalledWith(
      "app_sid",
      "",
      expect.objectContaining({
        httpOnly: true,
        path: "/",
        maxAge: 0,
        expires: expect.any(Date),
      }),
    );
  });

  it("returns success", async () => {
    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makeAuthCtx());
    const result = await caller.logout();

    expect(result.success).toBe(true);
  });

  it("throws UNAUTHORIZED when not authenticated", async () => {
    const { authRouter } = await import("../auth-router");
    const noAuthCtx: any = {
      req: new Request("http://localhost/auth"),
      resHeaders: new Headers(),
      db: mockDb,
    };
    const caller = authRouter.createCaller(noAuthCtx);
    await expect(caller.logout()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// auth.register
// ═══════════════════════════════════════════════════════════════════════════
describe("auth.register", () => {
  const registerInput = {
    orgName: "New Org",
    name: "Test User",
    email: "new@test.com",
    password: "StrongPass123!",
  };

  it("creates new tenant and user", async () => {
    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makePublicCtx());
    const result = await caller.register(registerInput);

    expect(result.slug).toBe("new-org");
    expect(result.message).toContain("Organisation created");
    expect(mockHashPassword).toHaveBeenCalledWith("StrongPass123!");
  });

  it("creates trial subscription", async () => {
    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makePublicCtx());
    await caller.register(registerInput);

    expect(mockCreateTrialSub).toHaveBeenCalled();
  });

  it("sets session cookie", async () => {
    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makePublicCtx());
    await caller.register(registerInput);

    expect(mockCookieSerialize).toHaveBeenCalledWith(
      "app_sid",
      "mock-jwt-token",
      expect.objectContaining({
        httpOnly: true,
        path: "/",
        maxAge: expect.any(Number),
      }),
    );
  });

  it("rejects duplicate email", async () => {
    usersTable.push({
      id: 200,
      tenantId: 1,
      name: "Existing",
      email: "new@test.com",
      passwordHash: "x",
      role: "agent",
      status: "active",
    });

    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makePublicCtx());

    await expect(caller.register(registerInput)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("validates input — rejects short orgName", async () => {
    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makePublicCtx());

    await expect(caller.register({ ...registerInput, orgName: "A" }))
      .rejects.toThrow();
  });

  it("validates input — rejects invalid email", async () => {
    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makePublicCtx());

    await expect(caller.register({ ...registerInput, email: "bad" }))
      .rejects.toThrow();
  });

  it("validates input — rejects short password", async () => {
    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makePublicCtx());

    await expect(caller.register({ ...registerInput, password: "short" }))
      .rejects.toThrow();
  });

  it("generates slug from orgName", async () => {
    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makePublicCtx());
    const result = await caller.register({ ...registerInput, orgName: "My Awesome Company!" });

    expect(result.slug).toBe("my-awesome-company");
  });

  it("deduplicates slug when it already exists", async () => {
    mockFindTenantBySlug.mockResolvedValueOnce({ id: 1 } as any);
    mockFindTenantBySlug.mockResolvedValueOnce(null);

    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makePublicCtx());
    const result = await caller.register({ ...registerInput, orgName: "Existing Co" });

    expect(result.slug).toMatch(/^existing-co-\d+$/);
    expect(mockFindTenantBySlug).toHaveBeenCalledTimes(2);
  });

  it("rate limits registration attempts", async () => {
    mockCheckRateLimit.mockReturnValue(false);

    const { authRouter } = await import("../auth-router");
    const caller = authRouter.createCaller(makePublicCtx());

    await expect(caller.register(registerInput)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});
