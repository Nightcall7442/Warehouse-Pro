/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Охрана входа: кого пускают к процедуре и с какой ролью.
 *
 * ── Почему файл переименован ────────────────────────────────────────────────
 *
 * Он назывался tenant-isolation и обещал в шапке проверять, что «каждый запрос
 * роутера подставляет нужный tenantId». Не проверял: ни один роутер здесь не
 * вызывался, а заглушки select/insert/update, ради которых всё затевалось, ни
 * разу не участвовали в ожиданиях. Убери кто-нибудь границу организации из
 * любого запроса — этот файл остался бы зелёным.
 *
 * Хуже: два теста в разделе «tenant context» строили два объекта и сверяли их
 * между собой — `ctx1.tenant.id` равен единице, потому что единицу туда и
 * положили строкой выше. Такое не падает никогда и создаёт ощущение
 * покрытия там, где его нет.
 *
 * Что осталось — то, что файл действительно делает и делал хорошо: поднимает
 * настоящие процедуры на настоящих охранниках из middleware и проверяет, кого
 * они пускают. Отсюда и новое имя.
 *
 * Где на самом деле проверяется изоляция организаций:
 *   • courier-router.test.ts — заказ соседней организации не приходит в список;
 *   • shop-cross-tenant-refs.test.ts — соединения и записи по границе;
 *   • product-refs-cross-tenant.test.ts — чужой товар не принимается;
 *   • login-multi-tenant.test.ts — вход с одним адресом в разных организациях.
 */
import { describe, it, expect, vi } from "vitest";
import { TRPCError } from "@trpc/server";

// ── Заглушка базы ───────────────────────────────────────────────────────────
// Нужна не ради ожиданий, а потому что охранник по дороге к процедуре
// заглядывает в базу. Ни один тест в неё не смотрит — и не должен.
const mockSelect   = vi.fn();
const mockInsert   = vi.fn();
const mockUpdate   = vi.fn();
const mockDelete   = vi.fn();

const mockDb = {
  select:      () => mockSelect(),
  insert:      () => ({ values: mockInsert }),
  update:      () => ({ set: () => ({ where: mockUpdate }) }),
  delete:      () => ({ where: mockDelete }),
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb)),
};

vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

// ── Helper: build a minimal authed context ───────────────────────────────────
function makeCtx(tenantId: number, userId: number, role = "operator"): any {
  return {
    req:        new Request("http://localhost/"),
    resHeaders: new Headers(),
    user:   { id: userId, tenantId, role, status: "active", name: "Test", email: "t@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test", name: "Test Co", plan: "trial" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
  };
}

// ── Middleware guard tests ────────────────────────────────────────────────────
describe("auth middleware", () => {
  it("throws UNAUTHORIZED when no user in context", async () => {
    const { createRouter, authedQuery } = await import("../middleware");
    const router = createRouter({ ping: authedQuery.query(() => "ok") });
    const caller = router.createCaller({ req: new Request("http://x/"), resHeaders: new Headers() } as any);
    await expect(caller.ping()).rejects.toThrow(TRPCError);
  });

  it("allows request when user and tenant present", async () => {
    const { createRouter, authedQuery } = await import("../middleware");
    const router = createRouter({ ping: authedQuery.query(() => "ok") });
    const caller = router.createCaller(makeCtx(1, 1));
    await expect(caller.ping()).resolves.toBe("ok");
  });

  it("throws FORBIDDEN when role is insufficient", async () => {
    const { createRouter, adminQuery } = await import("../middleware");
    const router = createRouter({ secret: adminQuery.query(() => "admin-data") });
    const caller = router.createCaller(makeCtx(1, 1, "agent")); // agent, not ceo
    await expect(caller.secret()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ── Role hierarchy ───────────────────────────────────────────────────────────
describe("role access matrix", () => {
  it.each([
    ["ceo",          "adminQuery",        true ],
    ["operator",     "adminQuery",        false],
    ["agent",        "adminQuery",        false],
    ["ceo",          "operatorQuery",     true ],
    ["operator",     "operatorQuery",     true ],
    ["agent",        "operatorQuery",     false],
    // fieldSalesQuery: ceo, operator, agent, supervisor, merchandiser
    ["agent",        "fieldSalesQuery",   true ],
    ["supervisor",   "fieldSalesQuery",   true ],
    ["merchandiser", "fieldSalesQuery",   true ],
    // merchVisitQuery: ceo, operator, agent, supervisor, merchandiser (all)
    ["agent",        "merchVisitQuery",   true ],
    ["supervisor",   "merchVisitQuery",   true ],
    ["merchandiser", "merchVisitQuery",   true ],
    // Legacy alias — same as fieldSalesQuery
    ["agent",        "agentQuery",        true ],
    ["merchandiser", "agentQuery",        true ],
    ["supervisor",   "agentQuery",        true ],
    ["merchandiser", "merchQuery",        true ],
    ["supervisor",   "merchQuery",        true ],
    ["agent",        "merchQuery",        false],
    ["ceo",          "supervisorQuery",   true ],
    ["supervisor",   "supervisorQuery",   true ],
    ["agent",        "supervisorQuery",   false],
  ])("%s can access %s: %s", async (role, queryType, allowed) => {
    const mod = await import("../middleware");
    const guard = (mod as Record<string, unknown>)[queryType] as typeof mod.authedQuery;
    const router = mod.createRouter({ check: guard.query(() => "ok") });
    const caller = router.createCaller(makeCtx(1, 1, role));

    if (allowed) {
      await expect(caller.check()).resolves.toBe("ok");
    } else {
      await expect(caller.check()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});
