import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, ctxFor, type ServiceDb } from "./harness";
import { PLATFORM_ACTIONS } from "@contracts/platform-journal";
import { OPERATOR_CAPABILITIES } from "@contracts/constants";

/**
 * Журнал владельца платформы — на настоящей базе, через настоящие ручки.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Действия суперадмина писали след в журнал САМОЙ организации, и то не все:
 * смена тарифа, статус, продление пробного, создание организации не писались
 * никуда. Удаление организации стирало её audit_log целиком — «кто удалил и
 * что у неё было» узнать было неоткуда.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · каждое действие консоли пишет строку platform_audit: создание, статус,
 *     тариф (было → стало), продление пробного, сверх тарифа, руководство,
 *     права оператора, сброс пароля (без пароля в строке), смена логина
 *     сотруднику и свой логин суперадмина, песочница, заявка, стирание
 *     переписки, уборка журнала организации, журнал ошибок, оплата,
 *     объявление и его завершение, удаление организации — все 19 действий
 *     словаря (PLATFORM_ACTIONS), ни одного лишнего;
 *   · строки переживают удаление организации: номер и название снимком,
 *     audit_log самой организации стёрт, а «Организация удалена» с числом
 *     стёртых строк — на месте;
 *   · строгость: если след записать нельзя, действие откатывается (тариф не
 *     меняется, организация не удаляется);
 *   · ручка journal: отбор по организации, группе, слову, страницы по id;
 *     только суперадмину.
 *
 * Нарочная поломка: убрать recordPlatformAudit из updatePlan — падает «каждое
 * действие» (нет tenant.plan); передать в offboardTenant onDeleted без strict
 * — падает «строгость»; поставить platform_audit в OFFBOARD_ORDER — падает
 * «переживает удаление».
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/rate-limit", async () => (await import("../helpers/rate-limit-mock")).rateLimitMock());
vi.mock("../../auth/step-up", () => ({ checkTotpStepUp: vi.fn(async () => ({ ok: true })) }));
vi.mock("../../services/sandbox", () => ({ seedSandbox: vi.fn(async () => ({ orders: 0 })), SANDBOX_ORDER_COUNT: 0 }));
vi.mock("../../telegram-router", async (orig) => ({ ...(await orig<object>()), notifyAdmin: vi.fn(async () => true) }));
vi.mock("../../lib/env", async (orig) => {
  const real = await orig<{ env: Record<string, unknown> }>();
  const over: Record<string, unknown> = { appUrl: "https://wp.test", appSecret: "тест-секрет-0123456789abcdef0123456789" };
  return { env: new Proxy(real.env, { get: (o, k) => (k in over ? over[k as string] : o[k as string]) }) };
});

const PASSWORD = "старый-пароль-1";

describe.skipIf(!hasRealDb)("журнал владельца платформы", () => {
  let db: ServiceDb;
  const d = () => db as any;
  let systemId = 0;
  let superId = 0;
  let hash = "";

  beforeAll(async () => {
    db = await connectRealDb(); current = db;
    hash = await (await import("../../auth/password")).hashPassword(PASSWORD);
  }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    const [sys] = await d().insert(schema.tenants).values({ slug: "system", name: "Платформа" });
    systemId = Number(sys.insertId);
    const [sa] = await d().insert(schema.users).values({ tenantId: systemId, name: "Владелец", email: "root@system.local", passwordHash: hash, role: "superadmin" });
    superId = Number(sa.insertId);
  });

  const sa = () => {
    const c = ctxFor(db, systemId, superId, "superadmin");
    c.user.name = "Владелец";
    return c;
  };
  const routers = async () => ({
    tenant: (await import("../../tenant-router")).tenantRouter.createCaller(sa()),
    platform: (await import("../../platform-router")).platformRouter.createCaller(sa()),
    lead: (await import("../../lead-router")).leadRouter.createCaller(sa()),
    support: (await import("../../support-router")).supportRouter.createCaller(sa()),
    audit: (await import("../../audit-router")).auditRouter.createCaller(sa()),
    system: (await import("../../system-router")).systemRouter.createCaller(sa()),
    user: (await import("../../user-router")).userRouter.createCaller(sa()),
    access: (await import("../../access-router")).accessRouter.createCaller(sa()),
  });
  const journalRows = () => d().select().from(schema.platformAudit).orderBy(schema.platformAudit.id);
  const subOf = async (tenantId: number) => (await d().select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, tenantId)))[0];

  /** Организация с директором и подпиской «Стандарт» (прежние тарифы новым не включаются — contracts/pricing.ts). */
  async function org(name: string) {
    const r = await routers();
    const out = await r.tenant.create({ orgName: name, ownerName: "Директор", ownerEmail: `${randomUUID().slice(0, 8)}@ex.uz`, ownerPassword: "директор-1", plan: "standard" });
    const [ceo] = await d().select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(eq(schema.users.tenantId, out.tenantId));
    return { id: out.tenantId, ceoId: Number(ceo.id), ceoEmail: ceo.email as string };
  }

  it("каждое действие консоли пишет строку — все действия словаря, ни одного лишнего", async () => {
    const r = await routers();
    const a = await org("Альфа Дистрибьюшн");
    await r.tenant.updatePlan({ tenantId: a.id, plan: "trial", expiryDays: 30 });
    await r.tenant.setExtraLimits({ tenantId: a.id, extraUsers: 3, extraProducts: 0 });
    await r.tenant.setManualAccess({ tenantId: a.id, enabled: true });
    await r.access.setOperatorAccessFor({ tenantId: a.id, capabilities: Object.fromEntries(OPERATOR_CAPABILITIES.map(k => [k, k !== "orders.delete"])) as Record<(typeof OPERATOR_CAPABILITIES)[number], boolean> });
    await r.tenant.resetOwnerPassword({ tenantId: a.id, userId: a.ceoId, newPassword: "новый-пароль-77" });
    await r.tenant.changeUserLogin({ tenantId: a.id, userId: a.ceoId, email: "boss@alfa.uz" });
    await r.platform.recordPayment({ tenantId: a.id, amount: 599_000, paidAt: new Date().toISOString().slice(0, 10), method: "payme", plan: "standard", months: 1 });

    const t = await r.tenant.create({ orgName: "Пробная", ownerName: "Директор", ownerEmail: "trial@ex.uz", ownerPassword: "директор-1", plan: "trial", trialDays: 14 });
    await r.tenant.extendTrial({ tenantId: t.tenantId, days: 7 });
    await r.tenant.createSandbox({ partnerName: "BEKDRINKS", ownerEmail: "int@ex.uz", ownerPassword: "интегратор-1" });

    const [lead] = await d().insert(schema.leads).values({ name: "Жасур", company: "Сырдарья Савдо", phone: "+998901234567" });
    await r.lead.markHandled({ id: Number(lead.insertId) });
    await d().insert(schema.supportThreads).values({ tenantId: a.id, userId: a.ceoId });
    await d().insert(schema.supportMessages).values({ tenantId: a.id, userId: a.ceoId, fromPlatform: false, authorId: a.ceoId, body: "номер карты 8600…" });
    await r.support.purgeNow({ tenantId: a.id, userId: a.ceoId });
    await r.audit.purge({ tenantId: a.id, retentionDays: 30, totpCode: "123456" });
    await r.system.purgeErrors();
    const ann = await r.platform.createAnnouncement({ title: "Обновление в субботу", body: "С 23:00 до 23:30.", level: "info", audience: "all" });
    await r.platform.endAnnouncement({ id: ann.id });
    await r.user.changeMyLogin({ email: "owner@platform.uz", currentPassword: PASSWORD });
    await r.tenant.setStatus({ tenantId: a.id, status: "suspended" });
    const preview = await r.tenant.offboardPreview({ tenantId: a.id });
    await r.tenant.offboard({ tenantId: a.id, confirmSlug: preview.tenant.slug, totpCode: "123456" });

    const rows = await journalRows();
    const actions = new Set(rows.map((x: { action: string }) => x.action));
    expect([...actions].sort()).toEqual(Object.keys(PLATFORM_ACTIONS).sort());

    // Было → стало, кто и откуда.
    const plan = rows.find((x: { action: string }) => x.action === "tenant.plan");
    expect(plan.before.plan).toBe("standard");
    expect(plan.after.plan).toBe("trial");
    expect(plan.actorName).toBe("Владелец");
    expect(plan.actorId).toBe(superId);
    expect(typeof plan.ip).toBe("string");
    expect(plan.tenantName).toBe("Альфа Дистрибьюшн");
    // Пароль — ни в каком виде.
    const reset = rows.find((x: { action: string }) => x.action === "user.password_reset");
    expect(JSON.stringify(reset)).not.toContain("новый-пароль-77");
    const login = rows.find((x: { action: string }) => x.action === "user.login_changed");
    expect([login.before.email, login.after.email]).toEqual([a.ceoEmail, "boss@alfa.uz"]);
    const status = rows.find((x: { action: string }) => x.action === "tenant.status");
    expect([status.before.status, status.after.status]).toEqual(["active", "suspended"]);
  }, 120_000);

  it("строки переживают удаление организации: номер и название снимком; журнал самой организации стёрт", async () => {
    const r = await routers();
    const a = await org("Хорезм Опт");
    await r.tenant.updatePlan({ tenantId: a.id, plan: "trial", expiryDays: 30 });
    await r.tenant.setExtraLimits({ tenantId: a.id, extraUsers: 2, extraProducts: 0 }); // пишет и в audit_log организации
    expect(Number((await d().select({ n: sql`COUNT(*)` }).from(schema.auditLog).where(eq(schema.auditLog.tenantId, a.id)))[0].n)).toBeGreaterThan(0);

    await r.tenant.setStatus({ tenantId: a.id, status: "suspended" });
    const preview = await r.tenant.offboardPreview({ tenantId: a.id });
    await r.tenant.offboard({ tenantId: a.id, confirmSlug: preview.tenant.slug, totpCode: "123456" });

    expect(await d().select().from(schema.tenants).where(eq(schema.tenants.id, a.id))).toHaveLength(0);
    expect(Number((await d().select({ n: sql`COUNT(*)` }).from(schema.auditLog).where(eq(schema.auditLog.tenantId, a.id)))[0].n)).toBe(0);

    const page = await r.platform.journal({ tenantId: a.id });
    expect(page.rows.map(x => x.action)).toEqual(["tenant.offboarded", "tenant.status", "tenant.extra_limits", "tenant.plan", "tenant.created"]);
    expect(page.rows.every(x => x.tenantName === "Хорезм Опт")).toBe(true);
    const gone = page.rows[0];
    expect(gone.label).toBe("Организация удалена");
    const raw = (await journalRows()).find((x: { action: string }) => x.action === "tenant.offboarded");
    expect(raw.meta.total).toBeGreaterThan(3);
    expect(raw.meta.slug).toBe(preview.tenant.slug);
  }, 60_000);

  it("строгость: след не записался — действие откатилось", async () => {
    const r = await routers();
    const a = await org("Самарканд");
    const before = await subOf(a.id);
    await d().execute(sql`RENAME TABLE platform_audit TO platform_audit_off`);
    try {
      await expect(r.tenant.updatePlan({ tenantId: a.id, plan: "trial", expiryDays: 90 })).rejects.toThrow();
      expect((await subOf(a.id)).plan).toBe(before.plan);
      expect((await subOf(a.id)).currentPeriodEnds.getTime()).toBe(before.currentPeriodEnds.getTime());

      await r.tenant.setStatus({ tenantId: a.id, status: "suspended" }).catch(() => {});
      const [t] = await d().select().from(schema.tenants).where(eq(schema.tenants.id, a.id));
      expect(t.status).toBe("active");

      await d().update(schema.tenants).set({ status: "suspended" }).where(eq(schema.tenants.id, a.id));
      const preview = await r.tenant.offboardPreview({ tenantId: a.id });
      await expect(r.tenant.offboard({ tenantId: a.id, confirmSlug: preview.tenant.slug, totpCode: "123456" })).rejects.toThrow();
      expect(await d().select().from(schema.tenants).where(eq(schema.tenants.id, a.id))).toHaveLength(1);
    } finally {
      await d().execute(sql`RENAME TABLE platform_audit_off TO platform_audit`);
    }
  }, 60_000);

  it("ручка journal: организация, группа, слово, страницы; только суперадмину", async () => {
    const r = await routers();
    const a = await org("Бухара Сок");
    const b = await org("Наманган Трейд");
    await r.tenant.updatePlan({ tenantId: a.id, plan: "trial", expiryDays: 30 });
    await r.platform.recordPayment({ tenantId: b.id, amount: 897_000, paidAt: new Date().toISOString().slice(0, 10), method: "click", plan: "standard", months: 3 });
    await r.tenant.setStatus({ tenantId: b.id, status: "suspended" });

    const onlyB = await r.platform.journal({ tenantId: b.id });
    expect(onlyB.rows.map(x => x.action)).toEqual(["tenant.status", "payment.recorded", "tenant.created"]);
    const pay = onlyB.rows[1];
    expect(pay.summary).toContain("897 000 сум · Click");
    expect(pay.summary).toContain("Оплачено до:");

    const money = await r.platform.journal({ type: "money" });
    expect(money.rows.map(x => x.action).sort()).toEqual(["payment.recorded", "tenant.plan"]);
    expect((await r.platform.journal({ q: "Наманган" })).rows.every(x => x.tenantName === "Наманган Трейд")).toBe(true);
    expect((await r.platform.journal({ q: "Наманган" })).rows).toHaveLength(3);

    const p1 = await r.platform.journal({ limit: 2 });
    expect(p1.rows).toHaveLength(2);
    expect(p1.nextBefore).toBe(p1.rows[1].id);
    const p2 = await r.platform.journal({ limit: 2, before: p1.nextBefore! });
    expect(p2.rows[0].id).toBeLessThan(p1.rows[1].id);

    const { platformRouter } = await import("../../platform-router");
    await expect(platformRouter.createCaller(ctxFor(db, a.id, a.ceoId, "ceo")).journal({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  }, 60_000);
});
