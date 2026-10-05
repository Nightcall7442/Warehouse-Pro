import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, ctxFor, type ServiceDb } from "./harness";
import { addMonths, tashkentDay } from "@contracts/subscription-payment";
import { paymentsSummary } from "../../services/subscription-payments";

/**
 * Оплаты подписок — на настоящей базе, через настоящие ручки.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Деньги платформы не записывались нигде: суперадмин нажимал «Изменить
 * тариф» на 30 дней, а сколько заплатили, когда и за какой период — в голове.
 * «MRR» на обзоре — по прайсу, без скидок и пропусков.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · оплата продлевает подписку одним действием: досрочно — от конца
 *     оплаченного (неделя не сгорает), после конца — от сегодня, с пробного —
 *     от сегодня и статус active; тариф и срок в tenants тоже;
 *   · период оплаты записан днями по Ташкенту и совпадает с новым сроком;
 *   · «Поступило за месяц» — по дате оплаты в этом месяце; «MRR по оплатам» —
 *     оплаты, разложенные по дням периода (15.09–15.10 и 15.10–15.11 дают
 *     октябрю ровно одну месячную сумму, а не две);
 *   · оплаты ПЕРЕЖИВАЮТ удаление организации: строки на месте, ручка
 *     payments по номеру их отдаёт;
 *   · сумма больше нуля и целая, дата не из будущего, только суперадмину.
 *
 * Нарочная поломка: в recordSubscriptionPayment продлевать от `now` —
 * падает «досрочно»; считать MRR «период задевает месяц → вся месячная
 * цена» — падает «по дням»; убрать subscription_payments из KEPT_ON_OFFBOARD
 * и вписать в OFFBOARD_ORDER — падает «переживают удаление».
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../auth/step-up", () => ({ checkTotpStepUp: vi.fn(async () => ({ ok: true })) }));
vi.mock("../../telegram-router", async (orig) => ({ ...(await orig<object>()), notifyAdmin: vi.fn(async () => true) }));

const DAY = 86_400_000;
const today = () => tashkentDay(new Date());
/** Насколько дата разошлась с ожидаемой: запросы не мгновенны, столбец — целые секунды. */
const off = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime());
const FIVE_MIN = 5 * 60_000;

