/**
 * Пользователь и организация на запрос — из памяти, а не два SELECT каждый раз.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Каждый вызов делал два SELECT (users, tenants) — при экране, который за
 * секунду зовёт десяток процедур, это была почти половина обращений к базе.
 * Пул на 20 соединений с бесконечной очередью и без тайм-аута SQL: застрявший
 * запрос копил за собой всех.
 *
 * Нарочная поломка: убери invalidateAuthUser из user-router.deactivate —
 * четвёртый тест назовёт место.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("../lib/redis", () => ({
  getRedis: () => { throw new Error("no redis"); }, isRedisAvailable: () => false,
  subscribeChannel: () => false, publishChannel: () => {}, INSTANCE_ID: "t",
}));
vi.mock("../lib/env", () => ({ env: { appSecret: "test-secret-test-secret-test-secret-32", isProduction: false } }));

const user = { id: 7, tenantId: 3, name: "Агент", email: "a@t.local", role: "agent", status: "active", tokenVersion: 0 };
const tenant = { id: 3, slug: "t", name: "T", status: "active", plan: "pro" };
const findUserById = vi.fn(async (_id: number) => ({ ...user }));
const findTenantById = vi.fn(async (_id: number) => ({ ...tenant }));
vi.mock("../queries/users", () => ({ findUserById: (id: number) => findUserById(id) }));
vi.mock("../queries/tenants", () => ({ findTenantById: (id: number) => findTenantById(id) }));

import { authenticateRequest, invalidateAuthUser, invalidateAuthTenant } from "../auth";
import { signSessionToken } from "../auth/session";
import { cache } from "../lib/cache";

async function headersFor(userId: number) {
  const token = await signSessionToken({ userId, tv: 0 });
  return new Headers({ authorization: `Bearer ${token}` });
}

beforeEach(() => { cache.clear(); findUserById.mockClear(); findTenantById.mockClear(); });

describe("кэш входа", () => {
  it("десять запросов подряд — одно чтение пользователя и одно организации", async () => {
    const h = await headersFor(7);
    for (let i = 0; i < 10; i++) {
      const r = await authenticateRequest(h);
      expect(r.user.id).toBe(7);
      expect(r.tenant.id).toBe(3);
    }
    expect(findUserById).toHaveBeenCalledTimes(1);
    expect(findTenantById).toHaveBeenCalledTimes(1);
  });

  it("сброс пользователя — следующее чтение из базы; деактивированный не входит", async () => {
    const h = await headersFor(7);
    await authenticateRequest(h);
    invalidateAuthUser(7);
    findUserById.mockResolvedValueOnce({ ...user, status: "inactive" } as never);
    await expect(authenticateRequest(h)).rejects.toThrow(/inactive/i);
    expect(findUserById).toHaveBeenCalledTimes(2);
  });

  it("сброс организации — приостановка действует на следующий запрос", async () => {
    const h = await headersFor(7);
    await authenticateRequest(h);
    invalidateAuthTenant(3);
    findTenantById.mockResolvedValueOnce({ ...tenant, status: "suspended" } as never);
    await expect(authenticateRequest(h)).rejects.toThrow(/suspended/i);
  });

  it("критичные записи сбрасывают кэш: деактивация, роль, пароли, «выйти отовсюду», статус организации", () => {
    const read = (p: string) => readFileSync(p, "utf8");
    const userRouter = read("api/user-router.ts");
    expect((userRouter.match(/invalidateAuthUser\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(read("api/http/auth.ts")).toContain("invalidateAuthUser(claim.userId);");
    expect(read("api/tenant-router.ts")).toContain("invalidateAuthTenant(input.tenantId);");
    expect(read("api/services/password-reset.ts")).toContain("invalidateAuthUser(resetToken.userId);");
    // только в памяти процесса: в строках даты, JSON их ломает
    const auth = read("api/auth/index.ts");
    expect(auth).toContain("cache.setLocal(userKey(id), row, AUTH_TTL_MS);");
    expect(auth).not.toContain("cache.set(userKey");
  });

  it("пул: очередь с потолком и тайм-аут чтения на стороне MySQL", () => {
    const conn = readFileSync("api/queries/connection.ts", "utf8");
    expect(conn).toContain("queueLimit: env.dbQueueLimit,");
    expect(conn).toContain("SET SESSION max_execution_time = ${env.dbStatementTimeoutMs}");
    const env = readFileSync("api/lib/env.ts", "utf8");
    expect(env).toContain('optional("DB_QUEUE_LIMIT", "500")');
    expect(env).toContain('optional("DB_STATEMENT_TIMEOUT_MS", "30000")');
  });
});
