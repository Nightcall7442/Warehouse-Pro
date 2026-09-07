/**
 * Выполнение плана — на настоящей MySQL.
 *
 * ── Почему не на заглушке ────────────────────────────────────────────────────
 *
 * Счёт целиком лежит в одном запросе: границы периода берутся из самой строки
 * плана прямо в соединении, чтобы MySQL посчитала все планы разом, а не по
 * два запроса на каждый. Заглушка сырой sql`` не исполняет — она считала бы
 * собственную подделку.
 *
 * А разница здесь решающая, и вся она в границах:
 *
 *   • period_end — это DATE, то есть полночь. Сравнение `created_at <=
 *     period_end` выбрасывает ВЕСЬ последний день плана; заказы тридцатого
 *     числа пропадали бы из месячного плана целиком;
 *   • план может быть привязан к магазину, а может не быть — и тогда условие
 *     по магазину не должно сужать ничего;
 *   • у плана без запланированных визитов доли не существует, и ноль тут
 *     читался бы как «ни одного не сделал».
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   • в план попадают только доставленные и только неудалённые заказы;
 *   • заказ последнего дня периода считается;
 *   • заказ соседнего месяца не считается;
 *   • план на магазин считает только его заказы;
 *   • чужой агент и чужая организация не подмешиваются;
 *   • доля визитов считается от запланированных.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { actualsForTargets } from "../../services/sales-target-actuals";
import {
  hasRealDb, connectRealDb, closeRealDb, truncateAll, seed,
  type ServiceDb, type Seeded,
} from "./harness";

const describeIf = hasRealDb ? describe : describe.skip;

const MONTH_START = "2026-09-01";
const MONTH_END = "2026-09-30";

describeIf("выполнение плана на настоящей базе", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); });
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); s = await seed(); });

  /** План агента на сентябрь. shopId — если план на один магазин. */
  async function target(opts: { userId?: number; shopId?: number | null } = {}) {
    const [row] = await db.insert(schema.salesTargets).values({
      tenantId: s.tenantId,
      userId: opts.userId ?? s.agentId,
      shopId: opts.shopId ?? null,
      periodType: "monthly",
      periodStart: MONTH_START,
      periodEnd: MONTH_END,
      targetAmount: "1000000.00",
      orderCountTarget: 10,
      visitTarget: "80.00",
    } as never);
    return Number(row.insertId);
  }

  /** Доставленный заказ на заданную дату. */
  async function order(opts: {
    date: string; total: string; status?: string; agentId?: number;
    shopId?: number; tenantId?: number; deleted?: boolean;
  }) {
    const [row] = await db.insert(schema.orders).values({
      tenantId: opts.tenantId ?? s.tenantId,
      shopId: opts.shopId ?? s.shopId,
      agentId: opts.agentId ?? s.agentId,
      orderNumber: `№${Math.random().toString(36).slice(2, 8)}`,
      status: (opts.status ?? "delivered") as never,
      subtotal: opts.total,
      total: opts.total,
      createdAt: new Date(opts.date),
      deletedAt: opts.deleted ? new Date() : null,
    } as never);
    return Number(row.insertId);
  }

  async function visit(date: string, status: "planned" | "visited" | "skipped") {
    await db.insert(schema.dailyPlans).values({
      tenantId: s.tenantId, agentId: s.agentId, shopId: s.shopId,
      planDate: date, status,
    } as never);
  }

  it("считает доставленные заказы периода", async () => {
    const id = await target();
    await order({ date: "2026-09-05T10:00:00Z", total: "300000.00" });
    await order({ date: "2026-09-15T10:00:00Z", total: "200000.00" });

    const out = await actualsForTargets(db, s.tenantId, [id]);

    expect(out.get(id)!.revenue).toBe(500000);
    expect(out.get(id)!.orderCount).toBe(2);
  });

  it("заказ последнего дня периода не выпадает", async () => {
    /*
      Главная ловушка. period_end — DATE, то есть полночь тридцатого. Условие
      `created_at <= period_end` выбросило бы весь последний день, и агент
      терял бы дневную выручку в конце каждого месяца.
    */
    const id = await target();
    await order({ date: "2026-09-30T18:30:00Z", total: "400000.00" });

    const out = await actualsForTargets(db, s.tenantId, [id]);
    expect(out.get(id)!.revenue).toBe(400000);
  });

  it("заказ соседнего месяца не считается", async () => {
    const id = await target();
    await order({ date: "2026-10-01T00:30:00Z", total: "999999.00" });
    await order({ date: "2026-08-31T23:30:00Z", total: "888888.00" });

    const out = await actualsForTargets(db, s.tenantId, [id]);
    expect(out.get(id)!.revenue).toBe(0);
    expect(out.get(id)!.orderCount).toBe(0);
  });

  it("недоставленный и удалённый заказы в план не идут", async () => {
    // Удаление — штатный способ исправить ошибку ввода. Заказ на девять
    // миллионов, стёртый оператором, не должен оставаться выполнением плана.
    const id = await target();
    await order({ date: "2026-09-10T10:00:00Z", total: "700000.00", status: "new" });
    await order({ date: "2026-09-11T10:00:00Z", total: "900000.00", deleted: true });
    await order({ date: "2026-09-12T10:00:00Z", total: "100000.00" });

    const out = await actualsForTargets(db, s.tenantId, [id]);
    expect(out.get(id)!.revenue).toBe(100000);
    expect(out.get(id)!.orderCount).toBe(1);
  });

  it("план на магазин считает только его заказы", async () => {
    const [otherShop] = await db.insert(schema.shops)
      .values({ tenantId: s.tenantId, name: "Магазин Бета" } as never);
    const otherShopId = Number(otherShop.insertId);

    const id = await target({ shopId: s.shopId });
    await order({ date: "2026-09-05T10:00:00Z", total: "300000.00" });
    await order({ date: "2026-09-06T10:00:00Z", total: "500000.00", shopId: otherShopId });

    const out = await actualsForTargets(db, s.tenantId, [id]);
    expect(out.get(id)!.revenue).toBe(300000);
  });

  it("план без магазина считает всю работу агента", async () => {
    const [otherShop] = await db.insert(schema.shops)
      .values({ tenantId: s.tenantId, name: "Магазин Бета" } as never);

    const id = await target({ shopId: null });
    await order({ date: "2026-09-05T10:00:00Z", total: "300000.00" });
    await order({ date: "2026-09-06T10:00:00Z", total: "500000.00", shopId: Number(otherShop.insertId) });

    const out = await actualsForTargets(db, s.tenantId, [id]);
    expect(out.get(id)!.revenue).toBe(800000);
  });

  it("чужой агент в план не попадает", async () => {
    const [other] = await db.insert(schema.users).values({
      tenantId: s.tenantId, name: "Второй агент", email: "a2@test.local",
      passwordHash: "x", role: "agent",
    } as never);

    const id = await target({ userId: s.agentId });
    await order({ date: "2026-09-05T10:00:00Z", total: "300000.00" });
    await order({ date: "2026-09-06T10:00:00Z", total: "700000.00", agentId: Number(other.insertId) });

    const out = await actualsForTargets(db, s.tenantId, [id]);
    expect(out.get(id)!.revenue).toBe(300000);
  });

  it("доля визитов считается от запланированных", async () => {
    const id = await target();
    await visit("2026-09-02", "visited");
    await visit("2026-09-03", "visited");
    await visit("2026-09-04", "planned");
    await visit("2026-09-05", "skipped");

    const out = await actualsForTargets(db, s.tenantId, [id]);
    expect(out.get(id)!.visitPct).toBe(50);
  });

  it("без запланированных визитов доля нулевая, а не ошибка", async () => {
    const id = await target();
    const out = await actualsForTargets(db, s.tenantId, [id]);
    expect(out.get(id)!.visitPct).toBe(0);
  });

  it("несколько планов считаются одним запросом и не путаются", async () => {
    /*
      Ради этого счёт и переписан: у экрана начальника планов два-три десятка,
      и по два запроса на каждый — уже не отчёт, а нагрузка. Проверяется, что
      разом посчитанные планы не перемешались.
    */
    const [second] = await db.insert(schema.users).values({
      tenantId: s.tenantId, name: "Второй агент", email: "a2@test.local",
      passwordHash: "x", role: "agent",
    } as never);
    const secondAgent = Number(second.insertId);

    const mine = await target({ userId: s.agentId });
    const theirs = await target({ userId: secondAgent });

    await order({ date: "2026-09-05T10:00:00Z", total: "300000.00" });
    await order({ date: "2026-09-06T10:00:00Z", total: "700000.00", agentId: secondAgent });

    const out = await actualsForTargets(db, s.tenantId, [mine, theirs]);
    expect(out.get(mine)!.revenue).toBe(300000);
    expect(out.get(theirs)!.revenue).toBe(700000);
  });

  it("чужая организация не подмешивается", async () => {
    const [otherShop] = await db.insert(schema.shops)
      .values({ tenantId: s.otherTenantId, name: "Чужой магазин" } as never);
    const [otherAgent] = await db.insert(schema.users).values({
      tenantId: s.otherTenantId, name: "Чужой агент", email: "x@other.local",
      passwordHash: "x", role: "agent",
    } as never);

    const id = await target();
    await order({
      date: "2026-09-05T10:00:00Z", total: "999999.00",
      tenantId: s.otherTenantId, shopId: Number(otherShop.insertId),
      agentId: Number(otherAgent.insertId),
    });

    const out = await actualsForTargets(db, s.tenantId, [id]);
    expect(out.get(id)!.revenue).toBe(0);
  });

  it("заказ, вернувшийся из архива, считается в месяце второго круга", async () => {
    /*
      Связка с передатировкой: order-reopen двигает created_at на день
      возврата в работу. План августа такой заказ терять обязан, план сентября
      — считать, иначе деньги второго круга останутся в закрытом месяце.
    */
    const id = await target();
    const orderId = await order({ date: "2026-08-10T10:00:00Z", total: "250000.00" });

    // Так выглядит заказ после возврата в работу и повторной доставки.
    await db.update(schema.orders)
      .set({ createdAt: new Date("2026-09-20T10:00:00Z"), firstOrderedAt: new Date("2026-08-10T10:00:00Z") })
      .where(eq(schema.orders.id, orderId));

    const out = await actualsForTargets(db, s.tenantId, [id]);
    expect(out.get(id)!.revenue).toBe(250000);
  });
});
