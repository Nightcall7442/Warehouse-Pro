import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, ctxFor, type ServiceDb } from "./harness";

/**
 * Организация, созданная суперадмином, живёт столько, сколько ей выбрали.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * tenant.create писал выбранный тариф и срок в tenants, а подписку заводил
 * ВСЕГДА пробной на 14 дней — и отдельным запросом после транзакции, со
 * сбоем, погашенным в журнал. Пускает в работу подписка, поэтому
 * организацию «Pro» или с пробным на 30 дней запирало на 15-й день, а
 * карточка при этом показывала «Pro, 30 дн.».
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · платный тариф: подписка active на тот же тариф, срок совпадает с
 *     tenants.plan_expires_at, на 20-й день доступ есть;
 *   · пробный на 30 дней: подписка trialing до того же дня, что в tenants, и
 *     на 20-й день доступ есть, на 31-й — нет.
 *
 * Нарочная поломка: вернуть вставку `plan: "trial", status: "trialing"` на
 * 14 дней — оба теста падают на «доступ на 20-й день».
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/rate-limit", async () => (await import("../helpers/rate-limit-mock")).rateLimitMock());

const DAY = 86_400_000;

describe.skipIf(!hasRealDb)("tenant.create: подписка такая же, как карточка", () => {
  let db: ServiceDb;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); });
  afterEach(() => { vi.useRealTimers(); });

  const create = async (plan: "trial" | "pro", trialDays = 14) => {
    const { tenantRouter } = await import("../../tenant-router");
    const r = await tenantRouter.createCaller(ctxFor(db, 1, 1, "superadmin"))
      .create({ orgName: `Орг ${plan}`, ownerName: "Директор", ownerEmail: `${plan}@org.uz`, ownerPassword: "пароль-восемь", plan, trialDays });
    const [tenant] = await (db as any).select().from(schema.tenants).where(eq(schema.tenants.id, r.tenantId));
    const [sub] = await (db as any).select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, r.tenantId));
    return { id: r.tenantId as number, tenant, sub };
  };

  /** Есть ли доступ через `days` дней — тем же, что стоит у входа (настоящим, не умолчанием setup-subscription). */
  const accessAfter = async (tenantId: number, days: number) => {
    const { checkSubscriptionAccess } = await vi.importActual<typeof import("../../lib/feature-gating")>("../../lib/feature-gating");
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + days * DAY });
    try { return await checkSubscriptionAccess(tenantId); } finally { vi.useRealTimers(); }
  };

  it("Pro: подписка active на Pro до того же дня, что в карточке", async () => {
    const { id, tenant, sub } = await create("pro");

    expect(sub).toMatchObject({ plan: "pro", status: "active" });
    expect(tenant.planExpiresAt).toBeInstanceOf(Date);
    expect(sub.currentPeriodEnds.getTime()).toBe(tenant.planExpiresAt.getTime());
    expect(tenant.trialEndsAt, "у платного нет пробного срока").toBeNull();

    expect(await accessAfter(id, 20), "на 20-й день организацию Pro заперло").toBe(true);
    expect(await accessAfter(id, 31)).toBe(false);
  });

  it("пробный на 30 дней: подписка trialing на 30 дней", async () => {
    const { id, tenant, sub } = await create("trial", 30);

    expect(sub).toMatchObject({ plan: "trial", status: "trialing" });
    expect(sub.trialEndsAt.getTime()).toBe(tenant.trialEndsAt.getTime());
    expect(sub.trialEndsAt.getTime() - Date.now()).toBeGreaterThan(29 * DAY);

    expect(await accessAfter(id, 20), "на 20-й день пробного на 30 заперло").toBe(true);
    expect(await accessAfter(id, 31)).toBe(false);
  });
});
