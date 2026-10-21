import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { agentLocations, deliveryEvents, orders, shops, users, warehouses } from "@db/schema";
import { businessToday } from "@contracts/business-time";
import { nearestNeighbour, routeKm, coordsOf, type LatLng } from "@contracts/route-order";
import { RESCHEDULE_MAX_DAYS } from "@contracts/delivery-fail-reason";
import { OPEN_ORDER_STATUSES } from "../lib/order-status";
import { onDay } from "../lib/date-range";
import { assertPlanDay } from "./delivery-events";
import { cleanTrack } from "./visit-geo";
import { defaultWarehouseId } from "./sales-warehouse";
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

/*
  Какой день смотрит диспетчер.

  Сегодня — всё, что курьер везёт сегодня: без даты и с датой не позже.
  Другой день (до двух недель вперёд) — только заказы, перенесённые ровно
  на него: их порядок можно собрать заранее, вечером накануне. Заказы без
  даты к будущему дню не относятся — они сегодняшние, и порядок для них
  ставится в сегодняшнем плане.
*/

/** День доски: пусто — сегодня; иначе сегодня … +RESCHEDULE_MAX_DAYS. */
export function boardDay(day: string | undefined, now: number = Date.now()): string {
  const today = businessToday(now);
  if (!day || day === today) return today;
  assertPlanDay(day, 0, RESCHEDULE_MAX_DAYS, now);
  return day;
}

/** Заказы плана на этот день — см. выше. */
export function onPlanDay(day: string, today: string = businessToday()): SQL {
  return day <= today ? dueBy(today) : eq(orders.plannedDeliveryDate, day);
}

/**
 * Заказ ждёт решения офиса (status = pending: скидка выше порога, просрочка
 * магазина). Он открыт и может стоять за курьером, но везти его рано: на
 * доске и в списке курьера он помечен, а в «Предложить порядок» уходит в
 * конец, как адрес без координат.
 */
export function isHeld(stop: { status: string | null }): boolean {
  return stop.status === "pending";
}

/** Точка курьера годится стартом маршрута, пока ей меньше двух часов. */
export const ROUTE_START_MAX_AGE_MS = 2 * 60 * 60 * 1000;

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

/*
  Склад остановки — склад заказа (ADR 0012), заказ без склада — основного.

  Погрузочный лист собирают с одного склада, а курьеру заказы назначают и
  по одному: в машине могут оказаться заказы основного склада и филиала.
  Доска называет склад у остановок такого курьера и предупреждает в его
  строке — иначе диспетчер узнаёт об этом, когда курьер уже уехал с
  одного склада без товара другого.
*/

