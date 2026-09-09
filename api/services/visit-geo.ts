import { and, asc, eq, gte, lte } from "drizzle-orm";
import { agentLocations, dailyPlans, shops, users, visitReports } from "@db/schema";
import { haversineKm, pathLengthKm } from "@contracts/geo";
import { GEOFENCE_RADIUS, MIN_VISIT_DURATION } from "./anti-fraud";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

/* ═══════════════════════════════════════════════════════════════════════════
   Как прошёл день: шаги визита и геоаналитика.

   ── Что было ────────────────────────────────────────────────────────────────

   Координаты агента пишутся в agent_locations с самого начала — точка раз в
   пару минут, за год у клиента с тридцатью агентами это миллионы строк. И
   читались они РОВНО в одном месте: «где все сейчас» на карте слежения, по
   последней точке на человека. Весь остальной день — где ездил, сколько
   простоял в каждой точке, сколько намотал — лежал в базе и не отвечал ни на
   один вопрос.

   Визит при этом остаётся одной кнопкой: status = visited, visitedAt = сейчас.
   Ни времени прихода, ни времени ухода, ни координат в момент отметки.

   ── Почему шаги ВОССТАНАВЛИВАЮТСЯ, а не записываются ────────────────────────

   Честный check-in/check-out — это кнопки в мобильном приложении, а оно живёт
   в другом репозитории и выкладывается отдельно. Заведи мы сейчас ручку
   «отметить приход», её бы никто не вызвал: в этом продукте уже полдюжины
   таких ручек, написанных и мёртвых, и заводить седьмую — значит сделать вид,
   что работа сделана.

   Поэтому шаги собираются из того, что УЖЕ пишется:

       приехал   — первый пинг ближе GEOFENCE_RADIUS к магазину
       отметил   — daily_plans.visited_at
       сдал отчёт — visit_reports.created_at
       уехал     — последний пинг в той же зоне

   Это не хуже записанных кнопок, а по одному признаку лучше: агент не может
   нажать «пришёл», сидя дома. Пинги врут труднее.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Точность хуже этой — точку не считаем.
 *
 * Телефон в кармане в подвале отдаёт координату с погрешностью в километры.
 * Такая точка не сообщает, где человек был, зато исправно добавляет к пробегу
 * пару километров туда и обратно.
 */
const MAX_ACCURACY_M = 200;

/**
 * Быстрее этого между двумя точками человек не ездит.
 *
 * Одиночный выброс GPS уводит точку на десятки километров и возвращает
 * обратно. В пробеге это даёт лишние полсотни километров на ровном месте, и
 * именно так дневной пробег превращается в число, которому никто не верит.
 * 150 км/ч — с запасом на трассу; всё, что выше, — прыжок приёмника.
 */
const MAX_SPEED_KMH = 150;

export interface GeoPing {
  lat: number;
  lng: number;
  at: Date;
}

export interface VisitStep {
  planId: number;
  shopId: number;
  shopName: string;
  status: string;
  /** Приехал — первый пинг в зоне магазина. */
  arrivedAt: string | null;
  /** Уехал — последний пинг в зоне. */
  leftAt: string | null;
  /** Сколько пробыл, минуты. Считается по пингам, а не со слов. */
  minutes: number | null;
  /** Когда отметил визит в приложении. */
  visitedAt: string | null;
  /** Когда сдал отчёт мерчандайзера. */
  reportedAt: string | null;
  hasPhoto: boolean;
  /** Метры до магазина в ближайшей точке дня. null — координат магазина нет. */
  closestM: number | null;
  /** Чем день не сходится. Пусто — всё в порядке. */
  flags: string[];
}

export interface GeoDay {
  agentId: number;
  agentName: string;
  day: string;
  /** Первый и последний пинг — когда вышел на маршрут и когда закончил. */
  firstPingAt: string | null;
  lastPingAt: string | null;
  pings: number;
  /** Пробег по очищенным точкам. null — точек меньше двух, и это не ноль. */
  distanceKm: number | null;
  minutesInShops: number;
  minutesOnRoad: number | null;
  steps: VisitStep[];
  /** Сколько визитов с замечаниями. */
  problems: number;
}

