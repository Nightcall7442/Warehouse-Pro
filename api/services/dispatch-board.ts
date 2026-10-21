import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { agentLocations, deliveryEvents, orders, shops, users } from "@db/schema";
import { businessToday } from "@contracts/business-time";
import { nearestNeighbour, routeKm, coordsOf, type LatLng } from "@contracts/route-order";
import { OPEN_ORDER_STATUSES } from "../lib/order-status";
import { onDay } from "../lib/date-range";
import type { Db } from "./order-shared";

/*
  Доска развоза: где курьеры, что у кого в машине, в каком порядке.

  ── Только курьеры ──────────────────────────────────────────────────────────

  Точки GPS пишут и агенты, и мерчендайзеры, и курьеры — в одну таблицу.
  Доска открыта оператору, а след агента оператору не показывается (это
  экран супервайзера). Поэтому каждая ручка здесь сначала проверяет, что
  номер — КУРЬЕР этой организации, и только потом читает его точки: номер
  агента в запросе оператора — отказ, а не его маршрут за день.
*/

const ACTIVE_DELIVERY = ["assigned", "out_for_delivery"] as const;

/** Открытый заказ в развозе — то, что курьер везёт. */
export function inRunConditions(tenantId: number): SQL[] {
  return [
    eq(orders.tenantId, tenantId),
    // Удалённый заказ курьеру не показывается: его резерв уже вернулся на склад.
    isNull(orders.deletedAt),
    inArray(orders.status, OPEN_ORDER_STATUSES),
    inArray(orders.deliveryStatus, [...ACTIVE_DELIVERY]),
  ];
}

/** Заказ на этот день: без даты (сегодня) или с датой не позже. */
export function dueBy(day: string): SQL {
  return or(isNull(orders.plannedDeliveryDate), lte(orders.plannedDeliveryDate, day))!;
}

/** Курьер этой организации — или null. Агент, супервайзер, чужой — null. */
export async function courierOf(db: Db, tenantId: number, userId: number): Promise<{ id: number; name: string } | null> {
  const [u] = await db.select({ id: users.id, name: users.name }).from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), eq(users.role, "courier")))
    .limit(1);
  return u ?? null;
}

const stopFields = {
  orderId: orders.id,
  orderNumber: orders.orderNumber,
  courierId: orders.courierId,
  status: orders.status,
  deliveryStatus: orders.deliveryStatus,
  routeSeq: orders.routeSeq,
  plannedDeliveryDate: orders.plannedDeliveryDate,
  total: orders.total,
  shopName: shops.name,
  shopAddress: shops.address,
  lat: shops.gpsLat,
  lng: shops.gpsLng,
};

/** Сегодняшние остановки курьеров: по курьеру, в порядке маршрута. */
async function stopsOf(db: Db, tenantId: number, today: string, courierId?: number) {
  return db.select(stopFields).from(orders)
    .leftJoin(shops, and(eq(orders.shopId, shops.id), eq(shops.tenantId, tenantId)))
    .where(and(
      ...inRunConditions(tenantId),
      dueBy(today),
      courierId ? eq(orders.courierId, courierId) : sql`${orders.courierId} IS NOT NULL`,
    ))
    .orderBy(asc(orders.courierId), sql`${orders.routeSeq} IS NULL`, asc(orders.routeSeq), desc(orders.createdAt))
    .limit(courierId ? 200 : 1000);
}

/** Последняя точка за сутки — по каждому из этих людей. */
async function lastPings(db: Db, tenantId: number, ids: number[]) {
  if (ids.length === 0) return new Map<number, { lat: string; lng: string; at: Date }>();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const maxIds = await db.select({ agentId: agentLocations.agentId, maxId: sql<number>`max(${agentLocations.id})` })
    .from(agentLocations)
    .where(and(eq(agentLocations.tenantId, tenantId), inArray(agentLocations.agentId, ids), gte(agentLocations.createdAt, since)))
    .groupBy(agentLocations.agentId);
  if (maxIds.length === 0) return new Map();
  const rows = await db.select({
    agentId: agentLocations.agentId, lat: agentLocations.lat, lng: agentLocations.lng,
    at: sql<Date>`COALESCE(${agentLocations.recordedAt}, ${agentLocations.createdAt})`,
  }).from(agentLocations)
    .where(and(eq(agentLocations.tenantId, tenantId), inArray(agentLocations.id, maxIds.map(m => Number(m.maxId)))));
  return new Map(rows.map(r => [r.agentId, { lat: String(r.lat), lng: String(r.lng), at: new Date(r.at) }]));
}

/**
 * Доска на сегодня: курьеры (с последней точкой и счётом дня) и их остановки.
 */
