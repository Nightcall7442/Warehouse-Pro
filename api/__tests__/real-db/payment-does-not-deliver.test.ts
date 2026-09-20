/**
 * Оплата — про деньги, не про товар: на настоящей базе.
 *
 * Аудит 20.09.2026: applyPartialPayment безусловно ставил заказу
 * status: "delivered" и deliveredAt = сейчас. Агент вносил 1 сум по заказу
 * «в долг» в статусе new — заказ «доставлялся» без списания склада (резерв
 * висел навсегда, товар в базе не уезжал), а сбор старого долга по давно
 * доставленному заказу переписывал дату доставки — курьеру доставка
 * засчитывалась второй раз.
 *
 * Нарочная поломка: верни в applyPartialPayment `status: "delivered"` —
 * упадёт первая проверка; верни `deliveredAt: new Date()` — упадёт вторая.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import * as schema from "@db/schema";
import { OrderService } from "../../services/order";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, stockOf, type ServiceDb, type Seeded } from "./harness";

const describeIf = hasRealDb ? describe : describe.skip;

describeIf("оплата не отмечает доставку", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); });
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); s = await seed("10.000"); });

  const agent = () => ({ id: s.agentId, role: "agent" as const });
  const orderRow = async (id: number) => {
    const [o] = await db.select({ status: schema.orders.status, deliveredAt: schema.orders.deliveredAt }).from(schema.orders)
      .where(and(eq(schema.orders.id, id), eq(schema.orders.tenantId, s.tenantId)));
    return o!;
  };

  it("платёж по заказу «в долг» в статусе new: заказ остаётся new, склад не тронут, долг уменьшен", async () => {
    const { id } = await OrderService.create(db, s.tenantId, s.agentId, {
      shopId: s.shopId, items: [{ productId: s.productId, quantity: "3" }], paymentMethod: "debt", idempotencyKey: "pnd-1",
    } as never);
    expect(await stockOf(s.productId)).toEqual({ current: 10, reserved: 3, available: 7 });

    await OrderService.recordPartialPayment(db, s.tenantId, agent(), { orderId: id, paidAmount: "1", method: "cash" });

    const o = await orderRow(id);
    expect(o.status, "оплата «доставила» заказ").toBe("new");
    expect(o.deliveredAt).toBeNull();
    expect(await stockOf(s.productId), "склад изменился без доставки").toEqual({ current: 10, reserved: 3, available: 7 });
    const [shop] = await db.select({ debt: schema.shops.debt }).from(schema.shops).where(eq(schema.shops.id, s.shopId));
    const [order] = await db.select({ total: schema.orders.total }).from(schema.orders).where(eq(schema.orders.id, id));
    expect(Math.round(Number(shop!.debt) * 100)).toBe(Math.round((Number(order!.total) - 1) * 100));
  });

  it("сбор старого долга не переписывает дату доставки", async () => {
    const [row] = await db.insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, orderNumber: "№old-1",
      status: "delivered" as never, deliveryStatus: "delivered", paymentMethod: "debt" as never,
      subtotal: "1000.00", total: "1000.00", deliveredAt: new Date("2026-08-28T10:00:00Z"),
    } as never);
    const id = Number(row.insertId);

    await OrderService.recordPartialPayment(db, s.tenantId, agent(), { orderId: id, paidAmount: "400", method: "cash" });

    const o = await orderRow(id);
    expect(o.status).toBe("delivered");
    expect(o.deliveredAt?.toISOString(), "дата доставки переписана оплатой").toBe("2026-08-28T10:00:00.000Z");
  });
});
