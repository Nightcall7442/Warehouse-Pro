/**
 * Истёкшая подписка: предупреждение → 24 часа → доступ закрыт.
 * На настоящей MySQL, через настоящие ручки и настоящую калитку.
 *
 * ── Решение владельца (10.10.2026, навсегда и для всех организаций) ─────────
 *
 * «Предупреждай, что срок вашей подписки истёк, и если он игнорирует это в
 * течение 24 часов — закрой доступ». Повод: организация работала после конца
 * подписки — калитка сервера давала «не оплачена» неделю льготы и пускала
 * бессрочно при пустой дате, а консоль считала срок по другим полям и писала
 * «истекла».
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  · первый запрос после конца срока — пускает и записывает предупреждение;
 *    лента объявлений (её показывает мобилка) отдаёт его первым, полоса сайта
 *    получает время закрытия; руководителю — «продлите», агенту — «сообщите
 *    руководителю»;
 *  · через 23 часа — ещё пускает, время предупреждения не сдвигается;
 *  · через 24 часа — рабочие ручки закрыты, оплата открыта;
 *  · продление — пускает и стирает предупреждение; следующий конец срока
 *    начинает свой отсчёт, а не наследует старый;
 *  · пробная без даты в подписке, но с датой в карточке — тоже кончается
 *    (так консоль и показывала «истёк», а сервер пускал);
 *  · «не оплачена» — 24 часа, а не прежние 7 дней;
 *  · подписка без даты конца — бессрочная, предупреждения нет.
 *
 * ── Нарочные поломки ────────────────────────────────────────────────────────
 *
 *  • калитка пускает всё «ended» (accessAllowed → true) — падают «24 часа» и
 *    «не оплачена»;
 *  • не писать предупреждение (writeNotice игнорировать) — падает «первый
 *    запрос» (в базе пусто) и «23 часа» (отсчёт ползёт за «сейчас»);
 *  • считать 24 часа от даты конца, а не от предупреждения — падает «первый
 *    запрос» (организация, не заходившая сутки, заперта без предупреждения);
 *  • не сбрасывать старое предупреждение (noticeIsCurrent без сравнения с
 *    концом срока) — ловит правило в src/__tests__/expiry-warning-on-screen
 *    («от прошлого срока не считается»): здесь продление стирает его раньше;
 *  • без запасной даты из карточки — падает «пробная без даты»;
 *  • вернуть past_due семь дней — падает «не оплачена»;
 *  • убрать предупреждение из ленты объявлений — падает «первый запрос».
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import { EXPIRY_ANNOUNCEMENT_ID } from "../../../contracts/subscription-access";
import { SUBSCRIPTION_REQUIRED } from "../../../contracts/constants";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
// Здесь — настоящая калитка, а не умолчание «подписка есть» из setup-subscription.
vi.mock("../../lib/feature-gating", async (importOriginal) => importOriginal());

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = new Date("2026-10-10T10:00:00Z");

describe.skipIf(!hasRealDb)("истёкшая подписка: предупреждение → 24 часа → закрыто", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  afterEach(() => { vi.useRealTimers(); });

  const at = async (when: Date) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(when);
    // Кеш доступа держит ответ минуту — каждое «сейчас» спрашиваем заново.
    (await import("../../lib/feature-gating")).invalidateSubscriptionAccess(s.tenantId);
  };
  const app = async (role = "ceo") =>
    (await import("../../router")).appRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, role));
  const work = async () => (await app()).announcement.active();
  const notice = async () =>
    (await db.select({ n: schema.subscriptions.expiryNoticeAt }).from(schema.subscriptions)
      .where(eq(schema.subscriptions.tenantId, s.tenantId)))[0]?.n ?? null;
  const setSub = async (v: Partial<typeof schema.subscriptions.$inferInsert>) => {
    await db.delete(schema.subscriptions).where(eq(schema.subscriptions.tenantId, s.tenantId));
    await db.insert(schema.subscriptions).values({ id: randomUUID(), tenantId: s.tenantId, plan: "trial", status: "trialing", ...v } as never);
  };

  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    // Пробная кончилась вчера; организация с тех пор не заходила.
    await setSub({ status: "trialing", trialEndsAt: new Date(T0.getTime() - DAY), currentPeriodEnds: new Date(T0.getTime() - DAY) });
  });

  it("первый запрос после конца — пускает, пишет предупреждение, лента и полоса его показывают", async () => {
    await at(T0);
    const feed = await work();
    expect(await notice(), "предупреждение не записано — отсчёт не начался").toEqual(T0);

    // Мобилка: первым в ленте, руководителю — «продлите», время — по Ташкенту.
    expect(feed[0]).toMatchObject({ id: EXPIRY_ANNOUNCEMENT_ID, level: "warning", title: "Срок вашей подписки истёк" });
    expect(feed[0].body).toContain("11.10, 15:00");
    expect(feed[0].bodyUz).toContain("11.10, 15:00");
    const agentFeed = await (await app("agent")).announcement.active();
    expect(agentFeed[0].body, "агенту — к руководителю").toContain("Сообщите руководителю");

    // Сайт: состояние и время закрытия.
    const sub = await (await app()).stripe.getSubscription();
    expect(sub.access).toMatchObject({ state: "grace", canRenew: true });
    expect(new Date(sub.access.closesAt!)).toEqual(new Date(T0.getTime() + DAY));

    // Крестик в мобилке не падает и предупреждение не исчезает насовсем.
    expect(await (await app()).announcement.dismiss({ id: EXPIRY_ANNOUNCEMENT_ID })).toEqual({ ok: true });
    expect((await work())[0].id).toBe(EXPIRY_ANNOUNCEMENT_ID);
  });

  it("через 23 часа — ещё пускает, отсчёт не сдвигается", async () => {
    await at(T0);
    await work();
    await at(new Date(T0.getTime() + 23 * HOUR));
    await expect(work()).resolves.toBeDefined();
    expect(await notice(), "каждый запрос переписывал время — 24 часа никогда не кончатся").toEqual(T0);
  });

  it("через 24 часа — рабочие ручки закрыты, оплата открыта", async () => {
    await at(T0);
    await work();
    await at(new Date(T0.getTime() + DAY + 60_000));
    await expect(work()).rejects.toMatchObject({ code: "FORBIDDEN", message: SUBSCRIPTION_REQUIRED.ru });
    await expect((await app()).billing.status()).resolves.toBeDefined();
    expect((await (await app()).stripe.getSubscription()).access.state).toBe("closed");
  });

  it("продление — пускает и стирает предупреждение; следующий конец — свой отсчёт", async () => {
    await at(T0);
    await work();
    await at(new Date(T0.getTime() + 25 * HOUR));
    await expect(work()).rejects.toMatchObject({ code: "FORBIDDEN" });

    const sa = (await import("../../router")).appRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "superadmin"));
    await sa.tenant.updatePlan({ tenantId: s.tenantId, plan: "standard", expiryDays: 30 });
    await expect(work()).resolves.toBeDefined();
    expect(await notice(), "после продления предупреждение осталось").toBeNull();

    // Оплаченный месяц кончился — снова 24 часа, а не «закрыто» по старому предупреждению.
    const ends = (await db.select({ e: schema.subscriptions.currentPeriodEnds }).from(schema.subscriptions)
      .where(eq(schema.subscriptions.tenantId, s.tenantId)))[0].e!;
    const later = new Date(ends.getTime() + 3 * DAY);
    await at(later);
    await expect(work(), "старое предупреждение заперло без нового").resolves.toBeDefined();
    expect(await notice()).toEqual(later);
  });

  it("пробная без даты в подписке, но с датой в карточке — кончается тоже", async () => {
    await setSub({ status: "trialing", trialEndsAt: null, currentPeriodEnds: null });
    await db.update(schema.tenants).set({ trialEndsAt: new Date(T0.getTime() - 5 * DAY) } as never).where(eq(schema.tenants.id, s.tenantId));
    await at(T0);
    await work();
    expect(await notice(), "сервер счёл такую пробную бессрочной").toEqual(T0);
    await at(new Date(T0.getTime() + DAY + 60_000));
    await expect(work()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("«не оплачена» — 24 часа, а не прежние 7 дней", async () => {
    await setSub({ plan: "standard", status: "past_due", trialEndsAt: null, currentPeriodEnds: new Date(T0.getTime() - 2 * DAY) });
    await at(T0);
    await work();
    await at(new Date(T0.getTime() + DAY + 60_000));
    await expect(work(), "past_due снова пускает неделю").rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("без даты конца — бессрочная: пускает и не предупреждает", async () => {
    await setSub({ plan: "standard", status: "active", trialEndsAt: null, currentPeriodEnds: null });
    await db.update(schema.tenants).set({ planExpiresAt: null, trialEndsAt: null } as never).where(eq(schema.tenants.id, s.tenantId));
    await at(new Date(T0.getTime() + 400 * DAY));
    const feed = await work();
    expect(feed.some(a => a.id === EXPIRY_ANNOUNCEMENT_ID)).toBe(false);
    expect(await notice()).toBeNull();
  });
});
