/**
 * Ключ кэша прогноза спроса — со всеми аргументами.
 *
 * lookbackDays в ключе не было: директор смотрел прогноз по 60 дням истории,
 * потом по 180 — и две минуты получал первый ответ, потому что ключ совпадал.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const demand = vi.hoisted(() => vi.fn());
vi.mock("../services/stock-predictor", () => ({
  getProductDemand: demand,
  predictStockouts: vi.fn(),
  getReorderRecommendations: vi.fn(),
}));
vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());
vi.mock("../lib/feature-gating", () => ({ hasSubscriptionAccess: vi.fn(async () => true) }));
vi.mock("../queries/connection", () => ({ getDb: () => ({}) }));

import { forecastRouter } from "../forecast-router";
import { cache } from "../lib/cache";
import { asTestContext } from "./helpers/test-context";

const ctx = () => asTestContext({
  req: new Request("http://localhost/"), resHeaders: new Headers(), db: {} as never,
  tenant: { id: 1, slug: "t", name: "T", plan: "pro" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
  user: { id: 1, tenantId: 1, role: "ceo" as const, status: "active" as const, name: "Д", email: "c@t", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
});

beforeEach(() => { cache.clear(); demand.mockReset(); });

describe("forecast.demandForecast", () => {
  it("другой lookbackDays — другой расчёт, а не ответ из кэша", async () => {
    // Меньше семи точек — ручка отвечает «недостаточно данных» без расчёта; нам
    // важно только, сколько раз она ходила за историей.
    demand.mockResolvedValue([]);
    const caller = forecastRouter.createCaller(ctx());
    await caller.demandForecast({ productId: 5, horizon: 7, method: "auto", lookbackDays: 60 });
    await caller.demandForecast({ productId: 5, horizon: 7, method: "auto", lookbackDays: 180 });
    expect(demand).toHaveBeenCalledTimes(2);
    expect(demand.mock.calls.map(c => c[2])).toEqual([60, 180]);
    // Тот же вход — из кэша.
    await caller.demandForecast({ productId: 5, horizon: 7, method: "auto", lookbackDays: 180 });
    expect(demand).toHaveBeenCalledTimes(2);
  });
});
