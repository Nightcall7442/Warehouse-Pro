import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkRateLimit } from "../lib/rate-limit";
import { createRouter, authedQuery } from "../middleware";
import type { TrpcContext } from "../context";

/**
 * The bug these tests exist for.
 *
 * rate-limit.test.ts hands the limiter an IP string and checks it counts.
 * It always passed, and the limiter was never the broken part. What was broken
 * was the *key*: getClientIp returned the literal "unknown" whenever no
 * trusted proxy was configured — the default, and the deployed state — so
 * every caller counted against one bucket. authedQuery's 120-per-minute
 * covered the whole platform at once; /api/login's twenty attempts could be
 * spent by any stranger, locking every tenant out for fifteen minutes.
 *
 * A test that supplies the key itself can never catch that. These start from a
 * Request, the way production does.
 */

// ── getClientIp: what it says when it doesn't know ───────────────────────────
describe("getClientIp", () => {
  const original = process.env.TRUSTED_PROXY_COUNT;

  beforeEach(() => vi.resetModules());
  afterEach(() => {
    if (original === undefined) delete process.env.TRUSTED_PROXY_COUNT;
    else process.env.TRUSTED_PROXY_COUNT = original;
  });

  async function load() {
    return (await import("../lib/rate-limit")) as typeof import("../lib/rate-limit");
  }

  function req(headers: Record<string, string>) {
    return new Request("https://api.example.com/", { headers });
  }

  it("returns null — not a shared constant — when no proxy is trusted", async () => {
    delete process.env.TRUSTED_PROXY_COUNT;
    const { getClientIp } = await load();

    // The header is client-supplied here, so it must not be believed...
    expect(getClientIp(req({ "x-forwarded-for": "84.54.72.10" }))).toBeNull();
    expect(getClientIp(req({ "x-real-ip": "84.54.72.10" }))).toBeNull();
    expect(getClientIp(req({}))).toBeNull();
  });

  it("never answers two different callers with the same string", async () => {
    delete process.env.TRUSTED_PROXY_COUNT;
    const { getClientIp } = await load();

    // ...and, crucially, must not answer them *identically*. Returning
    // "unknown" for both is what merged them into one rate-limit bucket.
    const a = getClientIp(req({ "x-forwarded-for": "84.54.72.10" }));
    const b = getClientIp(req({ "x-forwarded-for": "213.230.99.4" }));
    expect(a === null || a !== b).toBe(true);
  });

  it("reads the hop before the trusted proxy when one is configured", async () => {
    process.env.TRUSTED_PROXY_COUNT = "1";
    const { getClientIp } = await load();

    // Client spoofs a leading entry; the proxy appends the real one.
    expect(getClientIp(req({ "x-forwarded-for": "1.1.1.1, 84.54.72.10" }))).toBe("84.54.72.10");
    expect(getClientIp(req({ "x-real-ip": "84.54.72.10" }))).toBe("84.54.72.10");
  });
});

// ── checkRateLimit: an unknown subject must not be a subject ─────────────────
describe("checkRateLimit with no identifiable subject", () => {
  it("allows rather than pooling everyone into one counter", async () => {
    const o = { windowMs: 60_000, limit: 2, namespace: "null-key" };
    for (let i = 0; i < 50; i++) {
      expect(await checkRateLimit(null, o)).toBe(true);
    }
  });
});

// ── The middleware, as production wires it ───────────────────────────────────
describe("authedQuery global rate limit", () => {
  const router = createRouter({ ping: authedQuery.query(() => "pong") });

  function callerFor(userId: number) {
    const ctx = {
      req: new Request("https://api.example.com/trpc/ping"),
      resHeaders: new Headers(),
      user: { id: userId, role: "agent", tenantId: 1 },
      tenant: { id: 1, status: "active" },
      db: {},
    } as unknown as TrpcContext;
    return router.createCaller(ctx);
  }

  it("gives each user their own budget", async () => {
    // 200 agents starting their day. Under the old key they shared 120/min and
    // the 121st was told to wait a minute — for a first request.
    const results = await Promise.all(
      Array.from({ length: 200 }, (_, i) => callerFor(10_000 + i).ping()),
    );
    expect(results).toHaveLength(200);
    expect(results.every(r => r === "pong")).toBe(true);
  });

  it("still stops one user who floods", async () => {
    const caller = callerFor(999_001);
    // The limit is a real limit, just a personal one: 120 a minute.
    for (let i = 0; i < 120; i++) await caller.ping();
    await expect(caller.ping()).rejects.toThrow(/Слишком много запросов/);
  });

  it("one user's flood does not touch anyone else", async () => {
    const flooder = callerFor(999_002);
    for (let i = 0; i < 130; i++) await flooder.ping().catch(() => {});
    await expect(callerFor(999_003).ping()).resolves.toBe("pong");
  });
});
