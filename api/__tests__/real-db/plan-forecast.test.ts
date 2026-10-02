/**
 * Прогноз выполнения месячного плана — на настоящей MySQL, через
 * salesTarget.forecast и сервис с зафиксированным «сегодня».
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Прогноза не было: «выполнено 38%» четырнадцатого числа директор переводил
 * в «успеем или нет» в уме — и каждый по-своему.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * «Сегодня» — пятница, 14 марта 2031 года: 12 рабочих дней из 26 прошло,
 * осталось 14. Не настоящая дата — она однажды станет прошлым, и тест
 * начнёт проверять другой месяц (так уже дважды падали соседние).
 *
 *   Агент     план 2 600 000; продано 600 000 (5-го) + 500 000 (12-го),
 *             возврат 100 000 (10-го) → факт 1 000 000 → прогноз 2 166 667,
 *             83%, красный, нужно 114 286 в день.
 *             Мимо: отменённый заказ, заказ 20-го (ещё не наступило),
 *             февральские заказ и возврат.
 *   Бобур     план с 1 февраля 1 000 000 (на март не заводили — действует
 *             прошлый, как в «Цели» KPI); продано 480 000 → 1 040 000, 104%.
 *   Сабина    супервайзер с планом 500 000 и без продаж → 0%, красный.
 *   Дилшод    агент без плана → «нет плана».
 *   Офис      заказ на 200 000 — в факте компании, но не в списке.
 *   Уволенный агент с планом — не в списке и не в плане компании.
 *
 *   Компания: факт 1 680 000, план 4 100 000, прогноз 3 640 000 — 88%.
 *
 *  1. Числа сервиса — руками.
 *  2. Ручка с часами на 14 марта даёт то же самое.
 *  3. 4 марта (третий рабочий день) — «рано судить»: early и тон early.
 *  4. Права: агент, мерчендайзер, курьер — отказ.
 *  5. Чужая организация не влияет.
 *
 * ── Нарочные поломки ────────────────────────────────────────────────────────
 *
 *  • убрать вычет возвратов из факта — падает «факт и прогноз»;
 *  • брать план только этого месяца — падает «план с прошлого месяца»;
 *  • forecast: managementQuery → authedQuery — падает «права».
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import { invalidateReports } from "../../lib/report-cache";
import { planForecast } from "../../services/plan-forecast";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

/** Пятница, 14 марта 2031, полдень по часам сервера. */
const MAR14 = new Date(2031, 2, 14, 12, 0, 0);
/** Вторник, 4 марта 2031 — третий рабочий день (1-е — суббота, 2-е — воскресенье). */
const MAR4 = new Date(2031, 2, 4, 12, 0, 0);

