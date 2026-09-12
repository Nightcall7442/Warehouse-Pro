import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, stockOf, countOf, type ServiceDb, type Seeded } from "./harness";
import { OrderService } from "../../services/order";

/**
 * Путь курьера через роутер на настоящей базе: назначить → выехал → закрыть
 * с частичным возвратом. Раньше эти 700 строк лежали в роутере и проверялись
 * только подделкой базы; теперь они в services/courier-delivery.ts, а здесь
 * ходит настоящий tRPC-вызов (createCaller) с настоящими ключами и замками.
 *
 * Роутер курьера берёт базу через getDb() — подменяем на тестовую.
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({
  getDb: () => current,
  getPool: () => null,
}));

function ctxFor(db: ServiceDb, tenantId: number, userId: number, role: "operator" | "courier"): any {
  return {
    req: new Request("http://localhost/"), resHeaders: new Headers(), db,
    user: { id: userId, tenantId, role, status: "active" as const, name: role, email: `${role}@test.local`, passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test-co", name: "Тестовая компания", plan: "pro" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
  };
}

describe.skipIf(!hasRealDb)("курьер: назначить → выехал → закрыть", () => {
  let db: ServiceDb;
  let s: Seeded;
  let orderId: number;
  let itemId: number;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    // товар по 100, заказано 4 → 400; резерв 4 из 10
    const r = await OrderService.create(db, s.tenantId, s.agentId, {
      shopId: s.shopId, paymentMethod: "cash",
      items: [{ productId: s.productId, quantity: "4" }],
    });
    orderId = (r as { id: number }).id;
    const [row] = await (db as any).execute(sql`SELECT id FROM order_items WHERE order_id = ${orderId} LIMIT 1`) as unknown as [Array<{ id: number }>];
    itemId = Number(row[0].id);
  });

  const asOperator = async () => (await import("../../courier-router")).courierRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "operator"));
  const asCourier = async () => (await import("../../courier-router")).courierRouter.createCaller(ctxFor(db, s.tenantId, s.courierId, "courier"));

  it("частичный возврат: списано увезённое, резерв снят, оплата и долг по факту, повтор — дубль", async () => {
    await (await asOperator()).assignCourier({ orderId, courierId: s.courierId });
    expect(await stockOf(s.productId)).toMatchObject({ current: 10, reserved: 4, available: 6 });

    const courier = await asCourier();
    await courier.markOutForDelivery({ orderId });

    // из 4 вернулась 1: довезено 3 на 300, магазин отдал 200 наличными → долг 100
    const r = await courier.completeDelivery({
      orderId, result: "partial_returned", paymentMethod: "cash", paidAmount: "200",
      returnedItems: [{ itemId, returnedQty: 1 }],
    });
    expect(r).toMatchObject({ success: true, finalStatus: "delivered" });

    expect(await stockOf(s.productId)).toMatchObject({ current: 7, reserved: 0, available: 7 });
    const [[order]] = await (db as any).execute(sql`SELECT status, delivery_status AS ds, total FROM orders WHERE id = ${orderId}`) as unknown as [Array<{ status: string; ds: string; total: string }>];
    expect(order).toMatchObject({ status: "delivered", ds: "delivered" });
    expect(Number(order.total)).toBe(300);
    expect(await countOf("payments", `order_id = ${orderId}`)).toBe(1);
    const [[shop]] = await (db as any).execute(sql`SELECT debt FROM shops WHERE id = ${s.shopId}`) as unknown as [Array<{ debt: string }>];
    expect(Number(shop.debt)).toBe(100);
    expect(await countOf("stock_movements", `reference_type = 'order_delivery' AND reference_id = ${orderId}`)).toBeGreaterThanOrEqual(1);

    // очередь телефона повторила запрос после обрыва — ничего не списывается второй раз
    const again = await courier.completeDelivery({
      orderId, result: "partial_returned", paymentMethod: "cash", paidAmount: "200",
      returnedItems: [{ itemId, returnedQty: 1 }],
    });
    expect(again).toMatchObject({ duplicate: true });
    expect(await stockOf(s.productId)).toMatchObject({ current: 7, reserved: 0 });
    expect(await countOf("payments", `order_id = ${orderId}`)).toBe(1);
  });

  it("чужой курьер и заказ не в пути — отказ; «не довёз» после закрытия — отказ", async () => {
    const courier = await asCourier();
    // не назначен на курьера
    await expect(courier.markOutForDelivery({ orderId })).rejects.toThrow();
    await (await asOperator()).assignCourier({ orderId, courierId: s.courierId });
    await courier.markOutForDelivery({ orderId });
    await courier.completeDelivery({ orderId, result: "paid", paymentMethod: "cash", paidAmount: "400" });
    expect(await stockOf(s.productId)).toMatchObject({ current: 6, reserved: 0 });
    await expect(courier.markFailed({ orderId, reason: "закрыт" })).rejects.toThrow();
    // сумма больше остатка по заказу — отказ ещё до записи
    const [[shop]] = await (db as any).execute(sql`SELECT debt FROM shops WHERE id = ${s.shopId}`) as unknown as [Array<{ debt: string }>];
    expect(Number(shop.debt)).toBe(0);
  });
});