/**
 * Очистка следа.
 *
 * Два шага и оба нужны: сначала выбрасываем заведомо неточные точки, потом —
 * прыжки, до которых доехать было невозможно. Порядок важен: неточная точка
 * часто и есть прыжок, и убрав её первой, мы не оборвём нормальный след.
 */
export function cleanTrack(raw: Array<GeoPing & { accuracy?: number | null }>): GeoPing[] {
  const byTime = [...raw].sort((a, b) => a.at.getTime() - b.at.getTime());
  const accurate = byTime.filter(p => p.accuracy == null || p.accuracy <= MAX_ACCURACY_M);

  const out: GeoPing[] = [];
  for (const p of accurate) {
    const prev = out[out.length - 1];
    if (!prev) { out.push(p); continue; }
    const hours = (p.at.getTime() - prev.at.getTime()) / 3_600_000;
    // Две точки одной секундой — не прыжок, а частая запись: расстояние между
    // ними ничтожно, а деление на ноль дало бы бесконечную скорость.
    if (hours <= 0) { out.push(p); continue; }
    const km = haversineKm(prev.lat, prev.lng, p.lat, p.lng);
    if (km / hours > MAX_SPEED_KMH) continue;
    out.push(p);
  }
  return out;
}

/** Минуты между двумя моментами, округлённые вниз. */
const minutesBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));

/**
 * Собрать день агента.
 *
 * Один запрос за пингами, один за планами, один за отчётами — независимо от
 * числа точек: на дне у активного агента их до пятисот, и ходить за каждой
 * отдельно значит не отдать экран вовсе.
 */
