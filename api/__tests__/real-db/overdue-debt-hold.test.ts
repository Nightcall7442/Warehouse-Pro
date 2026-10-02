/**
 * Просроченный долг останавливает отгрузку — заказ ждёт офиса.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Кредитный лимит был только денежным и смотрелся только у заказа «в долг».
 * Магазин с долгом трёхмесячной давности, но в пределах суммы, получал товар
 * без вопросов — а за наличные и вовсе без проверки.
 *
 * ── Что проверяется (настоящая база, настоящая ручка order.create) ──────────
 *
 *  1. Настройка выключена (по умолчанию) — заказ идёт как раньше.
 *  2. Включена: просрочка по отсрочке (доставлен 30 дн. назад, отсрочка 14)
 *     ставит «ожидает» с верной суммой и возрастом; свежий долг в сумму не
 *     входит; подсказка order.shopOverdue называет те же числа; офису —
 *     уведомление с причиной на двух языках.
 *  3. Явный срок из напоминания (оплата по частям с датой): прошёл — держит,
 *     хотя отсрочка не вышла; впереди — не держит, хотя отсрочка вышла.
 *  4. Отсрочка магазина перекрывает организации в обе стороны; пусто — снова
 *     организации.
 *  5. Оплата долга — по заказу и без привязки к заказу — снимает просрочку
 *     для следующего заказа.
 *  6. Два заказа одного магазина одновременно — оба ждут, ни один не проскочил.
 *  7. Чужой арендатор не влияет: ни его настройка, ни его заказы.
 *  8. Офис снимает ожидание тем же действием, что для скидки (updateStatus);
 *     агенту оно закрыто. Заказ офиса не ждёт сам себя.
 *  9. Скидка выше порога и просрочка — обе причины через «; ».
 * 10. Повтор из офлайн-очереди тем же ключом — тот же заказ, не ошибка.
 *
 * Нарочные поломки (каждая роняет свою проверку):
 *   • в services/overdue-hold.ts `shop.grace ?? orgGrace` → `orgGrace` — 4;
 *   • в services/shop-debt.ts убрать `o.tenant_id = ${tenantId}` — 7;
 *   • в services/shop-debt.ts убрать подзапрос debt_reminders из COALESCE — 3;
 *   • в services/order-create.ts `status: txHold ? …` → `input.holdReason ? …` — 2.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { recalcShopDebt } from "../../services/shop-debt";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../services/push-service", () => ({ sendPushToUser: vi.fn(async () => undefined), sendPushToRole: vi.fn(async () => undefined) }));
vi.mock("../../services/telegram-notify", async (orig) => ({ ...(await orig<object>()), notifyEvent: vi.fn(async () => undefined) }));

describe.skipIf(!hasRealDb)("просроченный долг ставит заказ на решение офиса", () => {
  let db: ServiceDb;
  let s: Seeded;
  let operatorId: number;
  let n = 0;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("1000.000");
    const [op] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Оператор", email: "op@test.local", passwordHash: "x", role: "operator" });
    operatorId = Number(op.insertId);
  });

  const orders = async () => (await import("../../order-router")).orderRouter;
  const asAgent = async () => (await orders()).createCaller(ctxFor(db, s.tenantId, s.agentId, "agent"));
  const asOperator = async () => (await orders()).createCaller(ctxFor(db, s.tenantId, operatorId, "operator"));
  const shopsAsOperator = async () => (await import("../../shop-router")).shopRouter.createCaller(ctxFor(db, s.tenantId, operatorId, "operator"));

  /** Настройка организации: включить/выключить и отсрочка. */
  async function setOrg(tenantId: number, enabled: boolean, grace = 14, extra: Partial<typeof schema.settings.$inferInsert> = {}) {
    const [row] = await db.select({ id: schema.settings.id }).from(schema.settings).where(eq(schema.settings.tenantId, tenantId)).limit(1);
    if (row) await db.update(schema.settings).set({ overdueHoldEnabled: enabled, overdueGraceDays: grace, ...extra }).where(eq(schema.settings.id, row.id));
    else await db.insert(schema.settings).values({ tenantId, overdueHoldEnabled: enabled, overdueGraceDays: grace, ...extra });
  }

  /** Доставленный неоплаченный заказ: оформлен и доставлен столько-то дней назад (по часам базы). */
  async function delivered(o: { total: string; createdDaysAgo: number; deliveredDaysAgo: number; tenantId?: number; shopId?: number }) {
    const tenantId = o.tenantId ?? s.tenantId;
    const shopId = o.shopId ?? s.shopId;
    const [r] = await db.insert(schema.orders).values({
      tenantId, shopId, agentId: s.agentId, orderNumber: `№OD-${++n}`,
      status: "delivered", paymentMethod: "cash", subtotal: o.total, total: o.total,
      createdAt: sql`DATE_SUB(NOW(), INTERVAL ${o.createdDaysAgo} DAY)`,
      deliveredAt: sql`DATE_SUB(NOW(), INTERVAL ${o.deliveredDaysAgo} DAY)`,
    } as never);
    await db.transaction(tx => recalcShopDebt(tx, tenantId, shopId));
    return Number(r.insertId);
  }

  /** День по часам базы, «ГГГГ-ММ-ДД», со сдвигом: −1 — вчера, +1 — завтра. */
  async function dbDay(shift: number): Promise<string> {
    const res = await db.execute(sql`SELECT DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL ${shift} DAY), '%Y-%m-%d') AS d`);
    const rows = (Array.isArray(res) ? res[0] : res) as unknown as Array<{ d: string }>;
    return rows[0].d;
  }

  const newOrder = (caller: Awaited<ReturnType<typeof asAgent>>, extra: { discount?: string; idempotencyKey?: string } = {}) =>
    caller.create({ shopId: s.shopId, items: [{ productId: s.productId, quantity: "1" }], paymentMethod: "cash", idempotencyKey: extra.idempotencyKey ?? randomUUID(), ...(extra.discount ? { discount: extra.discount } : {}) });

  async function stored(id: number) {
    const [o] = await db.select({ status: schema.orders.status, holdReason: schema.orders.holdReason }).from(schema.orders).where(eq(schema.orders.id, id));
    return o;
  }

  it("1. настройка выключена — заказ идёт как раньше, подсказки нет", async () => {
    await delivered({ total: "800.00", createdDaysAgo: 90, deliveredDaysAgo: 88 });
    const created = await newOrder(await asAgent());
    expect(created).toMatchObject({ held: false, holdReason: null });
    expect(await stored(created.id)).toEqual({ status: "new", holdReason: null });
    expect(await (await asAgent()).shopOverdue({ shopId: s.shopId })).toBeNull();
  });

  it("2. просрочка по отсрочке — «ожидает» с суммой и возрастом; свежий долг не в счёт; офису — уведомление", async () => {
    await setOrg(s.tenantId, true, 14);
    await delivered({ total: "800.00", createdDaysAgo: 40, deliveredDaysAgo: 30 });
    await delivered({ total: "500.00", createdDaysAgo: 5, deliveredDaysAgo: 3 }); // в пределах отсрочки
    const reason = "Просроченный долг: 800 сум, самый старый — 40 дн.";

    expect(await (await asAgent()).shopOverdue({ shopId: s.shopId })).toEqual({ amount: 800, oldestDays: 40, graceDays: 14 });

    const created = await newOrder(await asAgent());
    expect(created).toMatchObject({ held: true, holdReason: reason });
    expect(await stored(created.id)).toEqual({ status: "pending", holdReason: reason });

    const notes = await db.select({ message: schema.notifications.message, messageUz: schema.notifications.messageUz })
      .from(schema.notifications).where(eq(schema.notifications.link, `/orders/${created.id}`));
    const hold = notes.find(x => x.message?.includes(reason));
    expect(hold, "офис не получил уведомления с причиной").toBeTruthy();
    expect(hold!.messageUz).toContain("Muddati o'tgan qarz: 800 сум, eng eskisi — 40 kun");
  });

  it("3. явный срок из напоминания главнее отсрочки: прошёл — держит, впереди — нет", async () => {
    await setOrg(s.tenantId, true, 14);
    // Свежая доставка (3 дня), но срок оплаты назначили на вчера.
    const fresh = await delivered({ total: "600.00", createdDaysAgo: 4, deliveredDaysAgo: 3 });
    await (await asOperator()).recordPartialPayment({ orderId: fresh, paidAmount: "100", method: "cash", debtDueDate: await dbDay(-1) });
    const held = await newOrder(await asAgent());
    expect(held).toMatchObject({ held: true, holdReason: "Просроченный долг: 500 сум, самый старый — 4 дн." });

    // Старая доставка (30 дней), но срок оплаты — завтра: не просрочено.
    await truncateAll(); s = await seed("1000.000");
    const [op] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Оператор", email: "op@test.local", passwordHash: "x", role: "operator" });
    operatorId = Number(op.insertId);
    await setOrg(s.tenantId, true, 14);
    const old = await delivered({ total: "600.00", createdDaysAgo: 31, deliveredDaysAgo: 30 });
    await (await asOperator()).recordPartialPayment({ orderId: old, paidAmount: "100", method: "cash", debtDueDate: await dbDay(1) });
    expect(await newOrder(await asAgent())).toMatchObject({ held: false, holdReason: null });
  });

  it("4. отсрочка магазина перекрывает организации; пусто — снова организации", async () => {
    await setOrg(s.tenantId, true, 14);
    await delivered({ total: "700.00", createdDaysAgo: 21, deliveredDaysAgo: 20 });
    const shopsApi = await shopsAsOperator();

    // Своя отсрочка 30 — 20 дней ещё не просрочка.
    await shopsApi.update({ id: s.shopId, paymentGraceDays: "30" as never });
    expect((await shopsApi.getById({ id: s.shopId }))?.paymentGraceDays).toBe(30);
    expect(await newOrder(await asAgent())).toMatchObject({ held: false });

    // Пусто — снова 14 организации: держит.
    await shopsApi.update({ id: s.shopId, paymentGraceDays: "" as never });
    expect(await newOrder(await asAgent())).toMatchObject({ held: true, holdReason: "Просроченный долг: 700 сум, самый старый — 21 дн." });

    // И в другую сторону: организация щедрая (60), магазину — неделя.
    await setOrg(s.tenantId, true, 60);
    expect(await newOrder(await asAgent())).toMatchObject({ held: false });
    await shopsApi.update({ id: s.shopId, paymentGraceDays: 7 as never });
    expect(await (await asAgent()).shopOverdue({ shopId: s.shopId })).toEqual({ amount: 700, oldestDays: 21, graceDays: 7 });
    expect(await newOrder(await asAgent())).toMatchObject({ held: true });
  });

  it("5. оплата снимает просрочку для следующего заказа — по заказу и без привязки", async () => {
    await setOrg(s.tenantId, true, 14);
    const overdue = await delivered({ total: "800.00", createdDaysAgo: 40, deliveredDaysAgo: 30 });
    expect(await newOrder(await asAgent())).toMatchObject({ held: true });

    // Оплата по заказу — часть: просрочка уменьшилась, но осталась.
    await (await asOperator()).recordPartialPayment({ orderId: overdue, paidAmount: "300", method: "cash" });
    expect(await newOrder(await asAgent())).toMatchObject({ held: true, holdReason: "Просроченный долг: 500 сум, самый старый — 40 дн." });

    // Остаток — платежом магазина без заказа: долг ноль, просрочки нет.
    await (await shopsAsOperator()).addPayment({ shopId: s.shopId, amount: "500", type: "payment", paymentMethod: "cash" });
    const next = await newOrder(await asAgent());
    expect(next).toMatchObject({ held: false, holdReason: null });
    expect(await stored(next.id)).toEqual({ status: "new", holdReason: null });
  });

  it("6. два заказа одного магазина одновременно — оба ждут офиса", async () => {
    await setOrg(s.tenantId, true, 14);
    await delivered({ total: "800.00", createdDaysAgo: 40, deliveredDaysAgo: 30 });
    const agent = await asAgent();
    const [a, b] = await Promise.all([newOrder(agent), newOrder(agent)]);
    expect(a.id).not.toBe(b.id);
    for (const o of [a, b]) {
      expect(o).toMatchObject({ held: true });
      expect((await stored(o.id)).status).toBe("pending");
    }
  });

  it("7. чужой арендатор не влияет — ни настройкой, ни своими заказами", async () => {
    // Чужая организация включила проверку — наша от этого не включается.
    await setOrg(s.otherTenantId, true, 1);
    await delivered({ total: "800.00", createdDaysAgo: 40, deliveredDaysAgo: 30 });
    expect(await newOrder(await asAgent())).toMatchObject({ held: false });

    // Наша включена; у магазина свежий долг 500 (не просрочен), а чужой
    // просроченный заказ записан на тот же номер магазина. Без условия по
    // организации он дал бы просрочку min(800, 500) = 500.
    await truncateAll(); s = await seed("1000.000");
    await setOrg(s.tenantId, true, 14);
    await delivered({ total: "500.00", createdDaysAgo: 4, deliveredDaysAgo: 3 });
    await delivered({ total: "800.00", createdDaysAgo: 40, deliveredDaysAgo: 30, tenantId: s.otherTenantId });
    expect(await (await asAgent()).shopOverdue({ shopId: s.shopId })).toBeNull();
    expect(await newOrder(await asAgent())).toMatchObject({ held: false });
  });

  it("8. офис снимает ожидание тем же действием; агенту оно закрыто; заказ офиса не ждёт", async () => {
    await setOrg(s.tenantId, true, 14);
    await delivered({ total: "800.00", createdDaysAgo: 40, deliveredDaysAgo: 30 });
    const held = await newOrder(await asAgent());
    expect((await stored(held.id)).status).toBe("pending");

    await expect((await asAgent()).updateStatus({ id: held.id, status: "new" })).rejects.toThrow();
    expect((await stored(held.id)).status).toBe("pending");

    await (await asOperator()).updateStatus({ id: held.id, status: "new" });
    expect(await stored(held.id)).toEqual({ status: "new", holdReason: null });

    // Оператор оформляет сам — он и есть офис.
    expect(await newOrder(await asOperator())).toMatchObject({ held: false });
  });

  it("9. скидка выше порога и просрочка — обе причины", async () => {
    await setOrg(s.tenantId, true, 14, { maxFieldDiscountPct: "5.00" });
    await delivered({ total: "800.00", createdDaysAgo: 40, deliveredDaysAgo: 30 });
    const created = await newOrder(await asAgent(), { discount: "10" });
    expect(created).toMatchObject({
      held: true,
      holdReason: "Скидка 10% выше порога 5% для полевых сотрудников; Просроченный долг: 800 сум, самый старый — 40 дн.",
    });
  });

  it("10. повтор из офлайн-очереди тем же ключом — тот же заказ, не ошибка", async () => {
    await setOrg(s.tenantId, true, 14);
    await delivered({ total: "800.00", createdDaysAgo: 40, deliveredDaysAgo: 30 });
    const key = randomUUID();
    const first = await newOrder(await asAgent(), { idempotencyKey: key });
    expect(first).toMatchObject({ held: true });
    const again = await newOrder(await asAgent(), { idempotencyKey: key });
    expect(again).toMatchObject({ id: first.id, idempotent: true });
    const [{ c }] = await db.select({ c: sql<number>`COUNT(*)` }).from(schema.orders).where(eq(schema.orders.idempotencyKey, key));
    expect(Number(c)).toBe(1);
  });
});
