/**
 * «Не довёз» не переписывает уже проведённую доставку — на настоящей MySQL.
 *
 * Аудит 19.10.2026: markFailed проверял статус заказа ВНЕ транзакции, а
 * потом писал UPDATE только по id. Между проверкой и записью курьер (или
 * повтор из офлайн-очереди телефона) успевал закрыть заказ доставкой — и
 * «не довёз» возвращал доставленный заказ в «новый»: долг магазина
 * пропадал из расчёта, а следующая доставка списывала товар второй раз.
 *
 * Гонка здесь не случайная, а точная: обёртка над базой проводит доставку
 * ровно между проверкой и записью markFailed.
 *
 * Правило — markFailed в api/services/courier-delivery.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, stockOf, countOf, type ServiceDb, type Seeded } from "./harness";
import { OrderService } from "../../services/order";
import { markFailed, completeDelivery } from "../../services/courier-delivery";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

describe.skipIf(!hasRealDb)("«Не довёз» и доставка в одну секунду", () => {
  let db: ServiceDb;
  let s: Seeded;
  let orderId: number;

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
    const operator = (await import("../../courier-router")).courierRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "operator"));
    await operator.assignCourier({ orderId, courierId: s.courierId });
    const courier = (await import("../../courier-router")).courierRouter.createCaller(ctxFor(db, s.tenantId, s.courierId, "courier"));
    await courier.markOutForDelivery({ orderId });
  });

  const order = async () => {
    const [[row]] = await (db as any).execute(sql`
      SELECT status, delivery_status AS ds, courier_id AS courierId FROM orders WHERE id = ${orderId}
    `) as unknown as [Array<{ status: string; ds: string; courierId: number | null }>];
    return row;
  };

  /** База, в которой доставка проводится ровно между проверкой markFailed и его записью. */
  const deliveredInBetween = () => new Proxy(db as object, {
    get(target, prop, receiver) {
      if (prop === "transaction") {
        return async (fn: (tx: unknown) => Promise<unknown>) => {
          await completeDelivery(db as never, s.tenantId, s.courierId, {
            orderId, result: "partial_paid", paymentMethod: "cash", paidAmount: "100",
          } as never);
          return (target as { transaction: (f: typeof fn) => Promise<unknown> }).transaction(fn);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  it("доставка проведена, пока «не довёз» шёл к записи, — отметка отказывает, заказ остаётся доставленным", async () => {
    await expect(markFailed(deliveredInBetween() as never, s.tenantId, s.courierId, { orderId, reason: "закрыто" }))
      .rejects.toThrow(/уже завершён/);

    expect(await order()).toMatchObject({ status: "delivered", ds: "delivered", courierId: s.courierId });
    // Списано один раз, долг магазина — 300 из 400, оплата — одна.
    expect(await stockOf(s.productId)).toMatchObject({ current: 6, reserved: 0 });
    expect(await countOf("payments", `order_id = ${orderId}`)).toBe(1);
    const [[shop]] = await (db as any).execute(sql`SELECT debt FROM shops WHERE id = ${s.shopId}`) as unknown as [Array<{ debt: string }>];
    expect(Number(shop.debt)).toBe(300);
  });

  it("обычный «не довёз» по-прежнему снимает заказ с курьера, повтор из очереди — дубль", async () => {
    expect(await markFailed(db as never, s.tenantId, s.courierId, { orderId, reason: "закрыто" })).toEqual({ success: true });
    expect(await order()).toMatchObject({ status: "new", ds: "failed", courierId: null });
    // Резерв на месте: заказ ждёт новой попытки.
    expect(await stockOf(s.productId)).toMatchObject({ current: 10, reserved: 4 });
    expect(await markFailed(db as never, s.tenantId, s.courierId, { orderId, reason: "закрыто" })).toEqual({ success: true, duplicate: true });
  });
});