describe.skipIf(!hasRealDb)("оплаты подписок", () => {
  let db: ServiceDb;
  const d = () => db as any;
  let systemId = 0;
  let n = 0;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    const [sys] = await d().insert(schema.tenants).values({ slug: "system", name: "Платформа" });
    systemId = Number(sys.insertId);
  });

  async function org(name: string, sub: { plan: "trial" | "basic" | "pro"; status: "trialing" | "active"; currentPeriodEnds?: Date | null; trialEndsAt?: Date | null }) {
    const [t] = await d().insert(schema.tenants).values({ slug: `org-${++n}`, name, plan: sub.plan });
    const id = Number(t.insertId);
    await d().insert(schema.users).values({ tenantId: id, name: "Директор", email: `ceo${n}@t.uz`, passwordHash: "x", role: "ceo" });
    await d().insert(schema.subscriptions).values({ id: randomUUID(), tenantId: id, ...sub });
    return id;
  }
  const admin = async () => (await import("../../platform-router")).platformRouter.createCaller(ctxFor(db, systemId, 1, "superadmin"));
  const subOf = async (id: number) => (await d().select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, id)))[0];
  const tenantOf = async (id: number) => (await d().select().from(schema.tenants).where(eq(schema.tenants.id, id)))[0];

  it("досрочно — от конца оплаченного: неделя не сгорает; период днями совпадает со сроком", async () => {
    const ends = new Date(Math.floor((Date.now() + 10 * DAY) / 1000) * 1000);
    const id = await org("Бухара Сок", { plan: "basic", status: "active", currentPeriodEnds: ends });
    const r = await (await admin()).recordPayment({ tenantId: id, amount: 1_797_000, paidAt: today(), method: "transfer", plan: "standard", months: 3, note: "за квартал" });

    const expected = addMonths(ends, 3);
    const sub = await subOf(id);
    expect(off(sub.currentPeriodEnds, expected)).toBeLessThan(1000);
    expect(sub.plan).toBe("standard");
    expect(sub.status).toBe("active");
    const t = await tenantOf(id);
    expect(t.plan).toBe("standard");
    expect(t.planExpiresAt.getTime()).toBe(sub.currentPeriodEnds.getTime());

    const [pay] = await d().select().from(schema.subscriptionPayments).where(eq(schema.subscriptionPayments.tenantId, id));
    expect(pay).toMatchObject({ amount: 1_797_000, paidAt: today(), method: "transfer", plan: "standard", months: 3, note: "за квартал", tenantName: "Бухара Сок" });
    expect(pay.periodFrom).toBe(tashkentDay(ends));
    expect(pay.periodTo).toBe(tashkentDay(expected));
    expect([r.periodFrom, r.periodTo]).toEqual([pay.periodFrom, pay.periodTo]);

    // След в журнале владельца — той же сделкой.
    const [j] = await d().select().from(schema.platformAudit).where(eq(schema.platformAudit.action, "payment.recorded"));
    // Рядом с внесённой — сколько полагалось по прайсу (contracts/pricing.ts): полевых нет — минимум, 3 × 119 000 × 3.
    expect(j.meta).toMatchObject({ amount: 1_797_000, expected: 1_071_000, fieldUsers: 0, method: "transfer", months: 3, periodFrom: pay.periodFrom, periodTo: pay.periodTo });
    expect(j.before.plan).toBe("basic");
    expect(j.after.plan).toBe("standard");
  });

  it("после конца срока и с пробного — от сегодня; пробный становится active", async () => {
    const expired = await org("Хорезм", { plan: "basic", status: "active", currentPeriodEnds: new Date(Date.now() - 5 * DAY) });
    const trial = await org("Наманган", { plan: "trial", status: "trialing", trialEndsAt: new Date(Date.now() + 9 * DAY), currentPeriodEnds: new Date(Date.now() + 9 * DAY) });
    const a = await admin();
    await a.recordPayment({ tenantId: expired, amount: 357_000, paidAt: today(), method: "cash", plan: "standard", months: 1 });
    await a.recordPayment({ tenantId: trial, amount: 357_000, paidAt: today(), method: "click", plan: "standard", months: 1 });
    const now = new Date();
    expect(off((await subOf(expired)).currentPeriodEnds, addMonths(now, 1))).toBeLessThan(FIVE_MIN);
    const t = await subOf(trial);
    expect(t.status).toBe("active");
    expect(t.plan).toBe("standard");
    expect(off(t.currentPeriodEnds, addMonths(now, 1))).toBeLessThan(FIVE_MIN);
    const pays = await a.payments({ tenantId: trial });
    expect(pays[0].periodFrom).toBe(today());
  });

  it("«Поступило» — по дате оплаты в месяце; «MRR по оплатам» — по дням периода", async () => {
    const id = await org("Самарканд", { plan: "pro", status: "active", currentPeriodEnds: new Date(Date.now() + 20 * DAY) });
    const row = (o: Partial<typeof schema.subscriptionPayments.$inferInsert>) => d().insert(schema.subscriptionPayments).values({
      tenantId: id, tenantName: "Самарканд", amount: 1_000_000, paidAt: "2026-10-01", method: "transfer", plan: "pro", months: 1,
      periodFrom: "2026-10-15", periodTo: "2026-11-15", ...o,
    });
    // Сентябрьская оплата за 15.09–15.10 и октябрьская за 15.10–15.11 — по 1 000 000.
    await row({ paidAt: "2026-09-14", periodFrom: "2026-09-15", periodTo: "2026-10-15" });
    await row({ paidAt: "2026-10-12", periodFrom: "2026-10-15", periodTo: "2026-11-15" });
    // Годовая оплата другой организации: 12 000 000 за 01.10.2026–01.10.2027.
    await row({ tenantId: id + 1000, tenantName: "Годовая", amount: 12_000_000, paidAt: "2026-10-01", months: 12, periodFrom: "2026-10-01", periodTo: "2027-10-01" });
    // Не задевает октябрь — не считается.
    await row({ paidAt: "2026-08-01", periodFrom: "2026-08-01", periodTo: "2026-09-01" });

    const october = new Date("2026-10-20T12:00:00Z");
    const s = await paymentsSummary(db as never, october);
    expect(s.month).toBe("2026-10");
    expect(s.received).toBe(13_000_000);
    expect(s.receivedCount).toBe(2);
    // 1 000 000 × 14/30 + 1 000 000 × 17/31 + 12 000 000 × 31/365
    expect(s.mrrByPayments).toBe(Math.round(1_000_000 * 14 / 30 + 1_000_000 * 17 / 31 + 12_000_000 * 31 / 365));
    expect(s.payers).toBe(3);

    // Через ручку — сегодняшняя оплата попадает в «Поступило» текущего месяца.
    const a = await admin();
    const before = await a.paymentsSummary();
    await a.recordPayment({ tenantId: id, amount: 599_000, paidAt: today(), method: "card", plan: "standard", months: 1 });
    const after = await a.paymentsSummary();
    expect(after.received - before.received).toBe(599_000);
    expect(after.mrrByPayments).toBeGreaterThan(before.mrrByPayments);
  });

  it("оплаты переживают удаление организации", async () => {
    const id = await org("Уходящая", { plan: "basic", status: "active", currentPeriodEnds: new Date(Date.now() + 3 * DAY) });
    const a = await admin();
    await a.recordPayment({ tenantId: id, amount: 299_000, paidAt: today(), method: "cash", plan: "standard", months: 1 });
    await a.recordPayment({ tenantId: id, amount: 598_000, paidAt: today(), method: "payme", plan: "standard", months: 2 });

    const { tenantRouter } = await import("../../tenant-router");
    const t = tenantRouter.createCaller(ctxFor(db, systemId, 1, "superadmin"));
    await t.setStatus({ tenantId: id, status: "suspended" });
    const preview = await t.offboardPreview({ tenantId: id });
    expect(Object.keys(preview.rows)).not.toContain("subscription_payments");
    await t.offboard({ tenantId: id, confirmSlug: preview.tenant.slug, totpCode: "123456" });

    expect(await tenantOf(id)).toBeUndefined();
    const left = await a.payments({ tenantId: id });
    expect(left.map(p => Number(p.amount)).sort()).toEqual([299_000, 598_000]);
    expect(left.every(p => p.tenantName === "Уходящая")).toBe(true);
  }, 60_000);

  it("сумма целая и больше нуля, дата не из будущего, организация есть; только суперадмину", async () => {
    const id = await org("Проверка", { plan: "basic", status: "active", currentPeriodEnds: new Date(Date.now() + 3 * DAY) });
    const a = await admin();
    const base = { tenantId: id, paidAt: today(), method: "cash" as const, plan: "standard" as const, months: 1 };
    await expect(a.recordPayment({ ...base, amount: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(a.recordPayment({ ...base, amount: 299_000.5 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(a.recordPayment({ ...base, amount: 299_000, paidAt: tashkentDay(new Date(Date.now() + 5 * DAY)) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(a.recordPayment({ ...base, amount: 299_000, tenantId: 999_999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { platformRouter } = await import("../../platform-router");
    await expect(platformRouter.createCaller(ctxFor(db, id, 2, "ceo")).recordPayment({ ...base, amount: 299_000 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await a.payments({ tenantId: id })).toEqual([]);
  });

  it("прежний тариф: свой продлевается до 05.10.2027, чужой — нет; расчёт по полевым — в журнале", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T09:00:00Z"));
    try {
      const id = await org("Фергана Опт", { plan: "basic", status: "active", currentPeriodEnds: new Date("2026-10-10T00:00:00Z") });
      for (const [i, role, status] of [[1, "agent", "active"], [2, "agent", "active"], [3, "courier", "active"], [4, "merchandiser", "active"], [5, "courier", "inactive"], [6, "supervisor", "active"]] as const) {
        await d().insert(schema.users).values({ tenantId: id, name: `p${i}`, email: `p${i}-${id}@t.uz`, passwordHash: "x", role, status });
      }
      const a = await admin();
      const day = tashkentDay(new Date());

      await expect(a.recordPayment({ tenantId: id, amount: 599_000, paidAt: day, method: "cash", plan: "pro", months: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await a.payments({ tenantId: id })).toHaveLength(0);

      const renew = await a.recordPayment({ tenantId: id, amount: 299_000, paidAt: day, method: "cash", plan: "basic", months: 1 });
      expect(renew.expected).toBe(299_000);

      const year = await a.recordPayment({ tenantId: id, amount: 5_000_000, paidAt: day, method: "transfer", plan: "standard", months: 12 });
      // 4 активных полевых (супервайзер и отключённый курьер не в счёт) × 119 000 × 12 × 0,85.
      expect(year.expected).toBe(Math.round(4 * 119_000 * 12 * 0.85));
      const rows = await d().select().from(schema.platformAudit).where(eq(schema.platformAudit.action, "payment.recorded"));
      expect(rows.at(-1).meta).toMatchObject({ amount: 5_000_000, expected: 4_855_200, fieldUsers: 4, months: 12 });

      // Теперь организация на «Стандарте» — прежний Basic ей уже не вернуть.
      await expect(a.recordPayment({ tenantId: id, amount: 299_000, paidAt: day, method: "cash", plan: "basic", months: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    } finally {
      vi.useRealTimers();
    }
  });
});
