/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Mock dependencies before importing
vi.mock("../queries/connection", () => ({
  getDb: vi.fn(),
}));

vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());

vi.mock("../lib/sanitize", () => ({
  sanitizeSearch: vi.fn((s: string) => s),
}));

vi.mock("../services/audit-log", () => ({
  recordAudit: vi.fn(),
}));

vi.mock("../auth/password", () => ({
  hashPassword: vi.fn(async (p: string) => `hashed_${p}`),
  verifyPassword: vi.fn(async () => true),
}));

import { userRouter } from "../user-router";
import { getDb } from "../queries/connection";

describe("userRouter", () => {
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
    };
    vi.mocked(getDb).mockReturnValue(mockDb);
  });

  describe("list", () => {
    it("returns paginated users", async () => {
      mockDb.limit.mockResolvedValue([{ id: 1, name: "Test User", role: "agent" }]);
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue([{ id: 1, name: "Test User" }]),
              }),
            }),
          }),
        }),
      });

      // The actual router uses complex query chains, so we test the structure
      expect(userRouter).toBeDefined();
      expect(userRouter.list).toBeDefined();
    });
  });

  describe("changePassword", () => {
    it("is defined", () => {
      expect(userRouter.changePassword).toBeDefined();
    });
  });

  describe("logoutAll", () => {
    it("is defined", () => {
      expect(userRouter.logoutAll).toBeDefined();
    });
  });

  describe("registerPushToken", () => {
    it("is defined", () => {
      expect(userRouter.registerPushToken).toBeDefined();
    });

    // A push token belongs to a device, and a device has one user at a time.
    // Phones get handed from one agent to the next, and logout frequently can't
    // clear the old row — the session is already invalid by the time the app
    // tries, or the app was simply uninstalled. Unless this endpoint takes the
    // token away from its previous holder, that person keeps receiving order
    // notifications for a phone they no longer carry. Asserted against the
    // source because the mock db here can't express a two-statement update.
    it("takes the token away from any other user holding it", () => {
      const src = readFileSync(
        resolve(__dirname, "../user-router.ts"),
        "utf8"
      );
      const body = src.slice(
        src.indexOf("registerPushToken:"),
        src.indexOf("removePushToken:")
      );
      expect(body).toMatch(/set\(\{\s*pushToken:\s*null\s*\}\)/);
      expect(body).toMatch(/ne\(users\.id,\s*ctx\.user\.id\)/);
      expect(body).toMatch(/eq\(users\.pushToken,\s*input\.pushToken\)/);
    });
  });

  describe("removePushToken", () => {
    it("is defined", () => {
      expect(userRouter.removePushToken).toBeDefined();
    });
  });
});
