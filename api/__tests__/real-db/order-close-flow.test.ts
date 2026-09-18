import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import * as schema from "@db/schema";

/**
 * Расчёт по заказу на настоящей базе (касса убрана 18.09.2026).
 *
 *   курьер заявил 300 наличными → заказ «ждёт расчёта», деньги на руках →
 *   офис получил 250 → закрыт, недостача 50 на курьере, директору в Telegram,
 *   след order.closed; второй раз — отказ →
 *   заказ без оплаты: закрыть без «в долг» нельзя; с ним — закрыт долгом →
 *   агент собрал 100 наличными → расчёт открыт заново, на руках 100 →
 *   офис принял 100 → закрыт, остаток 200 →
 *   офис сам записал оплату 200 → получено сразу, закрыт →
 *   очередь «ждут расчёта» и «мои наличные» сходятся на каждом шаге.
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
const tg = vi.hoisted(() => ({ notify: vi.fn(async (..._a: unknown[]) => undefined) }));
vi.mock("../../lib/telegram", async (orig) => ({ ...(await orig<object>()), sendTelegram: vi.fn(async () => true), notifyTenantRole: tg.notify }));

describe.skipIf(!hasRealDb)("расчёт по заказу", () => {
  let db: ServiceDb;
  let s: Seeded;
  let ceoId = 0;
  const ceo = () => ({ id: ceoId, name: "Директор", role: "ceo" });
  const order = async (number: string) => {
    const [r] = await (db as any).insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, courierId: s.courierId, orderNumber: number,
      status: "delivered" as never, deliveryStatus: "delivered", paymentMethod: "cash", subtotal: "300.00", total: "300.00", deliveredAt: new Date(),
    });
    return Number(r.insertId);
  };
  const fieldCash = async (orderId: number, amount: string, by: number) => {
    await (db as any).insert(schema.payments).values({ tenantId: s.tenantId, shopId: s.shopId, orderId, amount, type: "payment", paymentMethod: "cash", status: "paid", createdBy: by });
  };
  const row = async (id: number) => (await (db as any).select().from(schema.orders).where(eq(schema.orders.id, id)))[0];

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    tg.notify.mockClear();
    s = await seed("10.000");
    const [c] = await (db as any).insert(schema.users).values({ tenantId: s.tenantId, name: "Директор", email: "ceo@test.local", passwordHash: "x", role: "ceo" });
    ceoId = Number(c.insertId);
  });

  it("заявил → ждёт → недостача → закрыт; долг явно; полевые наличные открывают заново; офис закрывает сам", async () => {
    const { OrderCloseService } = await import("../../services/order-close");
    const { OrderService } = await import("../../services/order");
    const viewer = { userId: ceoId, userRole: "ceo" };
    const queue = async () => (await OrderService.list(db as any, s.tenantId, { awaitingMoney: true, pageSize: 100 }, viewer)).data.map((o: { orderNumber: string }) => o.orderNumber).sort();

    // Курьер заявил 300 наличными.
    const a = await order("№2001");
    await fieldCash(a, "300.00", s.courierId);
    let m = await OrderCloseService.money(db as any, s.tenantId, a);
    expect(m).toMatchObject({ total: 300, paid: 300, remainder: 0, claimed: 300, received: 0, awaiting: true, closedAt: null });
    expect(m.holders.map(h => [h.id, h.amount])).toEqual([[s.courierId, 300]]);
    expect(await OrderCloseService.mine(db as any, s.tenantId, s.courierId)).toMatchObject({ amount: 300, orders: 1 });
    expect(await queue()).toEqual(["№2001"]);

    // Офис получил 250: недостача 50 остаётся на курьере, магазину не долг.
    expect(await OrderCloseService.close(db as any, s.tenantId, ceo(), { orderId: a, cashReceived: 250 })).toMatchObject({ shortage: 50, remainder: 0, added: 0, claimed: 300 });
    const o = await row(a);
    expect(o.closedBy).toBe(ceoId); expect(o.closedAt).not.toBeNull();
    expect(o).toMatchObject({ courierShortage: "50.00", shortageUserId: s.courierId });
    m = await OrderCloseService.money(db as any, s.tenantId, a);
    expect(m).toMatchObject({ received: 300, claimed: 0, remainder: 0, awaiting: false, closedByName: "Директор" });
    expect(m.shortage).toMatchObject({ amount: 50, userId: s.courierId });
    expect(m.payments[0].settled).toBe(true);
    expect(await OrderCloseService.mine(db as any, s.tenantId, s.courierId)).toMatchObject({ amount: 0, orders: 0 });
    expect(tg.notify).toHaveBeenCalledTimes(1);
    expect(String(tg.notify.mock.calls[0][2])).toContain("Недостача");
    const audit = await (db as any).select().from(schema.auditLog).where(and(eq(schema.auditLog.tenantId, s.tenantId), eq(schema.auditLog.action, "order.closed")));
    expect(audit).toHaveLength(1);
    expect(audit[0].meta).toMatchObject({ cashReceived: 250, claimed: 300, shortage: 50, debt: 0 });
    await expect(OrderCloseService.close(db as any, s.tenantId, ceo(), { orderId: a, cashReceived: 0 })).rejects.toThrow(/уже рассчитан/);
    expect(await OrderCloseService.shortageIn(db as any, s.tenantId, s.courierId, new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000))).toEqual({ count: 1, amount: 50 });
    expect(await queue()).toEqual([]);

    // Заказ без оплаты: остаток нельзя молча оставить — только явно долгом.
    const b = await order("№2002");
    await expect(OrderCloseService.close(db as any, s.tenantId, ceo(), { orderId: b, cashReceived: 0 })).rejects.toThrow(/Остаток/);
    expect(await OrderCloseService.close(db as any, s.tenantId, ceo(), { orderId: b, cashReceived: 0, acceptDebt: true })).toMatchObject({ remainder: 300, shortage: 0 });
    expect((await row(b)).closedAt).not.toBeNull();

    // Агент собрал 100 наличными по закрытому заказу — расчёт открыт заново.
    await OrderService.recordPartialPayment(db as any, s.tenantId, { id: s.agentId, role: "agent" }, { orderId: b, paidAmount: "100", method: "cash" });
    expect((await row(b)).closedAt).toBeNull();
    m = await OrderCloseService.money(db as any, s.tenantId, b);
    expect(m).toMatchObject({ paid: 100, claimed: 100, remainder: 200, awaiting: true });
    expect(await queue()).toEqual(["№2002"]);
    expect(await OrderCloseService.close(db as any, s.tenantId, ceo(), { orderId: b, cashReceived: 100, acceptDebt: true })).toMatchObject({ shortage: 0, remainder: 200 });

    // Офис сам записал оплату 200: получено сразу, закрыт, очередь пуста.
    await OrderService.recordPartialPayment(db as any, s.tenantId, { id: ceoId, role: "ceo" }, { orderId: b, paidAmount: "200", method: "cash" });
    m = await OrderCloseService.money(db as any, s.tenantId, b);
    expect(m).toMatchObject({ paid: 300, received: 300, claimed: 0, remainder: 0, awaiting: false });
    expect(m.payments.every(p => p.settled)).toBe(true);
    expect(await queue()).toEqual([]);

    // Сверх суммы заказа — отказ; не доставленный — отказ.
    const c = await order("№2003");
    await expect(OrderCloseService.close(db as any, s.tenantId, ceo(), { orderId: c, cashReceived: 301 })).rejects.toThrow(/больше суммы заказа/);
    await (db as any).update(schema.orders).set({ status: "shipped" }).where(eq(schema.orders.id, c));
    await expect(OrderCloseService.close(db as any, s.tenantId, ceo(), { orderId: c, cashReceived: 0, acceptDebt: true })).rejects.toThrow(/не доставлен/);
  });
});
