/**
 * Auth middleware integration tests.
 *
 * Verifies:
 *  - Unauthenticated requests are rejected (UNAUTHORIZED)
 *  - Role-based access control (FORBIDDEN for wrong roles)
 *  - Multi-tenant isolation (tenant context binding)
 *  - Subscription-gated endpoints
 */
import { describe, it, expect, vi } from "vitest";
import { TRPCError } from "@trpc/server";

// ── Mock DB ─────────────────────────────────────────────────────────────────
const mockDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve([]),
        orderBy: () => Promise.resolve([]),
      }),
      limit: () => Promise.resolve([]),
    }),
  }),
  insert: () => ({ values: () => Promise.resolve([{ insertId: 1 }]) }),
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  delete: () => ({ where: () => Promise.resolve() }),
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb)),
};

vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

// ── Helpers ─────────────────────────────────────────────────────────────────
function makeCtx(tenantId: number, userId: number, role = "agent"): any {
  return {
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    user: { id: userId, tenantId, role, status: "active" as const, name: "Test", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test", name: "Test Co", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
    db: mockDb,
  };
}

function makeNoAuthCtx(): any {
  return {
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    db: mockDb,
  };
}

// ── Unauthenticated requests ────────────────────────────────────────────────
describe("auth middleware — unauthenticated rejection", () => {
  it("rejects request with no user in context", async () => {
    const { createRouter, authedQuery } = await import("../middleware");
    const router = createRouter({ test: authedQuery.query(() => "secret") });
    const caller = router.createCaller(makeNoAuthCtx());
    await expect(caller.test()).rejects.toThrow(TRPCError);
  });

  it("rejects request with no tenant in context", async () => {
    const { createRouter, authedQuery } = await import("../middleware");
    const router = createRouter({ test: authedQuery.query(() => "secret") });
    const ctx = makeNoAuthCtx();
    (ctx as any).user = { id: 1, tenantId: 1, role: "ceo" };
    const caller = router.createCaller(ctx);
    await expect(caller.test()).rejects.toThrow(TRPCError);
  });

  it("allows authenticated request with user and tenant", async () => {
    const { createRouter, authedQuery } = await import("../middleware");
    const router = createRouter({ test: authedQuery.query(() => "ok") });
    const caller = router.createCaller(makeCtx(1, 10));
    await expect(caller.test()).resolves.toBe("ok");
  });
});

// ── Role-based access ───────────────────────────────────────────────────────
describe("auth middleware — role-based access", () => {
  it.each([
    ["ceo",          "adminQuery",      true ],
    ["operator",     "adminQuery",      false],
    ["agent",        "adminQuery",      false],
    ["ceo",          "operatorQuery",   true ],
    ["operator",     "operatorQuery",   true ],
    ["agent",        "operatorQuery",   false],
    ["ceo",          "agentQuery",      true ],
    ["operator",     "agentQuery",      true ],
    ["agent",        "agentQuery",      true ],
    ["merchandiser", "agentQuery",      false],
    ["supervisor",   "agentQuery",      false],
    ["ceo",          "supervisorQuery", true ],
    ["supervisor",   "supervisorQuery", true ],
    ["agent",        "supervisorQuery", false],
    ["operator",     "supervisorQuery", false],
    ["merchandiser", "merchQuery",      true ],
    ["supervisor",   "merchQuery",      true ],
    ["agent",        "merchQuery",      false],
    ["operator",     "merchQuery",      false],
  ])("%s can access %s: %s", async (role, queryType, allowed) => {
    const mod = await import("../middleware");
    const guard = (mod as Record<string, unknown>)[queryType] as typeof mod.authedQuery;
    const router = mod.createRouter({ check: guard.query(() => "ok") });
    const caller = router.createCaller(makeCtx(1, 1, role));

    if (allowed) {
      await expect(caller.check()).resolves.toBe("ok");
    } else {
      await expect(caller.check()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("FORBIDDEN response has correct error code", async () => {
    const { createRouter, adminQuery } = await import("../middleware");
    const router = createRouter({ secret: adminQuery.query(() => "admin-data") });
    const caller = router.createCaller(makeCtx(1, 1, "agent"));
    try {
      await caller.secret();
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toMatchObject({ code: "FORBIDDEN" });
      expect((e as TRPCError).message).toMatch(/Insufficient permissions/);
    }
  });
});

// ── Multi-tenant isolation ──────────────────────────────────────────────────
describe("auth middleware — multi-tenant isolation", () => {
  it("tenant ID from JWT determines ctx.tenant.id", async () => {
    const ctx1 = makeCtx(1, 10, "ceo");
    const ctx2 = makeCtx(42, 20, "ceo");
    expect(ctx1.tenant.id).toBe(1);
    expect(ctx2.tenant.id).toBe(42);
    expect(ctx1.user.tenantId).toBe(ctx1.tenant.id);
    expect(ctx2.user.tenantId).toBe(ctx2.tenant.id);
  });

  it("different tenants are isolated from each other", async () => {
    const { createRouter, authedQuery } = await import("../middleware");
    const router = createRouter({
      getTenant: authedQuery.query(({ ctx }) => ({ tenantId: ctx.tenant.id })),
    });

    const caller1 = router.createCaller(makeCtx(1, 10));
    const caller2 = router.createCaller(makeCtx(2, 20));

    const r1 = await caller1.getTenant();
    const r2 = await caller2.getTenant();
    expect(r1.tenantId).toBe(1);
    expect(r2.tenantId).toBe(2);
    expect(r1.tenantId).not.toBe(r2.tenantId);
  });

  it("user without tenant context is rejected", async () => {
    const { createRouter, authedQuery } = await import("../middleware");
    const router = createRouter({ test: authedQuery.query(() => "ok") });

    const ctx: any = {
      req: new Request("http://localhost/"),
      resHeaders: new Headers(),
      user: { id: 1, tenantId: 1, role: "agent", status: "active" as const, name: "Test", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
      db: mockDb,
    };
    const caller = router.createCaller(ctx);
    await expect(caller.test()).rejects.toThrow(TRPCError);
  });
});

// ── Subscription-gated endpoints ────────────────────────────────────────────
describe("auth middleware — subscription gating", () => {
  it("blocks access when subscription is not active", async () => {
    vi.doMock("../lib/feature-gating", () => ({
      checkSubscriptionAccess: vi.fn(async () => false),
    }));
    vi.resetModules();

    const { createRouter, authedQuery } = await import("../middleware");
    const { requireActiveSubscription } = await import("../middleware");
    const gatedQuery = authedQuery.use(requireActiveSubscription);
    const router = createRouter({ gated: gatedQuery.query(() => "premium-data") });
    const caller = router.createCaller(makeCtx(1, 10));
    await expect(caller.gated()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
