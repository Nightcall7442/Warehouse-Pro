/**
 * Включённый второй фактор нельзя перевыпустить без выключения кодом.
 *
 * Аудит 20.09.2026 (критично): user.totpSetup молча перезаписывал секрет
 * и снимал totpEnabledAt любому вошедшему. Украденной куки (30 дней)
 * хватало, чтобы завести свой аутентификатор, пройти step-up и выгрузить
 * базу всех организаций (/api/admin/backup) или снять организацию.
 *
 * Нарочная поломка: убери в totpSetup проверку `row?.totpEnabledAt` —
 * упадёт «включённый фактор».
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));
vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());
vi.mock("../lib/feature-gating", () => ({
  hasSubscriptionAccess: vi.fn(async () => true),
  checkSubscriptionAccess: vi.fn(async () => true),
  invalidateSubscriptionAccess: vi.fn(),
}));
vi.mock("../services/audit-log", () => ({ recordAudit: vi.fn() }));
vi.mock("../lib/secret-box", () => ({ seal: (s: string) => `sealed:${s}`, open: (s: string) => s.replace(/^sealed:/, "") }));

import { asTestContext } from "./helpers/test-context";

let totpEnabledAt: Date | null = null;
let updates: Array<Record<string, unknown>> = [];
const mockDb = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ totpEnabledAt, totpSecret: "sealed:x" }] }) }) }),
  update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => { updates.push(v); return [{ affectedRows: 1 }]; } }) }),
};

const ctx = () => asTestContext({
  req: new Request("http://localhost/"),
  resHeaders: new Headers(),
  user: { id: 1, tenantId: 1, role: "superadmin", status: "active" as const, name: "Админ", email: "a@t.com", passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date() },
  tenant: { id: 1, slug: "test", name: "Test Co", plan: "pro" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
  db: mockDb,
});

async function caller() {
  const { userRouter } = await import("../user-router");
  return userRouter.createCaller(ctx());
}

describe("второй фактор: перевыпуск", () => {
  beforeEach(() => { updates = []; });

  it("включённый фактор: setup отказывает и секрет не трогает", async () => {
    totpEnabledAt = new Date("2026-09-01");
    await expect((await caller()).totpSetup()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(updates, "секрет перезаписан при включённом факторе").toEqual([]);
  });

  it("фактор не включён: setup выдаёт секрет и пишет его незапечатанным наружу один раз", async () => {
    totpEnabledAt = null;
    const r = await (await caller()).totpSetup();
    expect(r.secret).toMatch(/^[A-Z2-7]{16,}$/);
    expect(updates).toEqual([{ totpSecret: `sealed:${r.secret}`, totpEnabledAt: null }]);
  });
});
