/**
 * Причина «без заказа» при закрытии визита — через настоящие ручки.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Агент отмечал визит «посещён», заказа не было, и почему — не знал никто:
 * в плане визита не было места для причины, а связи визита с заказом нет вовсе.
 *
 * ── Что проверяется (настоящая база, agent.updatePlanStatus / saveVisitPhoto
 *    / getPlans) ──────────────────────────────────────────────────────────────
 *
 *  1. Веб-путь: причина записывается; «Другое» — с текстом (обрезанным),
 *     у прочих причин текст не хранится.
 *  2. «Другое» без текста (и из одних пробелов) — отказ, визит не закрыт.
 *     Текст длиннее 200 — отказ.
 *  3. Старый клиент без полей: визит закрывается как раньше, причина пустая;
 *     повтор старой отметки не стирает причину, записанную с веба.
 *  4. Заказ того же агента тому же магазину в день плана: getPlans говорит
 *     hasOrder, причина не записывается. Заказ ДРУГОГО агента или в другой
 *     день — не считается. Удалённый заказ — не считается.
 *  5. «Пропущен» и возврат в «запланирован» стирают причину.
 *  6. Снимок (saveVisitPhoto): «Другое» без текста — отказ ДО снимка (план не
 *     посещён, фото не легло); с причиной — записана.
 *  7. Чужой план агенту — NOT_FOUND, причина не записана.
 *
 * Нарочные поломки (каждая роняет свою проверку):
 *   • в services/no-order-visits.ts noOrderFields убрать проверку
 *     note_required — 2 и 6;
 *   • в agent-router.ts noOrderPatch `if (input.noOrderReason === undefined)
 *     return {}` → `return { noOrderReason: null, noOrderNote: null }` — 3;
 *   • в services/no-order-visits.ts visitHasOrderSql убрать условие
 *     `vo.agent_id = …` — 4.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

describe.skipIf(!hasRealDb)("причина «без заказа» при закрытии визита", () => {
  let db: ServiceDb;
  let s: Seeded;
  let otherAgentId: number;
  let n = 0;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    const [u] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Другой агент", email: "agent2@test.local", passwordHash: "x", role: "agent" });
    otherAgentId = Number(u.insertId);
  });

  const router = async () => (await import("../../agent-router")).agentRouter;
  const asAgent = async (id = s.agentId) => (await router()).createCaller(ctxFor(db, s.tenantId, id, "agent"));

  async function today(): Promise<string> {
    const r = await db.execute(sql`SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS d`);
    return String((r as unknown as [Array<{ d: string }>])[0][0].d);
  }
  async function plan(agentId = s.agentId, day?: string): Promise<number> {
    const [r] = await db.insert(schema.dailyPlans).values({
      tenantId: s.tenantId, agentId, shopId: s.shopId, planDate: sql`${day ?? await today()}` as never,
    });
    return Number(r.insertId);
  }
  async function order(o: { agentId?: number; daysAgo?: number; deleted?: boolean } = {}) {
    await db.insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: o.agentId ?? s.agentId, orderNumber: `№NO-${++n}`,
      status: "new", paymentMethod: "cash", subtotal: "100.00", total: "100.00",
      createdAt: sql`DATE_SUB(NOW(), INTERVAL ${o.daysAgo ?? 0} DAY)`,
      deletedAt: o.deleted ? sql`NOW()` : null,
    } as never);
  }
  async function row(id: number) {
    const [r] = await db.select({
      status: schema.dailyPlans.status, reason: schema.dailyPlans.noOrderReason,
      note: schema.dailyPlans.noOrderNote, photo: schema.dailyPlans.photoUrl,
    }).from(schema.dailyPlans).where(eq(schema.dailyPlans.id, id));
    return r;
  }

  it("1. веб-путь: причина записана; «Другое» — с обрезанным текстом; у прочих текст не хранится", async () => {
    const a = await plan();
    await (await asAgent()).updatePlanStatus({ planId: a, status: "visited", noOrderReason: "no_money", noOrderNote: "лишнее" });
    expect(await row(a)).toMatchObject({ status: "visited", reason: "no_money", note: null });

    const b = await plan(otherAgentId);
    await (await asAgent(otherAgentId)).updatePlanStatus({ planId: b, status: "visited", noOrderReason: "other", noOrderNote: "  ремонт фасада  " });
    expect(await row(b)).toMatchObject({ reason: "other", note: "ремонт фасада" });
  });

  it("2. «Другое» без текста, из пробелов или слишком длинное — отказ, визит не закрыт", async () => {
    const a = await plan();
    const caller = await asAgent();
    await expect(caller.updatePlanStatus({ planId: a, status: "visited", noOrderReason: "other" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.updatePlanStatus({ planId: a, status: "visited", noOrderReason: "other", noOrderNote: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.updatePlanStatus({ planId: a, status: "visited", noOrderReason: "competitor", noOrderNote: "я".repeat(201) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await row(a)).toMatchObject({ status: "planned", reason: null });
  });

  it("3. старый клиент без полей закрывает визит; повтор старой отметки причину не стирает", async () => {
    const a = await plan();
    const caller = await asAgent();
    await caller.updatePlanStatus({ planId: a, status: "visited" });
    expect(await row(a)).toMatchObject({ status: "visited", reason: null });

    await caller.updatePlanStatus({ planId: a, status: "visited", noOrderReason: "has_stock" });
    await caller.updatePlanStatus({ planId: a, status: "visited" }); // офлайн-очередь старой мобилки
    expect(await row(a)).toMatchObject({ status: "visited", reason: "has_stock" });
  });

  it("4. заказ того же агента в тот же день — hasOrder и без причины; чужой, вчерашний и удалённый не считаются", async () => {
    const a = await plan();
    const caller = await asAgent();
    await order({ agentId: otherAgentId });
    await order({ daysAgo: 1 });
    await order({ deleted: true });
    let plans = await caller.getPlans({});
    expect(plans.find(p => p.id === a)?.hasOrder, "чужой/вчерашний/удалённый заказ засчитан визиту").toBe(false);

    await order();
    plans = await caller.getPlans({});
    expect(plans.find(p => p.id === a)?.hasOrder).toBe(true);
    await caller.updatePlanStatus({ planId: a, status: "visited", noOrderReason: "closed" });
    expect(await row(a), "визит с заказом получил причину «без заказа»").toMatchObject({ status: "visited", reason: null });
  });

  it("5. «пропущен» и возврат в «запланирован» стирают причину", async () => {
    const a = await plan();
    const caller = await asAgent();
    await caller.updatePlanStatus({ planId: a, status: "visited", noOrderReason: "no_owner" });
    await caller.updatePlanStatus({ planId: a, status: "skipped", noOrderReason: "no_owner" });
    expect(await row(a)).toMatchObject({ status: "skipped", reason: null });
    await caller.updatePlanStatus({ planId: a, status: "visited", noOrderReason: "closed" });
    await caller.updatePlanStatus({ planId: a, status: "planned" });
    expect(await row(a)).toMatchObject({ status: "planned", reason: null });
  });

  it("6. снимок: «Другое» без текста — отказ до снимка; с причиной — записана", async () => {
    const a = await plan();
    const caller = await asAgent();
    const photoUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    await expect(caller.saveVisitPhoto({ planId: a, photoUrl, noOrderReason: "other" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await row(a)).toMatchObject({ status: "planned", photo: null });

    await caller.saveVisitPhoto({ planId: a, photoUrl, noOrderReason: "competitor" });
    expect(await row(a)).toMatchObject({ status: "visited", reason: "competitor", photo: photoUrl });

    // Старый клиент со снимком — как раньше.
    const b = await plan(otherAgentId);
    await (await asAgent(otherAgentId)).saveVisitPhoto({ planId: b, photoUrl });
    expect(await row(b)).toMatchObject({ status: "visited", reason: null });
  });

  it("7. чужой план — NOT_FOUND, причина не записана", async () => {
    const a = await plan(otherAgentId);
    await expect((await asAgent()).updatePlanStatus({ planId: a, status: "visited", noOrderReason: "closed" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await row(a)).toMatchObject({ status: "planned", reason: null });
  });
});