describe.skipIf(!hasRealDb)("прогноз выполнения месячного плана", () => {
  let db: ServiceDb;
  let s: Seeded;
  const u: Record<string, number> = {};
  let n = 0;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  afterEach(() => { vi.useRealTimers(); });

  async function person(name: string, role: string, status = "active", tenantId?: number) {
    const [r] = await db.insert(schema.users).values({
      tenantId: tenantId ?? s.tenantId, name, email: `${++n}@test.local`, passwordHash: "x", role: role as never, status: status as never,
    });
    return Number(r.insertId);
  }
  async function order(agentId: number, total: number, at: string, status = "delivered", tenantId?: number, shopId?: number) {
    const [r] = await db.insert(schema.orders).values({
      tenantId: tenantId ?? s.tenantId, shopId: shopId ?? s.shopId, agentId, orderNumber: `№F-${++n}`, status: status as never,
      paymentMethod: "cash", subtotal: total.toFixed(2), total: total.toFixed(2), createdAt: new Date(at),
    } as never);
    return Number(r.insertId);
  }
  async function returned(orderId: number, amount: number, at: string) {
    await db.insert(schema.returns).values({
      tenantId: s.tenantId, shopId: s.shopId, orderId, returnNumber: `В-${++n}`, status: "completed",
      totalAmount: amount.toFixed(2), createdAt: new Date(at),
    } as never);
  }
  async function plan(userId: number, amount: number, start: string, end: string, tenantId?: number) {
    await db.insert(schema.salesTargets).values({
      tenantId: tenantId ?? s.tenantId, userId, periodType: "monthly",
      periodStart: start as never, periodEnd: end as never, targetAmount: amount.toFixed(2),
    } as never);
  }

  beforeEach(async () => {
    await truncateAll();
    await db.delete(schema.salesTargets);
    s = await seed();
    await invalidateReports(s.tenantId, "test");
    u.agent = s.agentId;
    u.bobur = await person("Бобур", "agent");
    u.sabina = await person("Сабина", "supervisor");
    u.dilshod = await person("Дилшод", "agent");
    u.office = await person("Офис", "operator");
    u.fired = await person("Уволенный", "agent", "inactive");

    await plan(u.agent, 2_600_000, "2031-03-01", "2031-03-31");
    await plan(u.agent, 9_999_999, "2031-02-01", "2031-02-28"); // прошлый месяц — перекрыт мартовским
    await plan(u.bobur, 1_000_000, "2031-02-01", "2031-02-28");
    await plan(u.sabina, 500_000, "2031-03-01", "2031-03-31");
    await plan(u.fired, 7_000_000, "2031-03-01", "2031-03-31");

    const fifth = await order(u.agent, 600_000, "2031-03-05T10:00:00");
    await order(u.agent, 500_000, "2031-03-12T15:00:00");
    await returned(fifth, 100_000, "2031-03-10T11:00:00");
    await order(u.agent, 900_000, "2031-03-11T10:00:00", "cancelled");
    await order(u.agent, 300_000, "2031-03-20T10:00:00");
    const feb = await order(u.agent, 400_000, "2031-02-15T10:00:00");
    await returned(feb, 50_000, "2031-02-20T10:00:00");
    await order(u.bobur, 480_000, "2031-03-07T09:00:00");
    await order(u.office, 200_000, "2031-03-13T09:00:00");

    // Чужая организация: план и продажи в том же марте.
    const other = await person("Чужой", "agent", "active", s.otherTenantId);
    const [os] = await db.insert(schema.shops).values({ tenantId: s.otherTenantId, name: "Чужой магазин" });
    await plan(other, 100, "2031-03-01", "2031-03-31", s.otherTenantId);
    await order(other, 5_000_000, "2031-03-06T10:00:00", "delivered", s.otherTenantId, Number(os.insertId));
  });

  it("факт и прогноз по каждому — руками; красные сверху", async () => {
    const f = await planForecast(db as never, s.tenantId, MAR14);
    expect(f).toMatchObject({ month: "2031-03", today: "2031-03-14", days: { total: 26, passed: 12, left: 14 }, early: false });
    const by = Object.fromEntries(f.agents.map(a => [a.name, a]));
    expect(Object.keys(by).sort()).toEqual(["Агент", "Бобур", "Дилшод", "Сабина"]);

    expect(by["Агент"]).toMatchObject({ fact: 1_000_000, plan: 2_600_000, forecast: 2_166_667, forecastPct: 83, needPerDay: 114_286, tone: "red", planStart: "2031-03-01" });
    expect(by["Сабина"]).toMatchObject({ fact: 0, plan: 500_000, forecast: 0, forecastPct: 0, needPerDay: 35_715, tone: "red" });
    expect(by["Дилшод"]).toMatchObject({ fact: 0, plan: null, forecastPct: null, tone: "none" });
    expect(f.agents.map(a => a.name)).toEqual(["Сабина", "Агент", "Бобур", "Дилшод"]);
  });

  it("план с прошлого месяца действует, пока на этот не завели — как в «Цели» KPI", async () => {
    const f = await planForecast(db as never, s.tenantId, MAR14);
    const bobur = f.agents.find(a => a.userId === u.bobur)!;
    expect(bobur).toMatchObject({ fact: 480_000, plan: 1_000_000, forecast: 1_040_000, forecastPct: 104, needPerDay: 37_143, tone: "green", planStart: "2031-02-01" });
  });

  it("компания: вся выручка месяца, план — сумма планов людей из списка", async () => {
    const f = await planForecast(db as never, s.tenantId, MAR14);
    expect(f.company).toEqual({
      fact: 1_680_000, plan: 4_100_000, forecast: 3_640_000, forecastPct: 88, needPerDay: 172_858, tone: "red",
    });
  });

  it("ручка с часами на 14 марта отвечает тем же", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MAR14);
    const caller = (await import("../../sales-target-router")).salesTargetRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "ceo"));
    const viaRouter = await caller.forecast();
    vi.useRealTimers();
    expect(viaRouter).toEqual(await planForecast(db as never, s.tenantId, MAR14));
  });

  it("третий рабочий день — «рано судить»", async () => {
    const f = await planForecast(db as never, s.tenantId, MAR4);
    expect(f.days).toEqual({ total: 26, passed: 3, left: 23 });
    expect(f.early).toBe(true);
    expect(f.company.tone).toBe("early");
    expect(f.agents.find(a => a.userId === u.agent)!.tone).toBe("early");
  });

  it("права: прогноз — тем, кто видит планы всех", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MAR14);
    const router = (await import("../../sales-target-router")).salesTargetRouter;
    for (const role of ["operator", "supervisor"]) {
      const r = await router.createCaller(ctxFor(db, s.tenantId, s.agentId, role)).forecast();
      expect(r.company.fact, role).toBe(1_680_000);
    }
    for (const role of ["agent", "merchandiser", "courier"]) {
      await expect(router.createCaller(ctxFor(db, s.tenantId, s.agentId, role)).forecast(), role)
        .rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});
