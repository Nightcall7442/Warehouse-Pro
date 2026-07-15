/**
 * Subscription gating tests.
 *
 * Verifies that the billedQuery middleware correctly blocks access when
 * the tenant's subscription is inactive/expired, and allows access when
 * the subscription is active or within the grace period.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

const mockCheckSubscriptionAccess = vi.fn();
vi.mock("../lib/feature-gating", () => ({
  checkSubscriptionAccess: (...args: unknown[]) => mockCheckSubscriptionAccess(...args),
}));

vi.mock("../lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

function makeCtx(tenantId: number, userId: number, role = "operator") {
  return {
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    user: { id: userId, tenantId, role, status: "active" as const, name: "Test", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test", name: "Test Co", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
  };
}

beforeEach(() => {
  mockCheckSubscriptionAccess.mockReset();
});

describe("subscription gating (billedQuery)", () => {
  it("allows access when subscription is active", async () => {
    mockCheckSubscriptionAccess.mockResolvedValue(true);
    const { createRouter, billedQuery } = await import("../middleware");
    const router = createRouter({ secret: billedQuery.query(() => "ok") });
    const caller = router.createCaller(makeCtx(1, 1, "ceo"));
    await expect(caller.secret()).resolves.toBe("ok");
  });

  it("blocks access when subscription is inactive", async () => {
    mockCheckSubscriptionAccess.mockResolvedValue(false);
    const { createRouter, billedQuery } = await import("../middleware");
    const router = createRouter({ secret: billedQuery.query(() => "ok") });
    const caller = router.createCaller(makeCtx(1, 1, "ceo"));
    await expect(caller.secret()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("blocks access when no tenant in context", async () => {
    const { createRouter, billedQuery } = await import("../middleware");
    const router = createRouter({ secret: billedQuery.query(() => "ok") });
    const caller = router.createCaller({ req: new Request("http://x/"), resHeaders: new Headers() });
    await expect(caller.secret()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("blocks access for non-CEO roles (role guard works on top of billing)", async () => {
    mockCheckSubscriptionAccess.mockResolvedValue(true);
    const { createRouter, billedAdmin } = await import("../middleware");
    const router = createRouter({ secret: billedAdmin.query(() => "ok") });
    const caller = router.createCaller(makeCtx(1, 1, "agent"));
    await expect(caller.secret()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("passes the correct tenantId to checkSubscriptionAccess", async () => {
    mockCheckSubscriptionAccess.mockResolvedValue(true);
    const { createRouter, billedQuery } = await import("../middleware");
    const router = createRouter({ secret: billedQuery.query(() => "ok") });
    const caller = router.createCaller(makeCtx(42, 1, "ceo"));
    await caller.secret();
    expect(mockCheckSubscriptionAccess).toHaveBeenCalledWith(42);
  });
});
