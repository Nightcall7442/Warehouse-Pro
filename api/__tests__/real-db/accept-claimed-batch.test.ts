import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

/**
 * Вечерняя сдача курьера пачкой — «Принять по заявленному», на настоящей базе
 * и через настоящие ручки (order.claimPlan, order.acceptClaimed, order.close).
 *
 * Что было: по каждому доставленному заказу оператор открывал карточку и жал
 * «Закрыть расчёт» — 20–40 раз за вечер, 10–20 минут, ошибки от спешки.
 *
 * Что проверяется:
 *   · смешанная пачка: точные совпадения закрыты; расхождение на тийин, уже
 *     закрытый, без заявленного, не доставленный пропущены с причиной — и
 *     сервер отказывает, даже если клиент прислал их в пачке;
 *   · деньги и долг после пачки — ровно как после одиночных «Закрыть расчёт»
 *     тех же заказов: платежи, отметки «получено», долг магазина, недостача,
 *     напоминания о долге и срок;
 *   · журнал: по записи «order.closed» на каждый закрытый заказ, с пометкой
 *     «пачкой»; пропущенные в журнал не попадают;
 *   · итог устарел (заявленное изменилось между итогом и нажатием) — заказ
 *     пропущен «сумма изменилась», а не закрыт с недостачей;
 *   · гонка: тот же заказ одновременно закрывают пачкой и одиночно — закрыт
 *     один раз, одна запись в журнале;
 *   · чужой арендатор — «не найден», его заказ не тронут; агент, курьер,
 *     супервайзер и оператор без «Принимать оплату» — отказ.
 *
 * Нарочная поломка (проверено): в OrderCloseService.close убрать проверку
 * exactClaim (claimVerdict) — падают «смешанная пачка» и «итог устарел»;
 * убрать `.for("update")` у выборки заказа — «гонка» даёт две записи журнала;
 * в acceptClaimed ловить ошибку одной сделкой на всю пачку (без try внутри
 * цикла) — «смешанная пачка» теряет результаты после первого пропуска.
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/telegram", async (orig) => ({ ...(await orig<object>()), sendTelegram: vi.fn(async () => true), notifyTenantRole: vi.fn(async () => undefined) }));

describe.skipIf(!hasRealDb)("«Принять по заявленному»: вечерняя сдача курьера пачкой", () => {
  let db: ServiceDb;
  let s: Seeded;
  let operatorId = 0;
  let ceoId = 0;
  let n = 0;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("50.000");
    const [op] = await (db as any).insert(schema.users).values({ tenantId: s.tenantId, name: "Оператор", email: "op@test.local", passwordHash: "x", role: "operator" });
    operatorId = Number(op.insertId);
    const [c] = await (db as any).insert(schema.users).values({ tenantId: s.tenantId, name: "Директор", email: "ceo@test.local", passwordHash: "x", role: "ceo" });
    ceoId = Number(c.insertId);
  });

  const router = async () => (await import("../../order-router")).orderRouter;
  const as = async (userId: number, role: string, tenantId = s.tenantId) => (await router()).createCaller(ctxFor(db, tenantId, userId, role));

  /** Доставленный заказ на `total` с платежами курьера: [сумма, способ]. */
  const delivered = async (total: string, pays: Array<[string, "cash" | "card" | "transfer"]>, o: { shopId?: number; tenantId?: number; status?: string } = {}) => {
    const tenantId = o.tenantId ?? s.tenantId;
    const [r] = await (db as any).insert(schema.orders).values({
      tenantId, shopId: o.shopId ?? s.shopId, agentId: s.agentId, courierId: s.courierId, orderNumber: `ПЧ-${++n}`,
      status: o.status ?? "delivered", deliveryStatus: "delivered", paymentMethod: "cash", subtotal: total, total, deliveredAt: new Date(),
    });
    const id = Number(r.insertId);
    for (const [amount, method] of pays) {
      await (db as any).insert(schema.payments).values({ tenantId, shopId: o.shopId ?? s.shopId, orderId: id, amount, type: "payment", paymentMethod: method, status: "partially_paid", createdBy: s.courierId });
    }
    return id;
  };
  const closedAt = async (id: number) => ((await (db as any).select({ c: schema.orders.closedAt }).from(schema.orders).where(eq(schema.orders.id, id)))[0]?.c ?? null) as Date | null;
  const journal = async (ids: number[]) => (await (db as any).select({ targetId: schema.auditLog.targetId, meta: schema.auditLog.meta }).from(schema.auditLog)
    .where(and(eq(schema.auditLog.action, "order.closed"), inArray(schema.auditLog.targetId, ids)))) as Array<{ targetId: number; meta: Record<string, unknown> }>;

  it("смешанная пачка: точные закрыты, остальные пропущены с причиной — даже если клиент прислал их", async () => {
    const op = await as(operatorId, "operator");
    const full = await delivered("300.00", [["300.00", "cash"]]);
    const split = await delivered("250.50", [["150.50", "cash"], ["100.00", "card"]]);
    const short = await delivered("300.00", [["299.99", "cash"]]);
    const done = await delivered("300.00", [["300.00", "cash"]]);
    const none = await delivered("300.00", []);
    const fresh = await delivered("300.00", [["300.00", "cash"]], { status: "shipped" });
    await (await as(ceoId, "ceo")).close({ orderId: done, cashReceived: 300 });
    const doneAt = await closedAt(done);

    const plan = await op.claimPlan({ orderIds: [full, split, short, done, none, fresh] });
    expect(plan.rows.map(r => [r.id, r.reason])).toEqual([[full, null], [split, null], [short, "mismatch"], [done, "closed"], [none, "no_claim"], [fresh, "not_delivered"]]);
    expect(plan.ready, "итог до нажатия: сколько и на какую сумму").toEqual({ count: 2, amount: 450.5 });
    expect(plan.rows.find(r => r.id === short)).toMatchObject({ claimed: 299.99, due: 300 });

    // Клиент прислал всё подряд — сервер сам отбирает точные.
    const r = await op.acceptClaimed({ items: [
      { orderId: full, claimed: 300 }, { orderId: short, claimed: 299.99 }, { orderId: split, claimed: 150.5 },
      { orderId: done, claimed: 300 }, { orderId: none, claimed: 1 }, { orderId: fresh, claimed: 300 },
    ] });
    expect(r.results.map(x => [x.orderId, x.closed, x.reason ?? null])).toEqual([
      [full, true, null], [short, false, "mismatch"], [split, true, null], [done, false, "closed"], [none, false, "no_claim"], [fresh, false, "not_delivered"],
    ]);
    expect({ closed: r.closed, amount: r.amount }).toEqual({ closed: 2, amount: 450.5 });

    expect(await closedAt(full)).not.toBeNull();
    expect(await closedAt(split)).not.toBeNull();
    expect(await closedAt(short), "расхождение закрылось пачкой").toBeNull();
    expect(await closedAt(none)).toBeNull();
    expect(await closedAt(fresh)).toBeNull();
    expect((await closedAt(done))?.getTime(), "уже закрытый закрыли второй раз").toBe(doneAt?.getTime());
    // Недостачи ни у кого: закрыто только точное.
    const shortage = await (db as any).select({ s: sql<string>`coalesce(sum(${schema.orders.courierShortage}), 0)` }).from(schema.orders);
    expect(Number(shortage[0].s)).toBe(0);

    // Журнал: по записи на закрытый, с пометкой «пачкой»; пропущенных нет.
    const j = await journal([full, split, short, none, fresh]);
    expect(j.map(x => x.targetId).sort()).toEqual([full, split].sort());
    expect(j.every(x => x.meta.batch === true && Number(x.meta.shortage) === 0 && Number(x.meta.debt) === 0)).toBe(true);
    // Директор читает журнал словами: «Пачкой: да», а не «batch: true».
    const { describeMeta } = await import("@contracts/audit-text");
    expect(describeMeta(j[0].meta, "ru")).toContain("Пачкой: да");
  });

  it("деньги, долг и напоминания — ровно как после одиночных «Закрыть расчёт»", async () => {
    const { OrderService } = await import("../../services/order");
    const { courierRouter } = await import("../../courier-router");
    const [b] = await (db as any).insert(schema.shops).values({ tenantId: s.tenantId, name: "Магазин Бета" });
    const shops = [s.shopId, Number(b.insertId)];

    /** Одинаковый набор в каждом магазине: заказ через телефон курьера и заказ с картой и напоминанием. */
    const build = async (shopId: number) => {
      const created = await OrderService.create(db, s.tenantId, s.agentId, { shopId, paymentMethod: "cash", items: [{ productId: s.productId, quantity: "2" }] });
      const id = (created as { id: number }).id;
      const op = courierRouter.createCaller(ctxFor(db, s.tenantId, operatorId, "operator"));
      const courier = courierRouter.createCaller(ctxFor(db, s.tenantId, s.courierId, "courier"));
      await op.assignCourier({ orderId: id, courierId: s.courierId });
      await courier.markOutForDelivery({ orderId: id });
      await courier.completeDelivery({ orderId: id, result: "paid", paymentMethod: "cash", paidAmount: "200" });
      const split = await delivered("250.50", [["150.50", "cash"], ["100.00", "card"]], { shopId });
      await (db as any).insert(schema.debtReminders).values({ tenantId: s.tenantId, shopId, orderId: split, amount: "100.00", dueDate: sql`'2099-10-10'` });
      return [id, split];
    };
    const [batchIds, singleIds] = [await build(shops[0]), await build(shops[1])];

    const op = await as(operatorId, "operator");
    const plan = await op.claimPlan({ orderIds: batchIds });
    expect(plan.ready.count).toBe(2);
    await op.acceptClaimed({ items: plan.rows.map(r => ({ orderId: r.id, claimed: r.claimed })) });
    for (const id of singleIds) {
      const m = await op.money({ orderId: id });
      await op.close({ orderId: id, cashReceived: m.claimed });
    }

    const moneyOf = async (id: number) => {
      const m = await op.money({ orderId: id });
      return { total: m.total, paid: m.paid, remainder: m.remainder, claimed: m.claimed, inTransit: m.inTransit, received: m.received, awaiting: m.awaiting, shortage: m.shortage, closedByName: m.closedByName };
    };
    const paysOf = async (id: number) => (await (db as any).select().from(schema.payments).where(eq(schema.payments.orderId, id)).orderBy(schema.payments.id))
      .map((p: any) => ({ amount: p.amount, method: p.paymentMethod, type: p.type, status: p.status, received: p.receivedAt != null, receivedBy: p.receivedBy, bank: p.bankConfirmedAt != null, due: p.debtDueDate }));
    const orderOf = async (id: number) => {
      const [o] = await (db as any).select().from(schema.orders).where(eq(schema.orders.id, id));
      return { status: o.status, closed: o.closedAt != null, closedBy: o.closedBy, shortage: o.courierShortage, shortageUserId: o.shortageUserId };
    };
    const remindersOf = async (id: number) => (await (db as any).execute(sql`
      SELECT CAST(amount AS DECIMAL(15,2)) AS amount, DATE_FORMAT(due_date, '%Y-%m-%d') AS dueDate, status FROM debt_reminders WHERE order_id = ${id} ORDER BY id`) as unknown as [Array<Record<string, unknown>>])[0]
      .map(r => ({ amount: Number(r.amount), dueDate: String(r.dueDate), status: String(r.status) }));

    for (let i = 0; i < 2; i++) {
      const [x, y] = [batchIds[i], singleIds[i]];
      expect(await moneyOf(x), `деньги заказа ${i}`).toEqual(await moneyOf(y));
      expect(await paysOf(x), `платежи заказа ${i}`).toEqual(await paysOf(y));
      expect(await orderOf(x), `заказ ${i}`).toEqual(await orderOf(y));
      expect(await remindersOf(x), `напоминания заказа ${i}`).toEqual(await remindersOf(y));
    }
    expect((await moneyOf(batchIds[0])).awaiting).toBe(false);
    expect(await remindersOf(batchIds[1]), "срок долга потерялся").toEqual([{ amount: 100, dueDate: "2099-10-10", status: "pending" }]);
    const debt = async (shopId: number) => (await (db as any).select({ d: schema.shops.debt }).from(schema.shops).where(eq(schema.shops.id, shopId)))[0].d;
    expect(await debt(shops[0]), "долг магазина").toBe(await debt(shops[1]));
  });

  it("итог устарел — «сумма изменилась», заказ не закрыт и недостачи нет", async () => {
    const op = await as(operatorId, "operator");
    const id = await delivered("300.00", [["300.00", "cash"]]);
    // Оператор видел 290 (итог до того, как курьер поправил запись), сейчас заявлено 300.
    const r = await op.acceptClaimed({ items: [{ orderId: id, claimed: 290 }] });
    expect(r.results).toEqual([{ orderId: id, closed: false, amount: 0, reason: "changed" }]);
    expect(await closedAt(id)).toBeNull();
    expect(await journal([id])).toEqual([]);
  });

  it("гонка: пачка и одиночное «Закрыть расчёт» по одному заказу — закрыт один раз", async () => {
    const op = await as(operatorId, "operator");
    const ceo = await as(ceoId, "ceo");
    const ids = [await delivered("300.00", [["300.00", "cash"]]), await delivered("120.00", [["120.00", "cash"]]), await delivered("75.25", [["75.25", "cash"]])];
    for (const id of ids) {
      const claimed = (await op.money({ orderId: id })).claimed;
      const [batch, single] = await Promise.allSettled([
        op.acceptClaimed({ items: [{ orderId: id, claimed }] }),
        ceo.close({ orderId: id, cashReceived: claimed }),
      ]);
      const batchClosed = batch.status === "fulfilled" && batch.value.results[0].closed;
      const singleClosed = single.status === "fulfilled";
      expect([batchClosed, singleClosed].filter(Boolean), `заказ ${id}: закрыт дважды или ни разу`).toHaveLength(1);
      if (!batchClosed) expect(batch.status === "fulfilled" && batch.value.results[0].reason).toBe("closed");
      expect(await journal([id]), "две записи о закрытии").toHaveLength(1);
      const pays = await (db as any).select().from(schema.payments).where(eq(schema.payments.orderId, id));
      expect(pays, "лишний платёж").toHaveLength(1);
      expect(pays[0].receivedAt).not.toBeNull();
    }
  });

  it("чужой арендатор: «не найден», его заказ не тронут", async () => {
    const op = await as(operatorId, "operator");
    const [shop] = await (db as any).insert(schema.shops).values({ tenantId: s.otherTenantId, name: "Чужой магазин" });
    const foreign = await delivered("300.00", [["300.00", "cash"]], { tenantId: s.otherTenantId, shopId: Number(shop.insertId) });
    const plan = await op.claimPlan({ orderIds: [foreign] });
    expect(plan.rows).toEqual([expect.objectContaining({ id: foreign, number: null, reason: "not_found" })]);
    expect(plan.ready.count).toBe(0);
    const r = await op.acceptClaimed({ items: [{ orderId: foreign, claimed: 300 }] });
    expect(r.results).toEqual([{ orderId: foreign, closed: false, amount: 0, reason: "not_found" }]);
    expect(await closedAt(foreign)).toBeNull();
    const pays = await (db as any).select().from(schema.payments).where(eq(schema.payments.orderId, foreign));
    expect(pays[0].receivedAt, "чужие наличные отмечены полученными").toBeNull();
  });

  it("права — как у «Закрыть расчёт»: полевые и супервайзер — отказ; оператор без «Принимать оплату» — отказ", async () => {
    const id = await delivered("300.00", [["300.00", "cash"]]);
    for (const [uid, role] of [[s.agentId, "agent"], [s.courierId, "courier"], [operatorId, "supervisor"]] as const) {
      const c = await as(uid, role);
      await expect(c.claimPlan({ orderIds: [id] }), `${role}: итог`).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(c.acceptClaimed({ items: [{ orderId: id, claimed: 300 }] }), `${role}: пачка`).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const { forgetCapabilities } = await import("../../lib/role-permissions");
    await (db as any).insert(schema.rolePermissions).values({ tenantId: s.tenantId, role: "operator", capability: "payments.accept", allowed: false });
    forgetCapabilities(s.tenantId, "operator");
    try {
      const op = await as(operatorId, "operator");
      await expect(op.claimPlan({ orderIds: [id] })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(op.acceptClaimed({ items: [{ orderId: id, claimed: 300 }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
      // Директору настройка оператора не мешает — как у одиночного закрытия.
      expect((await (await as(ceoId, "ceo")).acceptClaimed({ items: [{ orderId: id, claimed: 300 }] })).closed).toBe(1);
    } finally {
      await (db as any).delete(schema.rolePermissions).where(eq(schema.rolePermissions.tenantId, s.tenantId));
      forgetCapabilities(s.tenantId, "operator");
    }
    expect(await closedAt(id)).not.toBeNull();
  });
});
