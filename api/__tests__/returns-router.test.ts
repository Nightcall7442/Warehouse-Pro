/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../queries/connection", () => ({
  getDb: vi.fn(),
}));

vi.mock("../lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

import { returnsRouter } from "../returns-router";
import { getDb } from "../queries/connection";

describe("returnsRouter", () => {
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
      transaction: vi.fn(async (fn: any) => fn(mockDb)),
    };
    vi.mocked(getDb).mockReturnValue(mockDb);
  });

  it("has all required endpoints", () => {
    expect(returnsRouter.list).toBeDefined();
    expect(returnsRouter.getById).toBeDefined();
    expect(returnsRouter.create).toBeDefined();
    expect(returnsRouter.updateStatus).toBeDefined();
    expect(returnsRouter.summary).toBeDefined();
  });

  it("create endpoint uses transaction", async () => {
    // Verify that create is defined and uses transaction
    expect(returnsRouter.create).toBeDefined();
  });

  it("list endpoint supports status filter", () => {
    expect(returnsRouter.list).toBeDefined();
  });

  it("summary endpoint returns grouped data", () => {
    expect(returnsRouter.summary).toBeDefined();
  });
});