/** Остановки курьеров на день: по курьеру, в порядке маршрута. */
async function stopsOf(db: Db, tenantId: number, day: string, courierId?: number) {
  const defaultWh = await defaultWarehouseId(db, tenantId);
  const stopWarehouse = sql`COALESCE(${orders.warehouseId}, ${defaultWh})`;
  const rows = await db.select({
    ...stopFields,
    warehouseId: sql<string | number | null>`${stopWarehouse}`,
    warehouseName: warehouses.name,
  }).from(orders)
    .leftJoin(shops, and(eq(orders.shopId, shops.id), eq(shops.tenantId, tenantId)))
    .leftJoin(warehouses, and(eq(warehouses.tenantId, tenantId), sql`${warehouses.id} = ${stopWarehouse}`))
    .where(and(
      ...inRunConditions(tenantId),
      onPlanDay(day),
      courierId ? eq(orders.courierId, courierId) : sql`${orders.courierId} IS NOT NULL`,
    ))
    .orderBy(asc(orders.courierId), sql`${orders.routeSeq} IS NULL`, asc(orders.routeSeq), desc(orders.createdAt))
    .limit(courierId ? 200 : 1000);
  // COALESCE отдаётся строкой — номер склада числом, как у остальных номеров.
  return rows.map(r => ({ ...r, warehouseId: r.warehouseId == null ? null : Number(r.warehouseId) }));
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
 * Доска на день (по умолчанию сегодня): курьеры (с последней точкой и счётом
 * дня) и их остановки.
 */
export async function dispatchBoard(db: Db, tenantId: number, date?: string) {
  const today = boardDay(date);
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
        held: stops.filter(s => s.courierId === c.id && isHeld(s)).length,
        /** Со скольких складов заказы в машине; больше одного — грузиться в двух местах. */
        warehouses: new Set(stops.filter(s => s.courierId === c.id).map(s => s.warehouseId)).size,
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
 *
 * След — по времени СЪЁМКИ и очищенный, как у агента (visit-geo cleanTrack):
 * точки, пролежавшие в буфере телефона без связи, приходят пачкой с одним
 * временем записи, и по нему линия шла зигзагом через полгорода. Отметка без
 * своей точки (старая сборка, GPS выключен) несёт точку магазина — по ней
 * доска ставит её на карту.
 */
export async function courierDayTrack(db: Db, tenantId: number, courierId: number, day: string) {
  const courier = await courierOf(db, tenantId, courierId);
  if (!courier) return null;
  const [raw, events] = await Promise.all([
    db.select({
      lat: agentLocations.lat, lng: agentLocations.lng, accuracy: agentLocations.accuracy,
      recordedAt: agentLocations.recordedAt, createdAt: agentLocations.createdAt,
    }).from(agentLocations)
      .where(and(eq(agentLocations.tenantId, tenantId), eq(agentLocations.agentId, courierId), onDay(agentLocations.createdAt, day)))
      .orderBy(asc(agentLocations.createdAt))
      .limit(3000),
    db.select({
      kind: deliveryEvents.kind, orderId: deliveryEvents.orderId, orderNumber: orders.orderNumber, shopName: shops.name,
      reasonCode: deliveryEvents.reasonCode, lat: deliveryEvents.lat, lng: deliveryEvents.lng, at: deliveryEvents.recordedAt,
      shopLat: shops.gpsLat, shopLng: shops.gpsLng,
    }).from(deliveryEvents)
      .innerJoin(orders, and(eq(orders.id, deliveryEvents.orderId), eq(orders.tenantId, tenantId)))
      .leftJoin(shops, and(eq(shops.id, orders.shopId), eq(shops.tenantId, tenantId)))
      .where(and(eq(deliveryEvents.tenantId, tenantId), eq(deliveryEvents.courierId, courierId), onDay(deliveryEvents.recordedAt, day)))
      .orderBy(asc(deliveryEvents.recordedAt))
      .limit(500),
  ]);
  const points = cleanTrack(raw
    .map(p => ({
      lat: Number(p.lat), lng: Number(p.lng),
      accuracy: p.accuracy == null ? null : Number(p.accuracy),
      at: new Date(p.recordedAt ?? p.createdAt),
    }))
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)));
  return { courier, day, points, events };
}

/**
 * Порядок «ближайший сосед» для остановок курьера на день — предложение, не
 * запись: сохраняет его диспетчер (courier.setRouteOrder), когда согласен.
 *
 * Старт — последняя точка курьера, если ей меньше двух часов и план —
 * сегодняшний. Утром последняя точка обычно вчерашняя: там, где курьер
 * выключил слежение вечером (часто — дома), и маршрут от неё шёл бы не с
 * того конца города, а километры врали. Нет свежей точки — от первой
 * остановки с координатами.
 *
 * Заказы, ждущие офиса, — в конце (как адреса без координат): везти их
 * рано, и в середине маршрута они только путают.
 */
export async function suggestCourierRoute(db: Db, tenantId: number, courierId: number, date?: string, now: number = Date.now()) {
  const day = boardDay(date, now);
  const courier = await courierOf(db, tenantId, courierId);
  if (!courier) return null;
  const [stops, pings] = await Promise.all([
    stopsOf(db, tenantId, day, courierId),
    lastPings(db, tenantId, [courierId]),
  ]);
  const ping = pings.get(courierId);
  const fresh = ping && day === businessToday(now) && now - ping.at.getTime() < ROUTE_START_MAX_AGE_MS ? ping : null;
  const start: LatLng | null = fresh ? coordsOf(fresh) : null;
  const ready = stops.filter(s => !isHeld(s));
  const held = stops.filter(isHeld);
  const routed = nearestNeighbour(ready, start);
  const ordered = [...routed, ...held];
  return {
    orderIds: ordered.map(s => s.orderId),
    km: Math.round(routeKm(routed, start) * 10) / 10,
    noGps: ordered.filter(s => !coordsOf(s)).length,
    held: held.length,
    fromCourier: !!start,
    startAt: fresh ? fresh.at : null,
  };
}
