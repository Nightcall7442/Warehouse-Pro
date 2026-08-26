/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/feature-gating", () => ({
  hasSubscriptionAccess: vi.fn(async () => true),
  checkSubscriptionAccess: vi.fn(async () => true),
  invalidateSubscriptionAccess: vi.fn(),
}));

vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());

const mocks = vi.hoisted(() => ({
  mockSubmitReport: vi.fn(),
  mockGetReportsByShop: vi.fn(),
  mockGetReportsByDateRange: vi.fn(),
  mockGetReportById: vi.fn(),
}));

vi.mock("../services/merchandiser", () => ({
  MerchandiserService: {
    submitReport: mocks.mockSubmitReport,
    getReportsByShop: mocks.mockGetReportsByShop,
    getReportsByDateRange: mocks.mockGetReportsByDateRange,
    getReportById: mocks.mockGetReportById,
  },
}));

import { merchandiserRouter } from "../merchandiser-router";

function makeCtx(role = "merchandiser"): any {
  return {
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    user: { id: 10, tenantId: 1, role, status: "active", name: "Test", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: 1, slug: "test", name: "Test Co", plan: "trial", status: "active", createdAt: new Date(), updatedAt: new Date() },
    db: {} as any,
  };
}

describe("merchandiser.submitReport", () => {
  it("delegates to MerchandiserService.submitReport", async () => {
    mocks.mockSubmitReport.mockResolvedValue({ success: true, reportId: 1 });
    const caller = merchandiserRouter.createCaller(makeCtx());
    const result = await caller.submitReport({
      planId: 1,
      shopId: 1,
      photos: ["photo1.jpg"],
      checklist: [{ productId: 1, productName: "Product A", present: true }],
      competitorNotes: "Competitor X has promo",
    });
    expect(mocks.mockSubmitReport).toHaveBeenCalledWith(
      expect.anything(),
      1,
      10,
      expect.objectContaining({ planId: 1, shopId: 1 }),
    );
    expect(result.reportId).toBe(1);
  });
});

describe("merchandiser.getReportsByShop", () => {
  it("returns paginated reports for a shop", async () => {
    mocks.mockGetReportsByShop.mockResolvedValue({ data: [{ id: 1 }], total: 1 });
    const caller = merchandiserRouter.createCaller(makeCtx());
    const result = await caller.getReportsByShop({ shopId: 1, page: 1, pageSize: 25 });
    expect(mocks.mockGetReportsByShop).toHaveBeenCalledWith(expect.anything(), 1, 1, { page: 1, pageSize: 25 });
    expect(result.data).toHaveLength(1);
  });
});

describe("merchandiser.getReportsByDateRange", () => {
  it("returns reports within date range", async () => {
    mocks.mockGetReportsByDateRange.mockResolvedValue({ data: [{ id: 1 }, { id: 2 }], total: 2 });
    const caller = merchandiserRouter.createCaller(makeCtx("operator"));
    const result = await caller.getReportsByDateRange({ dateFrom: "2025-01-01", dateTo: "2025-01-31" });
    expect(mocks.mockGetReportsByDateRange).toHaveBeenCalled();
    expect(result.data).toHaveLength(2);
  });
});

describe("merchandiser.getReportById", () => {
  it("returns a single report", async () => {
    mocks.mockGetReportById.mockResolvedValue({ id: 1, reportNumber: "MR-001", photos: ["p1.jpg"] });
    const caller = merchandiserRouter.createCaller(makeCtx());
    const result = await caller.getReportById({ id: 1 });
    expect(result.id).toBe(1);
    expect(result.photos).toEqual(["p1.jpg"]);
  });

  it("returns null for non-existent report", async () => {
    mocks.mockGetReportById.mockResolvedValue(null);
    const caller = merchandiserRouter.createCaller(makeCtx());
    const result = await caller.getReportById({ id: 999 });
    expect(result).toBeNull();
  });
});
