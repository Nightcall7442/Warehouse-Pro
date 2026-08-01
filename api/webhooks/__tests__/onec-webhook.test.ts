import { describe, it, expect, vi, beforeEach } from "vitest";

// Mutable state the mocks read on every request, so each test can choose the
// tenant's stored `webhookSecret` and the value of the global env secret.
const state = vi.hoisted(() => ({
  /** Row returned for the onec_config lookup; null → tenant not configured. */
  configRow: null as Record<string, unknown> | null,
  /** Value of env.onecWebhookSecret (the deprecated global secret). */
  globalSecret: "",
}));

const DEFAULT_CONFIG_ROW = { tenantId: 1, webhookSecret: null, debt: "5000", reserved: "0.00" };

vi.mock("../../queries/connection", () => {
  const mockDb = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(() =>
            Promise.resolve(state.configRow ? [state.configRow] : []),
          ),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onDuplicateKeyUpdate: vi.fn().mockReturnValue({
          set: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    transaction: vi.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onDuplicateKeyUpdate: vi.fn().mockReturnValue({
              set: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        }),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockImplementation(() => {
                const data = [{ debt: "5000", reserved: "0.00" }];
                const chain = Promise.resolve(data) as Promise<unknown[]> & { for: ReturnType<typeof vi.fn> };
                chain.for = vi.fn().mockResolvedValue(data);
                return chain;
              }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      };
      return fn(tx);
    }),
  };
  return { getDb: () => mockDb };
});

vi.mock("../../services/onec-mapper", () => ({
  OneCMapper: {
    getInternalId: vi.fn().mockResolvedValue(null),
    getExternalId: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../lib/env", () => ({
  env: {
    get onecWebhookSecret() { return state.globalSecret; },
  },
}));

// Keep the real constant-time comparison, but make the calls observable so tests
// can assert that an unauthorised request never reached a secret comparison.
vi.mock("../../lib/safe-compare", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/safe-compare")>();
  return { safeEqual: vi.fn(actual.safeEqual) };
});

import app from "../onec";
import { OneCMapper } from "../../services/onec-mapper";
import { logger } from "../../lib/logger";
import { safeEqual } from "../../lib/safe-compare";

const GLOBAL_SECRET = "test-secret-123";
const TENANT_SECRET = "a".repeat(64);

const AUTH_HEADERS = { "Content-Type": "application/json", "X-1C-Secret": GLOBAL_SECRET };

const DEPRECATION_WARNING = /deprecated global secret/;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: tenant 1 exists, has no per-tenant secret yet, global secret set.
  state.configRow = { ...DEFAULT_CONFIG_ROW };
  state.globalSecret = GLOBAL_SECRET;
});

