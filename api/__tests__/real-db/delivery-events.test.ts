import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, stockOf, countOf, type ServiceDb, type Seeded } from "./harness";
import { OrderService } from "../../services/order";
import { businessDaysAgo, businessToday } from "@contracts/business-time";

/**
 * Журнал попыток доставки и план развоза — на настоящей базе.
 *
 * Здесь то, чего стенд на заглушках не умеет в принципе: замки строк и гонки
 * (markFailed против «Доставлено»), уникальный индекс ключа очереди
 * (uq_delivery_events_idem), CASE в порядке объезда, JSON_LENGTH фото в
 * карточке, сдвиг дня по Ташкенту в отчёте и в KPI.
 *
 * Нарочная поломка: в markFailed убери inArray(orders.status, …) из UPDATE —
 * падает гонка; убери failedAttemptsOf из calculateCourierStats — падает KPI.
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({
  getDb: () => current,
  getPool: () => null,
}));

type Row = Record<string, unknown>;

describe.skipIf(!hasRealDb)("журнал попыток доставки и план развоза", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
  });

  const q = async (query: ReturnType<typeof sql>) => {
    const [rows] = await (db as any).execute(query) as unknown as [Row[]];
    return rows;
  };
  const newOrder = async (qty = "1", shopId = s.shopId) => {
    const r = await OrderService.create(db, s.tenantId, s.agentId, { shopId, paymentMethod: "cash", items: [{ productId: s.productId, quantity: qty }] });
    return (r as { id: number }).id;
  };
  const courierApi = async (role = "courier", userId = s.courierId) =>
    (await import("../../courier-router")).courierRouter.createCaller(ctxFor(db, s.tenantId, userId, role));
  const operatorApi = () => courierApi("operator", s.agentId);
  const assigned = async (qty = "1") => {
    const id = await newOrder(qty);
    await (await operatorApi()).assignCourier({ orderId: id, courierId: s.courierId });
    return id;
  };

  it("«не довёз» — попытка в журнале с курьером, KPI «Сорвано» = 1, хотя курьер с заказа снят", async () => {
    const id = await assigned();
    await (await courierApi()).markFailed({ orderId: id, reasonCode: "shop_closed", lat: "41.3", lng: "69.2" });

    const [o] = await q(sql`SELECT status, delivery_status AS ds, courier_id AS c FROM orders WHERE id = ${id}`);
    expect(o).toMatchObject({ status: "new", ds: "failed", c: null });
    const [e] = await q(sql`SELECT kind, courier_id AS c, reason_code AS r FROM delivery_events WHERE order_id = ${id}`);
    expect(e).toMatchObject({ kind: "failed", c: s.courierId, r: "shop_closed" });

    const { calculateCourierStats } = await import("../../services/kpi");
    const stats = await calculateCourierStats(db as never, s.courierId, s.tenantId, new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000));
    expect(stats.failed).toBe(1);
    expect(stats.delivered).toBe(0);
  });

  it("гонка «Доставлено» и «Не довёз» по одному заказу: проходит одно, склад и заказ сходятся", async () => {
    const id = await assigned("2");
    const courier = await courierApi();
    const [a, b] = await Promise.allSettled([
      courier.markDelivered({ orderId: id }),
      courier.markFailed({ orderId: id, reasonCode: "refused" }),
    ]);
    const [o] = await q(sql`SELECT status, delivery_status AS ds FROM orders WHERE id = ${id}`);
    const failedRows = await countOf("delivery_events", `order_id = ${id} AND kind = 'failed'`);
    const deliveredRows = await countOf("delivery_events", `order_id = ${id} AND kind = 'delivered'`);
    if (o.status === "delivered") {
      expect(a.status).toBe("fulfilled");
      expect(b.status).toBe("rejected");
      expect(failedRows).toBe(0);
      expect(deliveredRows).toBe(1);
      expect(await stockOf(s.productId)).toMatchObject({ current: 8, reserved: 0 });
    } else {
      expect(o).toMatchObject({ status: "new", ds: "failed" });
      expect(b.status).toBe("fulfilled");
      expect(failedRows).toBe(1);
      expect(deliveredRows).toBe(0);
      expect(await stockOf(s.productId)).toMatchObject({ current: 10, reserved: 2 });
    }
  });

  it("один ключ очереди двумя запросами разом — одна строка журнала, оба ответа успешны", async () => {
    const id = await assigned();
    const courier = await courierApi();
    const key = "phone-queue-0001";
    const res = await Promise.allSettled([
      courier.markFailed({ orderId: id, reasonCode: "no_answer", idempotencyKey: key }),
      courier.markFailed({ orderId: id, reasonCode: "no_answer", idempotencyKey: key }),
    ]);
    expect(res.map(r => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await countOf("delivery_events", `idempotency_key = '${key}'`)).toBe(1);

    // Тот же ключ у переноса — тоже одна строка, даже разом.
    const id2 = await assigned();
    const tomorrow = businessDaysAgo(-1);
    const res2 = await Promise.allSettled([
      courier.reschedule({ orderId: id2, date: tomorrow, idempotencyKey: "phone-queue-0002" }),
      courier.reschedule({ orderId: id2, date: tomorrow, idempotencyKey: "phone-queue-0002" }),
    ]);
    expect(res2.map(r => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await countOf("delivery_events", `idempotency_key = 'phone-queue-0002'`)).toBe(1);
  });

  it("перенос: заказ уходит из сегодняшнего списка и возвращается в свой день; «Сорвано» не растёт", async () => {
    const id = await assigned();
    const courier = await courierApi();
    await courier.reschedule({ orderId: id, date: businessDaysAgo(-1), reasonCode: "no_owner" });
    expect((await courier.listMyDeliveries()).map(r => r.id)).not.toContain(id);
    expect((await courier.listMyDeliveries({ includeLater: true })).map(r => r.id)).toContain(id);

    // Настал тот день — заказ снова в списке.
    await q(sql`UPDATE orders SET planned_delivery_date = ${businessToday()} WHERE id = ${id}`);
    expect((await courier.listMyDeliveries()).map(r => r.id)).toContain(id);

    const { calculateCourierStats } = await import("../../services/kpi");
    const stats = await calculateCourierStats(db as never, s.courierId, s.tenantId, new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000));
    expect(stats.failed).toBe(0);
  });

  it("отменённый заказ уходит из списка курьера", async () => {
    const id = await assigned();
    const courier = await courierApi();
    expect((await courier.listMyDeliveries()).map(r => r.id)).toContain(id);
    await OrderService.updateStatus(db, s.tenantId, id, "cancelled", { id: s.agentId, role: "ceo" });
    expect((await courier.listMyDeliveries()).map(r => r.id)).not.toContain(id);
    expect((await (await operatorApi()).listMyDeliveries()).map(r => r.id)).not.toContain(id);
  });

  it("подтверждение вручения: повтор — одна строка и одно фото; карточка отдаёт попытки с числом фото", async () => {
    const id = await assigned();
    const courier = await courierApi();
    await courier.markFailed({ orderId: id, reasonCode: "other", note: "шлагбаум" });
    await (await operatorApi()).assignCourier({ orderId: id, courierId: s.courierId });
    await courier.markDelivered({ orderId: id });

    const photo = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    const sig = { w: 1000, h: 300, strokes: [[0, 0, 500, 150, 1000, 300]] };
    await courier.saveProof({ orderId: id, photo, signature: sig, recipientName: "Дилшод" });
    const again = await courier.saveProof({ orderId: id, photo, signature: sig, recipientName: "Дилшод" });
    expect(again).toMatchObject({ duplicate: true, photoCount: 1 });
    expect(await countOf("delivery_events", `order_id = ${id} AND kind = 'delivered'`)).toBe(1);
    const [ev] = await q(sql`SELECT JSON_LENGTH(photos) AS n, recipient_name AS who FROM delivery_events WHERE order_id = ${id} AND kind = 'delivered'`);
    expect(ev).toMatchObject({ n: 1, who: "Дилшод" });

    const orders = (await import("../../order-router")).orderRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "operator"));
    const card = await orders.getById({ id }) as unknown as { deliveryEvents: Array<Row> };
    expect(card.deliveryEvents.map(e => e.kind)).toEqual(["failed", "delivered"]);
    expect(card.deliveryEvents[0]).toMatchObject({ reasonCode: "other", note: "шлагбаум", courierName: "Курьер", photoCount: 0 });
    expect(card.deliveryEvents[1]).toMatchObject({ photoCount: 1, recipientName: "Дилшод", signature: sig });
    expect(JSON.stringify(card)).not.toContain("base64");
  });

  it("страница для магазина: в пути — имя курьера без координат; приостановленная организация — 404", async () => {
    const id = await assigned();
    await (await courierApi()).markOutForDelivery({ orderId: id });
    await q(sql`UPDATE users SET name = 'Азиз Каримов' WHERE id = ${s.courierId}`);
    const { trackingPage, trackToken } = await import("../../services/tracking");
    const page = await trackingPage(db as never, trackToken(id), "ru");
    expect(page.status).toBe(200);
    expect(page.html).toContain("Курьер Азиз едет к вам");
    expect(page.html).not.toContain("Каримов");

    const orders = (await import("../../order-router")).orderRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "agent"));
    const link = await orders.trackingLink({ id });
    expect(link.url).toContain(`/t/${trackToken(id)}`);

    await q(sql`UPDATE tenants SET status = 'suspended' WHERE id = ${s.tenantId}`);
    expect((await trackingPage(db as never, trackToken(id), "ru")).status).toBe(404);
  });
});