export async function buildGeoDay(
  db: Db,
  tenantId: number,
  agentId: number,
  day: string,
): Promise<GeoDay> {
  const from = new Date(`${day}T00:00:00`);
  const to = new Date(`${day}T23:59:59.999`);

  const [agent] = await db.select({ name: users.name }).from(users)
    .where(and(eq(users.id, agentId), eq(users.tenantId, tenantId))).limit(1);

  const [rawPings, plans, reports] = await Promise.all([
    db.select({
      lat: agentLocations.lat,
      lng: agentLocations.lng,
      accuracy: agentLocations.accuracy,
      recordedAt: agentLocations.recordedAt,
      createdAt: agentLocations.createdAt,
    }).from(agentLocations)
      .where(and(
        eq(agentLocations.tenantId, tenantId),
        eq(agentLocations.agentId, agentId),
        gte(agentLocations.createdAt, from),
        lte(agentLocations.createdAt, to),
      ))
      .orderBy(asc(agentLocations.createdAt))
      .limit(2000),

    db.select({
      id: dailyPlans.id,
      shopId: dailyPlans.shopId,
      status: dailyPlans.status,
      visitedAt: dailyPlans.visitedAt,
      hasPhoto: dailyPlans.photoUrl,
      shopName: shops.name,
      gpsLat: shops.gpsLat,
      gpsLng: shops.gpsLng,
    }).from(dailyPlans)
      .leftJoin(shops, and(eq(dailyPlans.shopId, shops.id), eq(shops.tenantId, tenantId)))
      .where(and(
        eq(dailyPlans.tenantId, tenantId),
        eq(dailyPlans.agentId, agentId),
        eq(dailyPlans.planDate, from),
      )),

    db.select({ planId: visitReports.planId, createdAt: visitReports.createdAt })
      .from(visitReports)
      .where(and(
        eq(visitReports.tenantId, tenantId),
        eq(visitReports.userId, agentId),
        gte(visitReports.createdAt, from),
        lte(visitReports.createdAt, to),
      )),
  ]);

  /*
    Время точки — когда её сняло УСТРОЙСТВО, если оно это сказало.

    Точки, пролежавшие в буфере без связи, приезжают пачкой и с одним и тем же
    created_at. Считай мы по нему, весь бессвязный участок маршрута схлопнулся
    бы в одну минуту, а пробег за него — в мгновенный прыжок через полгорода.
  */
  const track = cleanTrack(rawPings.map(p => ({
    lat: Number(p.lat),
    lng: Number(p.lng),
    accuracy: p.accuracy == null ? null : Number(p.accuracy),
    at: p.recordedAt ?? p.createdAt,
  })));

  const reportByPlan = new Map(reports.map(r => [r.planId, r.createdAt]));

  const steps: VisitStep[] = [];
  let minutesInShops = 0;

  for (const plan of plans) {
    const flags: string[] = [];
    const lat = plan.gpsLat == null ? null : Number(plan.gpsLat);
    const lng = plan.gpsLng == null ? null : Number(plan.gpsLng);

    let arrived: Date | null = null;
    let left: Date | null = null;
    let closestM: number | null = null;

    if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
      let closestKm = Infinity;
      const inside: Date[] = [];
      for (const p of track) {
        const km = haversineKm(lat, lng, p.lat, p.lng);
        if (km < closestKm) closestKm = km;
        if (km * 1000 <= GEOFENCE_RADIUS) inside.push(p.at);
      }
      closestM = closestKm === Infinity ? null : Math.round(closestKm * 1000);
      if (inside.length > 0) {
        arrived = inside[0];
        left = inside[inside.length - 1];
      }
    } else {
      // Без координат магазина проверить нечего, и молчать об этом нельзя:
      // «замечаний нет» тогда означало бы «мы не смотрели».
      flags.push("У магазина не заполнены координаты — визит проверить нечем");
    }

    const minutes = arrived && left ? minutesBetween(arrived, left) : null;
    if (minutes != null) minutesInShops += minutes;

    const visited = plan.status === "visited";
    if (visited && closestM != null && arrived == null) {
      flags.push(`Отмечен как посещённый, но ближе ${GEOFENCE_RADIUS} м к магазину агент за день не подходил (минимум ${closestM} м)`);
    }
    if (visited && minutes != null && minutes < MIN_VISIT_DURATION) {
      flags.push(`В точке пробыл ${minutes} мин — меньше ${MIN_VISIT_DURATION}`);
    }
    if (visited && track.length === 0) {
      flags.push("За день нет ни одной точки GPS — подтвердить визит нечем");
    }

    steps.push({
      planId: plan.id,
      shopId: plan.shopId,
      shopName: plan.shopName ?? "—",
      status: plan.status,
      arrivedAt: arrived?.toISOString() ?? null,
      leftAt: left?.toISOString() ?? null,
      minutes,
      visitedAt: plan.visitedAt?.toISOString() ?? null,
      reportedAt: reportByPlan.get(plan.id)?.toISOString() ?? null,
      hasPhoto: !!plan.hasPhoto,
      closestM,
      flags,
    });
  }

  // Порядок — как ехал: сначала те, где был, по времени приезда; следом те,
  // куда не доехал. Список по id не сказал бы ничего о дне.
  steps.sort((a, b) => {
    if (a.arrivedAt && b.arrivedAt) return a.arrivedAt.localeCompare(b.arrivedAt);
    if (a.arrivedAt) return -1;
    if (b.arrivedAt) return 1;
    return a.shopName.localeCompare(b.shopName);
  });

  const first = track[0]?.at ?? null;
  const last = track[track.length - 1]?.at ?? null;
  const onRoad = first && last ? Math.max(0, minutesBetween(first, last) - minutesInShops) : null;

  return {
    agentId,
    agentName: agent?.name ?? "—",
    day,
    firstPingAt: first?.toISOString() ?? null,
    lastPingAt: last?.toISOString() ?? null,
    pings: track.length,
    distanceKm: pathLengthKm(track.map(p => [p.lat, p.lng] as const)),
    minutesInShops,
    minutesOnRoad: onRoad,
    steps,
    problems: steps.filter(s => s.flags.length > 0).length,
  };
}