describe("1C Webhooks", () => {
  describe("POST /payment", () => {
    it("returns 401 without auth header", async () => {
      const res = await app.request("/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });

    it("returns 400 for missing fields", async () => {
      const res = await app.request("/payment", {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when shop not mapped", async () => {
      vi.mocked(OneCMapper.getInternalId).mockResolvedValueOnce(null);

      const res = await app.request("/payment", {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          tenantId: 1,
          shopExternalId: "shop-uuid",
          amount: 1000,
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toContain("not mapped");
    });

    it("returns 200 for valid payment", async () => {
      vi.mocked(OneCMapper.getInternalId).mockResolvedValueOnce(10);

      const res = await app.request("/payment", {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          tenantId: 1,
          shopExternalId: "shop-uuid",
          amount: 1000,
          reference: "REF-001",
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.success).toBe(true);
    });
  });

  describe("POST /stock", () => {
    it("returns 401 without auth header", async () => {
      const res = await app.request("/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: 1 }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 400 for missing fields", async () => {
      const res = await app.request("/stock", {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({ tenantId: 1 }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when product not mapped", async () => {
      vi.mocked(OneCMapper.getInternalId).mockResolvedValueOnce(null);

      const res = await app.request("/stock", {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          tenantId: 1,
          productExternalId: "prod-uuid",
          quantity: 50,
        }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 200 for valid stock update", async () => {
      vi.mocked(OneCMapper.getInternalId).mockResolvedValueOnce(5);

      const res = await app.request("/stock", {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          tenantId: 1,
          productExternalId: "prod-uuid",
          quantity: 50,
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.success).toBe(true);
    });
  });
});

describe("1C Webhooks — per-tenant webhook secret", () => {
  const post = (secret: string | null, tenantId: unknown = 1) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (secret !== null) headers["X-1C-Secret"] = secret;
    vi.mocked(OneCMapper.getInternalId).mockResolvedValueOnce(10);
    return app.request("/payment", {
      method: "POST",
      headers,
      body: JSON.stringify({ tenantId, shopExternalId: "shop-uuid", amount: 1000, reference: "REF-001" }),
    });
  };

  it("accepts a request signed with the tenant's own secret", async () => {
    state.configRow = { ...DEFAULT_CONFIG_ROW, webhookSecret: TENANT_SECRET };

    const res = await post(TENANT_SECRET);

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(true);
    // Per-tenant secret in use → no deprecation warning.
    expect(vi.mocked(logger.warn).mock.calls.some(([msg]) => DEPRECATION_WARNING.test(String(msg)))).toBe(false);
  });

  it("rejects a wrong per-tenant secret, even when it equals the global secret", async () => {
    // Isolation guarantee: once tenant 1 has its own secret, the global secret
    // (and therefore any other tenant's global-era credentials) stops working.
    state.configRow = { ...DEFAULT_CONFIG_ROW, webhookSecret: TENANT_SECRET };

    const res = await post(GLOBAL_SECRET);

    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("Unauthorized");
    expect(vi.mocked(safeEqual)).toHaveBeenCalledWith(GLOBAL_SECRET, TENANT_SECRET);
  });

  it("rejects another tenant's per-tenant secret", async () => {
    state.configRow = { ...DEFAULT_CONFIG_ROW, webhookSecret: TENANT_SECRET };

    const res = await post("b".repeat(64));

    expect(res.status).toBe(401);
  });

  it("falls back to the global secret when the tenant has none, and warns", async () => {
    state.configRow = { ...DEFAULT_CONFIG_ROW, webhookSecret: null };

    const res = await post(GLOBAL_SECRET);

    expect(res.status).toBe(200);
    const warning = vi.mocked(logger.warn).mock.calls.find(([msg]) => DEPRECATION_WARNING.test(String(msg)));
    expect(warning).toBeDefined();
    expect(warning?.[1]).toMatchObject({ tenantId: 1 });
  });

  it("rejects a wrong global secret for a tenant that has none", async () => {
    state.configRow = { ...DEFAULT_CONFIG_ROW, webhookSecret: null };

    const res = await post("not-the-global-secret");

    expect(res.status).toBe(401);
  });

  it("rejects when the tenant has no secret and the global secret is unset", async () => {
    state.configRow = { ...DEFAULT_CONFIG_ROW, webhookSecret: null };
    state.globalSecret = "";

    // Neither an empty nor a non-empty presented value may authorise here.
    expect((await post("")).status).toBe(401);
    expect((await post("anything")).status).toBe(401);

    // The empty expected secret is rejected before any comparison, so a hardened
    // or lenient safeEqual cannot turn an unset global secret into an open door.
    expect(vi.mocked(safeEqual)).not.toHaveBeenCalled();
  });

  it("returns 401 when the X-1C-Secret header is missing", async () => {
    state.configRow = { ...DEFAULT_CONFIG_ROW, webhookSecret: TENANT_SECRET };

    const res = await post(null);

    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("Unauthorized");
    expect(vi.mocked(safeEqual)).not.toHaveBeenCalled();
  });

  it("returns 403 for an unknown/unconfigured tenant without comparing secrets", async () => {
    state.configRow = null; // no onec_config row for this tenant

    const res = await post(GLOBAL_SECRET, 999);

    expect(res.status).toBe(403);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain("not configured");
    // No secret comparison happened at all, so nothing could have authorised it.
    expect(vi.mocked(safeEqual)).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("tenant not found"),
      { tenantId: 999 },
    );
  });

  it("still requires a tenantId before any secret lookup", async () => {
    const res = await app.request("/payment", {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ shopExternalId: "shop-uuid", amount: 1000 }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("Missing tenantId");
    expect(vi.mocked(safeEqual)).not.toHaveBeenCalled();
  });
});
