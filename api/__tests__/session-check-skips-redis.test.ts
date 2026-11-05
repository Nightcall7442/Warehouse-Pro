/**
 * Проверка отзыва сессии не ходит в Redis на каждый запрос.
 *
 * Она стоит в начале каждого запроса с входом. 20.10.2026 Redis был в
 * другом регионе: ~170 мс на каждый запрос ещё до базы, а при потерях в
 * канале — минуты (см. redis-silence-does-not-freeze.test.ts). Сессия же
 * отзывается раз в жизни — при выходе.
 *
 * Правило — api/auth/revocation.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const fake = vi.hoisted(() => ({ keys: new Set<string>(), exists: 0, available: true }));
vi.mock("../lib/redis", () => ({
  isRedisAvailable: () => fake.available,
  getRedis: () => ({
    exists: async (k: string) => { fake.exists++; return fake.keys.has(k) ? 1 : 0; },
    set: async (k: string) => { fake.keys.add(k); return "OK"; },
  }),
}));

import { revokeSession, isSessionRevoked, _revocationInternals } from "../auth/revocation";

const in30days = () => Math.floor(Date.now() / 1000) + 30 * 86_400;

describe("отзыв сессии — без Redis на каждый запрос", () => {
  beforeEach(() => {
    fake.keys.clear(); fake.exists = 0; fake.available = true;
    _revocationInternals.memory.clear(); (_revocationInternals as { clean?: Map<string, number> }).clean?.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("двадцать запросов одной сессии подряд — один вопрос к Redis, а не двадцать", async () => {
    for (let i = 0; i < 20; i++) expect(await isSessionRevoked("a")).toBe(false);
    expect(fake.exists).toBe(1);
  });

  it("через 15 секунд Redis спрашивают снова", async () => {
    await isSessionRevoked("a");
    vi.setSystemTime(Date.now() + 16_000);
    await isSessionRevoked("a");
    expect(fake.exists).toBe(2);
  });

  it("выход на этой реплике действует сразу и без Redis", async () => {
    await isSessionRevoked("a");
    await revokeSession("a", in30days());
    const asked = fake.exists;
    expect(await isSessionRevoked("a")).toBe(true);
    expect(fake.exists).toBe(asked);
  });

  it("выход на другой реплике (есть только в Redis) доходит не позже чем через 15 секунд и дальше помнится", async () => {
    expect(await isSessionRevoked("b")).toBe(false);
    fake.keys.add("session:revoked:b");
    vi.setSystemTime(Date.now() + 16_000);
    expect(await isSessionRevoked("b")).toBe(true);
    const asked = fake.exists;
    expect(await isSessionRevoked("b")).toBe(true);
    expect(fake.exists).toBe(asked);
  });

  it("отзыв, сделанный при упавшем Redis, не забывается, когда Redis вернулся", async () => {
    fake.available = false;
    await revokeSession("c", in30days());
    fake.available = true;
    expect(await isSessionRevoked("c")).toBe(true);
  });
});
