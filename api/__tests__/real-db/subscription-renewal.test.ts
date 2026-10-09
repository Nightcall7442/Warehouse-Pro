import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, ctxFor, type ServiceDb, type Seeded } from "./harness";
import { statusOf, daysLeft } from "@/components/superadmin/console/orgs";

/**
 * Продление оплаченного срока — на настоящей базе.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Суперадмин включал тариф (updatePlan: active, срок = сегодня + 30), и
 * дальше не видел никто ничего:
 *   · updatePlan считал срок от сегодня — заплативший за неделю до конца
 *     терял эту неделю;
 *   · письма о конце срока уходили только пробным, платящий узнавал о конце
 *     по запертому входу;
 *   · вечерняя сводка считала просрочку по past_due из Stripe — всегда ноль:
 *     в сумах платят заявкой, статус остаётся active;
 *   · stripe.getSubscription считал дни только до конца пробного, полосе у
 *     оплаченного нечего было показать;
 *   · список организаций у суперадмина судил по tenants.trial_ends_at — у
 *     организации с сайта он остаётся навсегда, и платящий горел «Trial истёк».
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · продление досрочно — от конца оплаченного; после конца — от сегодня;
 *     пробные дни не переносятся;
 *   · письмо за 7, 3 и 1 день до конца оплаченного, одно в день, ссылка на
 *     /billing; Stripe-подписки не трогаются; пробному ссылка тоже /billing;
 *   · сводка считает просроченным active с прошедшим сроком, без
 *     приостановленных и без пробных;
 *   · дни в getSubscription у оплаченного — до конца оплаченного;
 *   · список отдаёт подписку, и метка суперадмина по ней — не «Trial истёк».
 *
 * Нарочная поломка: срок от `new Date()` в updatePlan — падает «досрочно»;
 * убрать выборку оплаченных из крона — «за неделю»; вернуть past_due в
 * сводку — «просрочка»; вернуть daysLeft от trialEndsAt — «дни»; вернуть
 * срок в консоли на tenants.trialEndsAt — «метка».
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/rate-limit", async () => (await import("../helpers/rate-limit-mock")).rateLimitMock());
const out = vi.hoisted(() => ({
  mails: [] as Array<{ kind: string; to: string; days: number; url: string }>,
  admin: [] as string[],
}));
vi.mock("../../lib/mailer", () => ({
  sendTrialEndingEmail: vi.fn(async (to: string, _o: string, days: number, url: string) => { out.mails.push({ kind: "trial", to, days, url }); }),
  sendRenewalReminderEmail: vi.fn(async (to: string, _o: string, _p: string, days: number, _e: Date, url: string) => { out.mails.push({ kind: "renewal", to, days, url }); }),
}));
vi.mock("../../lib/telegram", async (orig) => ({
  ...(await orig<object>()),
  notifyAdmin: vi.fn(async (text: string) => { out.admin.push(text); return true; }),
}));

const DAY = 86_400_000;
const HOUR = 3_600_000;

describe.skipIf(!hasRealDb)("продление оплаченного срока", () => {
  let db: ServiceDb;
  let s: Seeded;
  const d = () => db as any;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    await d().insert(schema.users).values({ tenantId: s.tenantId, name: "Директор", email: "ceo@test-co.uz", passwordHash: "x", role: "ceo" });
    out.mails.length = 0; out.admin.length = 0;
  });

  const sub = (tenantId: number, v: Partial<typeof schema.subscriptions.$inferInsert>) =>
    d().insert(schema.subscriptions).values({ id: randomUUID(), tenantId, plan: "basic", status: "active", ...v });
  const subOf = async (tenantId: number) =>
    (await d().select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, tenantId)))[0];
  const updatePlan = async (tenantId: number) => {
    const { tenantRouter } = await import("../../tenant-router");
    return tenantRouter.createCaller(ctxFor(db, 1, 1, "superadmin")).updatePlan({ tenantId, plan: "standard", expiryDays: 30 });
  };
  /** Насколько дата разошлась с ожидаемой, мс: запросы идут не мгновенно. */
  const off = (a: Date, b: number) => Math.abs(a.getTime() - b);
  const FIVE_MIN = 5 * 60_000;

  describe("updatePlan", () => {
    it("досрочно — от конца оплаченного: неделя не сгорает", async () => {
      const ends = Date.now() + 10 * DAY;
      await sub(s.tenantId, { currentPeriodEnds: new Date(ends) });
      await updatePlan(s.tenantId);

      const after = await subOf(s.tenantId);
      expect(off(after.currentPeriodEnds, ends + 30 * DAY)).toBeLessThan(FIVE_MIN);
      const [t] = await d().select().from(schema.tenants).where(eq(schema.tenants.id, s.tenantId));
      expect(t.planExpiresAt.getTime()).toBe(after.currentPeriodEnds.getTime());
    });

    it("после конца срока — от сегодня, не от прошлого", async () => {
      await sub(s.tenantId, { currentPeriodEnds: new Date(Date.now() - 5 * DAY) });
      await updatePlan(s.tenantId);
      expect(off((await subOf(s.tenantId)).currentPeriodEnds, Date.now() + 30 * DAY)).toBeLessThan(FIVE_MIN);
    });

    it("с пробного — от дня включения: пробные дни не оплачены", async () => {
      const trialEnds = new Date(Date.now() + 9 * DAY);
      await sub(s.tenantId, { plan: "trial", status: "trialing", trialEndsAt: trialEnds, currentPeriodEnds: trialEnds });
      await updatePlan(s.tenantId);
      const after = await subOf(s.tenantId);
      expect(after.status).toBe("active");
      expect(off(after.currentPeriodEnds, Date.now() + 30 * DAY)).toBeLessThan(FIVE_MIN);
    });
  });

  /*
    Что было: billing.status первым делом смотрел tenants.trial_ends_at, а он
    после включения тарифа остаётся. Перешедший с пробного досрочно видел на
    /billing «Пробный период, осталось 4 дн.» и дату конца пробного — вместо
    только что оплаченного месяца.
    Что проверяется: после updatePlan экран подписки показывает оплаченный
    срок; у пробного без оплаты — по-прежнему пробный.
    Нарочная поломка: trialActive снова без `!planActive`.
  */
  describe("экран подписки после перехода с пробного", () => {
    it("оплаченный месяц, а не остаток пробного", async () => {
      const trialEnds = new Date(Date.now() + 4 * DAY - HOUR);
      await d().update(schema.tenants).set({ plan: "trial", trialEndsAt: trialEnds, planExpiresAt: null })
        .where(eq(schema.tenants.id, s.tenantId));
      await sub(s.tenantId, { plan: "trial", status: "trialing", trialEndsAt: trialEnds, currentPeriodEnds: trialEnds });
      const { billingRouter } = await import("../../billing-router");
      const status = () => billingRouter.createCaller(ctxFor(db, s.tenantId, 1, "ceo")).status();

      const before = await status();
      expect(before.trialActive).toBeTruthy();
      expect(before.daysLeft).toBe(4);

      await updatePlan(s.tenantId);
      const after = await status();
      expect(after.plan).toBe("standard");
      expect(after.trialActive).toBeFalsy();
      expect(after.planActive).toBeTruthy();
      // Ровно 30 суток от «сейчас»: TIMESTAMP в MySQL округляет доли секунды
      // вверх, и ceil на быстрой машине даёт 31 (так упал CI). Важно, что это
      // месяц оплаты, а не 4 дня пробного.
      expect([30, 31]).toContain(after.daysLeft);
    });
  });

  describe("письма о конце срока", () => {
    const run = async (now = new Date()) => (await import("../../cron/trial-reminders")).runTrialReminders(now);

    it("за неделю до конца оплаченного — одно письмо в день, со ссылкой на /billing", async () => {
      await sub(s.tenantId, { currentPeriodEnds: new Date(Date.now() + 7 * DAY - HOUR) });

      await run();
      await run();   // второй прогон того же дня (догон крона) — не дубль

      expect(out.mails).toEqual([{ kind: "renewal", to: "ceo@test-co.uz", days: 7, url: expect.stringMatching(/\/billing$/) }]);
    });

    it("за 3 и за 1 день — да; за 5 — нет", async () => {
      await sub(s.tenantId, { currentPeriodEnds: new Date(Date.now() + 5 * DAY - HOUR) });
      await run();
      expect(out.mails).toHaveLength(0);

      await run(new Date(Date.now() + 2 * DAY));   // осталось 3
      await run(new Date(Date.now() + 4 * DAY));   // остался 1
      expect(out.mails.map(m => m.days)).toEqual([3, 1]);
    });

    it("Stripe продлевает сам — ему не пишем; пробному ссылка тоже /billing", async () => {
      await sub(s.tenantId, { stripeSubscriptionId: "sub_x", currentPeriodEnds: new Date(Date.now() + 3 * DAY - HOUR) });
      const trialEnds = new Date(Date.now() + 2 * DAY - HOUR);
      await d().insert(schema.users).values({ tenantId: s.otherTenantId, name: "Сосед", email: "ceo@other.uz", passwordHash: "x", role: "ceo" });
      await sub(s.otherTenantId, { plan: "trial", status: "trialing", trialEndsAt: trialEnds, currentPeriodEnds: trialEnds });

      await run();
      expect(out.mails).toEqual([{ kind: "trial", to: "ceo@other.uz", days: 2, url: expect.stringMatching(/\/billing$/) }]);
      expect(out.mails[0].url).not.toContain("/settings/billing");
    });
  });

  it("вечерняя сводка: просрочка — по сроку оплаченного", async () => {
    const past = new Date(Date.now() - 2 * DAY);
    await sub(s.tenantId, { currentPeriodEnds: past });                                            // просрочил — считать
    await sub(s.otherTenantId, { currentPeriodEnds: new Date(Date.now() + 10 * DAY) });            // оплачен — нет
    const [sus] = await d().insert(schema.tenants).values({ slug: "sus", name: "Приостановлена", status: "suspended" });
    await sub(Number(sus.insertId), { currentPeriodEnds: past });                                  // уже решили — нет
    const [tr] = await d().insert(schema.tenants).values({ slug: "tr", name: "Пробная" });
    await sub(Number(tr.insertId), { plan: "trial", status: "trialing", trialEndsAt: past, currentPeriodEnds: past }); // пробный — нет

    await (await import("../../cron/admin-digest")).runAdminDigest();
    expect(out.admin.join("\n")).toContain("Просрочили оплату: 1");
  });

  it("дни в getSubscription у оплаченного — до конца оплаченного", async () => {
    await sub(s.tenantId, { trialEndsAt: new Date(Date.now() - 40 * DAY), currentPeriodEnds: new Date(Date.now() + 5 * DAY - HOUR) });
    const { stripeRouter } = await import("../../stripe-router");
    const r = await stripeRouter.createCaller(ctxFor(db, s.tenantId, 1, "ceo")).getSubscription();
    expect(r.daysLeft).toBe(5);
    expect(r.stripeReady, "Stripe в тесте не настроен").toBe(false);
  });

  it("список суперадмина: у платящего с давним пробным — не «Trial истёк»", async () => {
    // Организация с сайта: trial_ends_at остался от регистрации, потом включили Basic.
    await d().update(schema.tenants)
      .set({ plan: "basic", trialEndsAt: new Date(Date.now() - 40 * DAY), planExpiresAt: new Date(Date.now() + 20 * DAY) })
      .where(eq(schema.tenants.id, s.tenantId));
    await sub(s.tenantId, { currentPeriodEnds: new Date(Date.now() + 20 * DAY) });

    const { tenantRouter } = await import("../../tenant-router");
    const rows = await tenantRouter.createCaller(ctxFor(db, 1, 1, "superadmin")).list();
    const row = rows.find(r => r.id === s.tenantId)!;

    expect(row.subscription).toMatchObject({ status: "active" });
    // Метка консоли (components/superadmin/console/orgs): по подписке, не по
    // давнему trial_ends_at.
    expect(statusOf(row).label).toBe("Платит");
    // Дни — вверх, как «осталось N дн.» у панели владельца: 20 суток и доля
    // секунды (MySQL округляет её вверх) — это 21. От давнего пробного было бы
    // минус сорок.
    expect(daysLeft(row)).toBeGreaterThanOrEqual(20);
    expect(daysLeft(row)).toBeLessThanOrEqual(21);
    expect(row.segment).toMatchObject({ paying: true, trial: false });
  });
});
