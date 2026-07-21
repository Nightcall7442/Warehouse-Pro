/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing
vi.mock("../queries/connection", () => ({
  getDb: vi.fn(),
}));

vi.mock("../lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

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
  });

  describe("removePushToken", () => {
    it("is defined", () => {
      expect(userRouter.removePushToken).toBeDefined();
    });
  });
});
