/**
 * Правка состава заказа не обходит то, что стережёт оформление.
 *
 * Бизнес-аудит 19.11.2026, пункты 4, 9, 11, 12 — на настоящей MySQL:
 *   · один itemId дважды в одной правке — отказ, а не двойная сумма;
 *   · по заказу оформлен возврат — состав не правится (товар не приходит
 *     на склад второй раз);
 *   · доставленный заказ увеличивается только из свободного остатка;
 *   · кредитный лимит магазина держит и правку;
 *   · одобренную офисом скидку выше порога полевой не переносит на больший
 *     объём.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { OrderService } from "../../services/order";
import { recalcShopDebt } from "../../services/shop-debt";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, stockOf, type ServiceDb, type Seeded } from "./harness";

describe.skipIf(!hasRealDb)("правка состава заказа", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); s = await seed("10.000"); });

  const agent = () => ({ id: s.agentId, role: "agent" });

  /** Заказ на товар P-1 (цена 100) в нужном статусе, со строкой. */
  async function orderWith(qty: number, opts: { status?: string; paymentMethod?: string; discount?: string } = {}) {
    const subtotal = qty * 100;
    const discount = Number(opts.discount ?? 0);
    const [o] = await db.insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, orderNumber: `№T-${Math.random().toString(36).slice(2, 8)}`,
      warehouseId: s.warehouseId,
      status: (opts.status ?? "new") as never, paymentMethod: (opts.paymentMethod ?? "cash") as never,
      subtotal: subtotal.toFixed(2), discount: discount.toFixed(2), total: (subtotal - discount).toFixed(2),
    } as never);
    const orderId = Number(o.insertId);
    const [it] = await db.insert(schema.orderItems).values({
      orderId, productId: s.productId, quantity: String(qty), unitPrice: "100.00", costPrice: "50.00", subtotal: subtotal.toFixed(2),
    } as never);
    // «Новый» заказ держит резерв — как после настоящего оформления.
    if ((opts.status ?? "new") === "new") {
      const free = 10 - qty;
      await db.update(schema.warehouseStock).set({ reserved: qty.toFixed(3), available: free.toFixed(3) })
        .where(eq(schema.warehouseStock.productId, s.productId));
    }
    return { orderId, itemId: Number(it.insertId) };
  }
  const total = async (orderId: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)))[0].total;
  const debt = async () => (await db.select().from(schema.shops).where(eq(schema.shops.id, s.shopId)))[0].debt;

  it("один itemId дважды — отказ, заказ не тронут", async () => {
    const { orderId, itemId } = await orderWith(5);
    await expect(OrderService.updateItems(db, s.tenantId, orderId, {
      items: [{ itemId, quantity: 6 }, { itemId, quantity: 6 }],
    }, agent())).rejects.toThrow(/указана в правке дважды/);
    expect(await total(orderId)).toBe("500.00");
  });

  it("по доставленному заказу оформлен возврат — правка отказывает, склад не растёт", async () => {
    const { orderId, itemId } = await orderWith(5, { status: "delivered" });
    await db.insert(schema.returns).values({
      tenantId: s.tenantId, orderId, shopId: s.shopId, returnNumber: "R-1", status: "completed", totalAmount: "200.00",
    } as never);
    const before = await stockOf(s.productId);
    await expect(OrderService.updateItems(db, s.tenantId, orderId, { items: [{ itemId, quantity: 3 }] }, { id: 1, role: "operator" }))
      .rejects.toThrow(/оформлен возврат/);
    expect(await stockOf(s.productId)).toEqual(before);
  });

  it("доставленный заказ увеличивается только из свободного остатка", async () => {
    // На складе 10, все 10 отложены под другой заказ.
    await db.update(schema.warehouseStock).set({ reserved: "10.000", available: "0.000" })
      .where(eq(schema.warehouseStock.productId, s.productId));
    const { orderId, itemId } = await orderWith(2, { status: "delivered" });
    await expect(OrderService.updateItems(db, s.tenantId, orderId, { items: [{ itemId, quantity: 4 }] }, { id: 1, role: "operator" }))
      .rejects.toThrow(/свободно 0, нужно ещё 2/);
    expect(await stockOf(s.productId)).toMatchObject({ current: 10, reserved: 10, available: 0 });
  });

  it("кредитный лимит держит и правку состава", async () => {
    const { orderId, itemId } = await orderWith(2, { paymentMethod: "debt" });
    await db.transaction(tx => recalcShopDebt(tx, s.tenantId, s.shopId));
    expect(await debt()).toBe("200.00");
    await db.update(schema.shops).set({ creditLimit: "500.00" }).where(eq(schema.shops.id, s.shopId));

    await expect(OrderService.updateItems(db, s.tenantId, orderId, { items: [{ itemId, quantity: 8 }] }, agent()))
      .rejects.toThrow(/Кредитный лимит магазина «Магазин Альфа» 500 превышен: после правки долг 800/);
    expect(await debt()).toBe("200.00");

    // В пределах лимита — проходит; уменьшение — всегда.
    await OrderService.updateItems(db, s.tenantId, orderId, { items: [{ itemId, quantity: 5 }] }, agent());
    expect(await debt()).toBe("500.00");
    await db.update(schema.shops).set({ creditLimit: "100.00" }).where(eq(schema.shops.id, s.shopId));
    await OrderService.updateItems(db, s.tenantId, orderId, { items: [{ itemId, quantity: 4 }] }, agent());
    expect(await debt()).toBe("400.00");
  });

  it("перевод в «долг» офисом сверх лимита — отказ", async () => {
    const { orderId } = await orderWith(8);
    await db.update(schema.shops).set({ creditLimit: "500.00" }).where(eq(schema.shops.id, s.shopId));
    await expect(OrderService.update(db, s.tenantId, orderId, { paymentMethod: "debt" }, { id: 1, role: "operator" }))
      .rejects.toThrow(/Кредитный лимит/);
  });

  it("одобренная скидка выше порога: уменьшить агенту можно, увеличить — только офису", async () => {
    await db.insert(schema.settings).values({ tenantId: s.tenantId, maxFieldDiscountPct: "10.00" } as never);
    // 5 × 100 = 500, скидка 40% = 200 — одобрено офисом, заказ «новый».
    const { orderId, itemId } = await orderWith(5, { discount: "200" });

    await expect(OrderService.updateItems(db, s.tenantId, orderId, { items: [{ itemId, quantity: 8 }] }, agent()))
      .rejects.toThrow(/одобрена на прежний состав/);
    expect(await total(orderId)).toBe("300.00");

    await OrderService.updateItems(db, s.tenantId, orderId, { items: [{ itemId, quantity: 4 }] }, agent());
    expect(await total(orderId)).toBe("240.00");

    await OrderService.updateItems(db, s.tenantId, orderId, { items: [{ itemId, quantity: 8 }] }, { id: 1, role: "operator" });
    expect(await total(orderId)).toBe("480.00");
  });
});