export async function dispatchBoard(db: Db, tenantId: number) {
  const today = businessToday();
  const couriers = await db.select({ id: users.id, name: users.name, phone: users.phone }).from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.role, "courier"), eq(users.status, "active")))
    .orderBy(asc(users.name));
  const ids = couriers.map(c => c.id);

  const [stops, pings, delivered, attempts] = await Promise.all([
    stopsOf(db, tenantId, today),
    lastPings(db, tenantId, ids),
    ids.length ? db.select({ courierId: orders.courierId, n: sql<number>`COUNT(*)` }).from(orders)
      .where(and(eq(orders.tenantId, tenantId), inArray(orders.courierId, ids), eq(orders.deliveryStatus, "delivered"), onDay(orders.deliveredAt, today)))
      .groupBy(orders.courierId) : Promise.resolve([]),
    // Срыв снимает курьера с заказа — считать его можно только по журналу.
    ids.length ? db.select({ courierId: deliveryEvents.courierId, kind: deliveryEvents.kind, n: sql<number>`COUNT(*)` }).from(deliveryEvents)
      .where(and(eq(deliveryEvents.tenantId, tenantId), inArray(deliveryEvents.courierId, ids), inArray(deliveryEvents.kind, ["failed", "rescheduled"]), onDay(deliveryEvents.recordedAt, today)))
      .groupBy(deliveryEvents.courierId, deliveryEvents.kind) : Promise.resolve([]),
  ]);

  const doneBy = new Map(delivered.map(r => [r.courierId, Number(r.n)]));
  const countOf = (id: number, kind: string) => attempts.filter(a => a.courierId === id && a.kind === kind).reduce((s, a) => s + Number(a.n), 0);

  return {
    day: today,
    couriers: couriers.map(c => {
      const ping = pings.get(c.id) ?? null;
      return {
        id: c.id, name: c.name, phone: c.phone,
        lastPing: ping ? { lat: ping.lat, lng: ping.lng, at: ping.at } : null,
        open: stops.filter(s => s.courierId === c.id).length,
        delivered: doneBy.get(c.id) ?? 0,
        failed: countOf(c.id, "failed"),
        rescheduled: countOf(c.id, "rescheduled"),
      };
    }),
    stops,
  };
}

/**
 * След курьера за день и его отметки — для линии маршрута на доске.
 * null — номер не курьера этой организации.
 */
export async function courierDayTrack(db: Db, tenantId: number, courierId: number, day: string) {
  const courier = await courierOf(db, tenantId, courierId);
  if (!courier) return null;
  const [points, events] = await Promise.all([
    db.select({
      lat: agentLocations.lat, lng: agentLocations.lng,
      at: sql<Date>`COALESCE(${agentLocations.recordedAt}, ${agentLocations.createdAt})`,
    }).from(agentLocations)
      .where(and(eq(agentLocations.tenantId, tenantId), eq(agentLocations.agentId, courierId), onDay(agentLocations.createdAt, day)))
      .orderBy(asc(agentLocations.createdAt))
      .limit(3000),
    db.select({
      kind: deliveryEvents.kind, orderId: deliveryEvents.orderId, orderNumber: orders.orderNumber, shopName: shops.name,
      reasonCode: deliveryEvents.reasonCode, lat: deliveryEvents.lat, lng: deliveryEvents.lng, at: deliveryEvents.recordedAt,
    }).from(deliveryEvents)
      .innerJoin(orders, and(eq(orders.id, deliveryEvents.orderId), eq(orders.tenantId, tenantId)))
      .leftJoin(shops, and(eq(shops.id, orders.shopId), eq(shops.tenantId, tenantId)))
      .where(and(eq(deliveryEvents.tenantId, tenantId), eq(deliveryEvents.courierId, courierId), onDay(deliveryEvents.recordedAt, day)))
      .orderBy(asc(deliveryEvents.recordedAt))
      .limit(500),
  ]);
  return { courier, day, points, events };
}

/**
 * Порядок «ближайший сосед» для сегодняшних остановок курьера — предложение,
 * не запись: сохраняет его диспетчер (courier.setRouteOrder), когда согласен.
 * Старт — последняя точка курьера за сутки; её нет — первая остановка с
 * координатами.
 */
export async function suggestCourierRoute(db: Db, tenantId: number, courierId: number) {
  const courier = await courierOf(db, tenantId, courierId);
  if (!courier) return null;
  const [stops, pings] = await Promise.all([
    stopsOf(db, tenantId, businessToday(), courierId),
    lastPings(db, tenantId, [courierId]),
  ]);
  const ping = pings.get(courierId);
  const start: LatLng | null = ping ? coordsOf(ping) : null;
  const ordered = nearestNeighbour(stops, start);
  return {
    orderIds: ordered.map(s => s.orderId),
    km: Math.round(routeKm(ordered, start) * 10) / 10,
    noGps: ordered.filter(s => !coordsOf(s)).length,
    fromCourier: !!start,
  };
}
