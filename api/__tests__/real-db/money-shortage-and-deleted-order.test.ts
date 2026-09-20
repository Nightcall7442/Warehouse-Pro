/**
 * Деньги на настоящей базе — три дыры аудита 20.09.2026 (важно):
 *
 *   • недостача пишется на того, у кого были наличные: агент собрал долг и
 *     сдал меньше — недостача агента, а не курьера заказа;
 *   • у недостачи своя дата: заказ, закрытый заново в другом периоде,
 *     не удерживает ту же недостачу второй раз в «Контроле»;
 *   • курьер не проводит удалённый заказ: резерв уже возвращён, а списание
 *     и платёж по нему ушли бы в никуда.
 *
 * Нарочная поломка: верни `o.courierId ?? onHands[0]?.createdBy` — упадёт
 * первая; верни в control.ts период по closedAt — упадёт вторая; убери
 * isNull(deletedAt) из completeDelivery — упадёт третья.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, stockOf, type ServiceDb, type Seeded } from "./harness";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/telegram", async (orig) => ({ ...(await orig<object>()), sendTelegram: vi.fn(async () => true), notifyTenantRole: vi.fn(async () => undefined) }));

function ctxFor(db: ServiceDb, tenantId: number, userId: number, role: string): any {
  return {
    req: new Request("http://localhost/"), resHeaders: new Headers(), db,
    user: { id: userId, tenantId, role, status: "active" as const, name: role, email: `${role}@test.local`, passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date() },
    tenant: { id: tenantId, slug: "test-co", name: "Тестовая компания", plan: "pro" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
  };
}

describe.skipIf(!hasRealDb)("деньги: недостача и удалённый заказ", () => {
  let db: ServiceDb;
  let s: Seeded;
  let ceoId = 0;
  const ceo = () => ({ id: ceoId, name: "Директор", role: "ceo" });

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    const [c] = await (db as any).insert(schema.users).values({ tenantId: s.tenantId, name: "Директор", email: "ceo@test.local", passwordHash: "x", role: "ceo" });
    ceoId = Number(c.insertId);
  });

  const deliveredOrder = async (number: string, total = "300.00") => {
    const [r] = await (db as any).insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, courierId: s.courierId, orderNumber: number,
      status: "delivered" as never, deliveryStatus: "delivered", paymentMethod: "debt", subtotal: total, total, deliveredAt: new Date(),
    });
    return Number(r.insertId);
  };
  const fieldCash = (orderId: number, amount: string, by: number) => (db as any).insert(schema.payments).values({
    tenantId: s.tenantId, shopId: s.shopId, orderId, amount, type: "payment", paymentMethod: "cash", status: "paid", createdBy: by, paidAt: new Date(),
  });
  const row = async (id: number) => (await (db as any).select().from(schema.orders).where(eq(schema.orders.id, id)))[0];

  it("агент собрал долг и сдал меньше — недостача на агенте, не на курьере заказа", async () => {
    const { OrderCloseService } = await import("../../services/order-close");
    const id = await deliveredOrder("№3001");
    await fieldCash(id, "300.00", s.agentId);
    const r = await OrderCloseService.close(db as any, s.tenantId, ceo(), { orderId: id, cashReceived: 250 });
    expect(r).toMatchObject({ shortage: 50 });
    const o = await row(id);
    expect(o.shortageUserId, "недостача записана на курьера, хотя наличные держал агент").toBe(s.agentId);
    expect(o.shortageAt).not.toBeNull();
  });

  it("недостача считается в своём периоде, а не в периоде повторного закрытия", async () => {
    const { OrderCloseService } = await import("../../services/order-close");
    const { ControlService } = await import("../../services/control");
    const id = await deliveredOrder("№3002");
    await fieldCash(id, "300.00", s.courierId);
    await OrderCloseService.close(db as any, s.tenantId, ceo(), { orderId: id, cashReceived: 250 });

    // Недостача случилась «в прошлом месяце»: сдвигаем её дату и дату закрытия назад.
    const past = new Date(Date.now() - 40 * 86_400_000);
    await (db as any).execute(sql`UPDATE orders SET shortage_at = ${past}, closed_at = ${past} WHERE id = ${id}`);
    // Второй круг: расчёт открыли заново (как order-reopen: closedAt снят,
    // недостача осталась) и закрыли сегодня — заявлять больше нечего.
    await (db as any).execute(sql`UPDATE orders SET closed_at = NULL WHERE id = ${id}`);
    await OrderCloseService.close(db as any, s.tenantId, ceo(), { orderId: id, cashReceived: 0 });
    expect((await row(id)).courierShortage).toBe("50.00");

    const thisMonth = await ControlService.shortages(db as any, s.tenantId, { from: new Date(Date.now() - 7 * 86_400_000), to: new Date(Date.now() + 86_400_000) });
    expect(thisMonth.map(x => x.number), "старая недостача попала в новый период").toEqual([]);
    const lastMonth = await ControlService.shortages(db as any, s.tenantId, { from: new Date(Date.now() - 60 * 86_400_000), to: new Date(Date.now() - 20 * 86_400_000) });
    expect(lastMonth.map(x => [x.number, x.amount])).toEqual([["№3002", 50]]);
  });

  it("курьер не проводит удалённый заказ: склад и платежи не тронуты", async () => {
    const { OrderService } = await import("../../services/order");
    const { courierRouter } = await import("../../courier-router");
    const created = await OrderService.create(db, s.tenantId, s.agentId, { shopId: s.shopId, paymentMethod: "cash", items: [{ productId: s.productId, quantity: "4" }] } as never);
    const orderId = (created as { id: number }).id;
    const [it] = await (db as any).execute(sql`SELECT id FROM order_items WHERE order_id = ${orderId} LIMIT 1`) as unknown as [Array<{ id: number }>];

    await courierRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "operator")).assignCourier({ orderId, courierId: s.courierId });
    const courier = courierRouter.createCaller(ctxFor(db, s.tenantId, s.courierId, "courier"));
    await courier.markOutForDelivery({ orderId });
    expect(await stockOf(s.productId)).toMatchObject({ current: 10, reserved: 4, available: 6 });

    // Оператор удалил заказ — резерв вернулся. Телефон из офлайн-очереди шлёт доставку.
    await OrderService.delete(db as any, s.tenantId, orderId, { id: ceoId, role: "ceo", name: "Директор" } as never);
    expect(await stockOf(s.productId)).toMatchObject({ current: 10, reserved: 0, available: 10 });

    await expect(courier.completeDelivery({ orderId, result: "paid", paymentMethod: "cash", paidAmount: "400", returnedItems: [{ itemId: Number(it[0].id), returnedQty: 0 }] } as never))
      .rejects.toThrow();
    expect(await stockOf(s.productId), "удалённый заказ списал товар").toMatchObject({ current: 10, reserved: 0, available: 10 });
    const [[cnt]] = await (db as any).execute(sql`SELECT COUNT(*) AS n FROM payments WHERE order_id = ${orderId}`) as unknown as [Array<{ n: number }>];
    expect(Number(cnt.n), "платёж по удалённому заказу").toBe(0);
  });
});
