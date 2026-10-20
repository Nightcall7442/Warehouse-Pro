/**
 * Пределы, стоящие на каждом запросе, считаются в памяти, не в Redis.
 *
 * Общий предел и пределы записи по ролям проверяются на КАЖДОМ запросе до
 * базы. 20.10.2026 Redis был в другом регионе: ~170 мс на запрос, а при
 * потерях в канале — минуты (см. redis-silence-does-not-freeze.test.ts).
 * Пределы входа, паролей и регистрации остаются в Redis.
 *
 * Правило — local в api/lib/rate-limit.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";

const fake = vi.hoisted(() => ({ multi: 0 }));
vi.mock("../lib/redis", () => ({
  isRedisAvailable: () => true,
  getRedis: () => ({
    multi: () => {
      fake.multi++;
      const chain = { zremrangebyscore: () => chain, zcard: () => chain, zadd: () => chain, expire: () => chain,
        exec: async () => [[null, 0], [null, 0], [null, 1], [null, 1]] };
      return chain;
    },
  }),
}));
vi.mock("../lib/env", () => ({ env: { rateLimitDisabled: false } }));

import { checkRateLimit } from "../lib/rate-limit";

describe("пределы на каждом запросе — без Redis", () => {
  beforeEach(() => { fake.multi = 0; });

  it("local: Redis не спрашивается, предел всё равно держится", async () => {
    const opts = { windowMs: 60_000, limit: 3, namespace: "hot-test", local: true as const };
    const answers = [];
    for (let i = 0; i < 4; i++) answers.push(await checkRateLimit("user:1", opts));
    expect(answers).toEqual([true, true, true, false]);
    expect(fake.multi).toBe(0);
  });

  it("без local — по-прежнему Redis (пределы входа и паролей)", async () => {
    await checkRateLimit("user:1", { windowMs: 60_000, limit: 3, namespace: "login-test" });
    expect(fake.multi).toBe(1);
  });

  it("общий предел и пределы записи по ролям объявлены local", () => {
    const mw = readFileSync("api/middleware.ts", "utf-8");
    const global = mw.slice(mw.indexOf("const GLOBAL_RATE_LIMIT"), mw.indexOf("const withGlobalRateLimit"));
    expect(global).toMatch(/local:\s*true/);
    const mutation = mw.slice(mw.indexOf("const mutationRateLimit"), mw.indexOf("// ── Подписка"));
    expect(mutation).toContain("{ windowMs, limit, namespace, local: true }");
  });
});
