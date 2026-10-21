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
 * падает гонка; убери failedAttemptsOf из calculateCourierStats — падает KPI;
 * в setRouteOrder пиши routeSeq: 1 вместо CASE — падает порядок.
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

  it("порядок объезда: места 1..n по списку, остальным — пусто; новое назначение сбрасывает место и день", async () => {
    const [a, b, c] = [await assigned(), await assigned(), await assigned()];
    const op = await operatorApi();
    await op.setRouteOrder({ courierId: s.courierId, orderIds: [c, a] });
    const seq = async () => Object.fromEntries((await q(sql`SELECT id, route_seq AS r FROM orders WHERE id IN (${a}, ${b}, ${c})`)).map(r => [Number(r.id), r.r]));
    expect(await seq()).toEqual({ [c]: 1, [a]: 2, [b]: null });
    expect((await (await courierApi()).listMyDeliveries()).map(r => r.id)).toEqual([c, a, b]);
    expect(await countOf("audit_log", "action = 'courier.route_set'")).toBe(1);

    // Второй курьер; заказ c уходит к нему — место и плановый день стираются.
    await q(sql`UPDATE orders SET planned_delivery_date = ${businessDaysAgo(-2)} WHERE id = ${c}`);
    const [u] = await (db as any).execute(sql`INSERT INTO users (tenant_id, name, email, password_hash, role) VALUES (${s.tenantId}, 'Курьер 2', 'c2@test.local', 'x', 'courier')`) as unknown as [{ insertId: number }];
    await op.assignCourier({ orderId: c, courierId: Number(u.insertId) });
    const [row] = await q(sql`SELECT route_seq AS r, planned_delivery_date AS p, courier_id AS k FROM orders WHERE id = ${c}`);
    expect(row).toMatchObject({ r: null, p: null, k: Number(u.insertId) });

    // Заказ другого курьера в порядке — отказ, ничего не записано.
    await expect(op.setRouteOrder({ courierId: s.courierId, orderIds: [a, c] })).rejects.toThrow(/только открытым заказам этого курьера/);
    expect((await seq())[a]).toBe(2);
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

  it("отчёт «Недоставленные»: срыв и перенос — по причинам и курьеру, доля от попыток", async () => {
    const courier = await courierApi();
    const a = await assigned();
    await courier.markFailed({ orderId: a, reasonCode: "no_money" });
    const b = await assigned();
    await courier.reschedule({ orderId: b, date: businessDaysAgo(-3), reasonCode: "asked_reschedule" });
    const c = await assigned();
    await courier.markDelivered({ orderId: c });

    const reports = (await import("../../reports-router")).reportsRouter.createCaller(ctxFor(db, s.tenantId, s.agentId, "ceo"));
    const r = await reports.failedDeliveries({ dateFrom: businessDaysAgo(1), dateTo: businessToday() });
    expect(r.totals).toMatchObject({ failed: 1, rescheduled: 1, delivered: 1, orders: 2, failShare: 0.5 });
    expect(r.byReason).toEqual([{ reason: "no_money", count: 1, share: 1 }]);
    expect(r.byCourier).toEqual([expect.objectContaining({ courierId: s.courierId, failed: 1, rescheduled: 1, delivered: 1 })]);
    expect(r.recent.map(x => x.kind).sort()).toEqual(["failed", "rescheduled"]);

    // Соседняя организация отчёта не видит.
    const other = (await import("../../reports-router")).reportsRouter.createCaller(ctxFor(db, s.otherTenantId, s.agentId, "ceo"));
    expect((await other.failedDeliveries({ dateFrom: businessDaysAgo(1), dateTo: businessToday() })).totals.failed).toBe(0);
  });

  it("доска, след и «Предложить порядок»: только курьер; порядок — от последней точки", async () => {
    // Три магазина на востоке от склада: 1, 3 и 2 км.
    const east = (km: number) => (69.2 + km / (111.32 * Math.cos((41.3 * Math.PI) / 180))).toFixed(8);
    const shopAt = async (km: number) => {
      const [r] = await (db as any).execute(sql`INSERT INTO shops (tenant_id, name, gps_lat, gps_lng) VALUES (${s.tenantId}, ${"Магазин " + km}, '41.30000000', ${east(km)})`) as unknown as [{ insertId: number }];
      return Number(r.insertId);
    };
    const op = await operatorApi();
    const ids: number[] = [];
    for (const km of [1, 3, 2]) {
      const id = await newOrder("1", await shopAt(km));
      await op.assignCourier({ orderId: id, courierId: s.courierId });
      ids.push(id);
    }
    await q(sql`INSERT INTO agent_locations (tenant_id, agent_id, lat, lng) VALUES (${s.tenantId}, ${s.courierId}, '41.30000000', '69.20000000')`);
    await q(sql`INSERT INTO agent_locations (tenant_id, agent_id, lat, lng) VALUES (${s.tenantId}, ${s.agentId}, '41.31000000', '69.21000000')`);

    const r = await op.suggestRoute({ courierId: s.courierId });
    expect(r.orderIds).toEqual([ids[0], ids[2], ids[1]]);
    expect(r.fromCourier).toBe(true);
    expect(r.km).toBeCloseTo(3, 0);

    const board = await op.board();
    expect(board.couriers.map(c => c.id)).toEqual([s.courierId]);
    expect(board.couriers[0].lastPing).not.toBeNull();
    expect(board.couriers[0].open).toBe(3);
    expect(board.stops.map(x => x.orderId).sort()).toEqual([...ids].sort());

    const track = await op.dayTrack({ courierId: s.courierId, day: businessToday() });
    expect(track.points).toHaveLength(1);
    // След агента оператору не отдаётся.
    await expect(op.dayTrack({ courierId: s.agentId, day: businessToday() })).rejects.toThrow(/Курьер не найден/);
    await expect(op.suggestRoute({ courierId: s.agentId })).rejects.toThrow(/Курьер не найден/);
  });

  it("«Предложить порядок»: вчерашняя точка не старт, ждущий офиса — в конце; день плана — свой порядок", async () => {
    const east = (km: number) => (69.2 + km / (111.32 * Math.cos((41.3 * Math.PI) / 180))).toFixed(8);
    const shopAt = async (km: number) => {
      const [r] = await (db as any).execute(sql`INSERT INTO shops (tenant_id, name, gps_lat, gps_lng) VALUES (${s.tenantId}, ${"Магазин " + km}, '41.30000000', ${east(km)})`) as unknown as [{ insertId: number }];
      return Number(r.insertId);
    };
    const op = await operatorApi();
    const ids: number[] = [];
    for (const km of [1, 3, 2]) {
      const id = await newOrder("1", await shopAt(km));
      await op.assignCourier({ orderId: id, courierId: s.courierId });
      ids.push(id);
    }
    // Вечерняя точка, три часа назад, далеко на востоке — стартом не годится.
    await q(sql`INSERT INTO agent_locations (tenant_id, agent_id, lat, lng, recorded_at, created_at)
      VALUES (${s.tenantId}, ${s.courierId}, '41.30000000', ${east(10)}, NOW() - INTERVAL 3 HOUR, NOW() - INTERVAL 3 HOUR)`);
    const stale = await op.suggestRoute({ courierId: s.courierId });
    expect(stale).toMatchObject({ fromCourier: false, startAt: null });

    // Свежая точка у склада — старт от неё; заказ, ждущий офиса, — последним.
    await q(sql`INSERT INTO agent_locations (tenant_id, agent_id, lat, lng, recorded_at) VALUES (${s.tenantId}, ${s.courierId}, '41.30000000', '69.20000000', NOW())`);
    await q(sql`UPDATE orders SET status = 'pending' WHERE id = ${ids[0]}`);
    const r = await op.suggestRoute({ courierId: s.courierId });
    expect(r.fromCourier).toBe(true);
    expect(r.orderIds).toEqual([ids[2], ids[1], ids[0]]);
    expect(r.held).toBe(1);
    expect((await op.board()).couriers[0]).toMatchObject({ open: 3, held: 1 });

    // Порядок на сегодня, потом — на послезавтра: заказ, перенесённый туда,
    // в сегодняшней доске не виден, а сохранение его дня не стирает сегодняшний.
    await op.setRouteOrder({ courierId: s.courierId, orderIds: [ids[2], ids[1], ids[0]] });
    const later = businessDaysAgo(-2);
    await (await courierApi()).reschedule({ orderId: ids[1], date: later });
    expect((await op.board()).stops.map(x => x.orderId)).not.toContain(ids[1]);
    const ahead = await op.board({ date: later });
    expect(ahead.day).toBe(later);
    expect(ahead.stops.map(x => x.orderId)).toEqual([ids[1]]);
    await op.setRouteOrder({ courierId: s.courierId, date: later, orderIds: [ids[1]] });
    const seq = Object.fromEntries((await q(sql`SELECT id, route_seq AS r FROM orders WHERE id IN (${ids[0]}, ${ids[1]}, ${ids[2]})`)).map(x => [Number(x.id), x.r]));
    expect(seq).toEqual({ [ids[2]]: 1, [ids[0]]: 3, [ids[1]]: 1 });
    // Сегодняшний заказ в порядок другого дня не берётся.
    await expect(op.setRouteOrder({ courierId: s.courierId, date: later, orderIds: [ids[2]] })).rejects.toThrow(/обновите доску/);
    // Вчера и дальше двух недель — отказ.
    await expect(op.board({ date: businessDaysAgo(1) })).rejects.toThrow(/с сегодняшнего/);
    await expect(op.board({ date: businessDaysAgo(-15) })).rejects.toThrow(/не дальше чем на 14/);
  });

  it("след за день — по времени съёмки; отметка без своей точки несёт точку магазина", async () => {
    const [sh] = await (db as any).execute(sql`INSERT INTO shops (tenant_id, name, gps_lat, gps_lng) VALUES (${s.tenantId}, 'Магазин у дороги', '41.31000000', '69.25000000')`) as unknown as [{ insertId: number }];
    const id = await newOrder("1", Number(sh.insertId));
    await (await operatorApi()).assignCourier({ orderId: id, courierId: s.courierId });
    await (await courierApi()).markDelivered({ orderId: id });
    // Две точки из буфера телефона пришли одной пачкой: записаны в обратном
    // порядке, сняты — в прямом.
    await q(sql`INSERT INTO agent_locations (tenant_id, agent_id, lat, lng, recorded_at) VALUES (${s.tenantId}, ${s.courierId}, '41.30200000', '69.20200000', NOW() - INTERVAL 10 MINUTE)`);
    await q(sql`INSERT INTO agent_locations (tenant_id, agent_id, lat, lng, recorded_at) VALUES (${s.tenantId}, ${s.courierId}, '41.30100000', '69.20100000', NOW() - INTERVAL 20 MINUTE)`);
    const track = await (await operatorApi()).dayTrack({ courierId: s.courierId, day: businessToday() });
    expect(track.points.map(p => p.lat)).toEqual([41.301, 41.302]);
    expect(track.events).toHaveLength(1);
    expect(track.events[0]).toMatchObject({ kind: "delivered", lat: null, lng: null });
    expect(Number(track.events[0].shopLat)).toBeCloseTo(41.31, 5);
    expect(Number(track.events[0].shopLng)).toBeCloseTo(69.25, 5);
  });

  it("точка «Доставлено» и «Не довёз» — на строке журнала", async () => {
    const a = await assigned();
    const b = await assigned();
    const courier = await courierApi();
    await courier.markDelivered({ orderId: a, lat: "41.31100000", lng: "69.27900000" });
    await courier.markFailed({ orderId: b, reasonCode: "shop_closed", lat: "41.32000000", lng: "69.28000000" });
    const rows = await q(sql`SELECT order_id AS o, kind, lat, lng FROM delivery_events WHERE order_id IN (${a}, ${b}) ORDER BY id`);
    expect(rows.map(r => [Number(r.o), r.kind, Number(r.lat), Number(r.lng)])).toEqual([
      [a, "delivered", 41.311, 69.279],
      [b, "failed", 41.32, 69.28],
    ]);
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
