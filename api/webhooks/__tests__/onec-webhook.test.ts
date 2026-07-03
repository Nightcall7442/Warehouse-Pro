import { describe, it, expect, vi } from "vitest";

vi.mock("../../queries/connection", () => {
  const mockDb = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ debt: "5000" }]),
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
              limit: vi.fn().mockResolvedValue([{ debt: "5000", reserved: "0.00" }]),
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
    onecWebhookSecret: "test-secret-123",
  },
}));

import app from "../onec";
import { OneCMapper } from "../../services/onec-mapper";

const AUTH_HEADERS = { "Content-Type": "application/json", "X-1C-Secret": "test-secret-123" };

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
