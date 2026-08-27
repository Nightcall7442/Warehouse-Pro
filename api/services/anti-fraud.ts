import { sql, eq, and, gte, lte, inArray } from "drizzle-orm";
import { agentLocations, dailyPlans, shops } from "@db/schema";

type DrizzleInstance = ReturnType<typeof import("../queries/connection").getDb>;

export interface FraudCheckResult {
  isSuspicious: boolean;
  fraudScore: number;
  reasons: string[];
  details: {
    gpsVerified: boolean;
    distanceToShop: number;
    visitDuration: number;
    duplicateVisit: boolean;
    photoTimingValid: boolean; // NOTE: actually checks if photo EXISTS, not timing
  };
}

const GEOFENCE_RADIUS = 500;
const MIN_VISIT_DURATION = 5;
const MAX_SAME_SHOP_VISITS = 2;

interface GpsPing {
  lat: string;
  lng: string;
  createdAt: Date;
}

/** План визита в том виде, в каком его читает verifyVisit. */
export interface VisitPlanRow {
  id: number;
  shopId: number | null;
  planDate: Date;
  agentId: number | null;
  status: string;
  photoUrl: string | null;
}

/** Координаты магазина в том виде, в каком их читает verifyVisit. */
export interface VisitShopRow {
  gpsLat: string | null;
  gpsLng: string | null;
  name: string;
}

/**
 * Всё, что verifyVisit иначе прочитал бы из базы сам.
 *
 * Понадобилось для пакетного расчёта: calculateFraudMetrics и так держит в
 * памяти и планы, и магазины, и счётчики повторных визитов, а каждый вызов
 * verifyVisit всё равно ходил за ними заново — по три ДОПОЛНИТЕЛЬНЫХ
 * последовательных запроса на визит.
 */
export interface PrefetchedVisitContext {
  plan: VisitPlanRow;
  shop: VisitShopRow | undefined;
  /** Визиты агента в этот магазин, попадающие в проверяемое окно дня. */
  duplicateCount: number;
}

export async function verifyVisit(
  db: DrizzleInstance,
  planId: number,
  tenantId: number,
  gpsPings?: GpsPing[],
  providedPhotoUrl?: string,
  prefetched?: PrefetchedVisitContext,
): Promise<FraudCheckResult> {
  const reasons: string[] = [];
  let fraudScore = 0;

  // Одиночная проверка (агент отметился в приложении) читает всё сама — это
  // один визит и три запроса. Пакетный расчёт KPI передаёт уже прочитанное.
  const plan: VisitPlanRow | undefined = prefetched?.plan ?? (await db.select({
    id: dailyPlans.id,
    shopId: dailyPlans.shopId,
    planDate: dailyPlans.planDate,
    agentId: dailyPlans.agentId,
    status: dailyPlans.status,
    photoUrl: dailyPlans.photoUrl,
  }).from(dailyPlans)
    .where(and(eq(dailyPlans.id, planId), eq(dailyPlans.tenantId, tenantId)))
    .limit(1))[0];

  if (!plan) {
    return { isSuspicious: false, fraudScore: 0, reasons: [], details: { gpsVerified: false, distanceToShop: 0, visitDuration: 0, duplicateVisit: false, photoTimingValid: false } };
  }

  const shop: VisitShopRow | undefined = prefetched
    ? prefetched.shop
    : (await db.select({
      gpsLat: shops.gpsLat,
      gpsLng: shops.gpsLng,
      name: shops.name,
    }).from(shops)
      // Фильтр по арендатору обязателен на КАЖДОМ чтении. Здесь его не было, и
      // запрос держался только на том, что shopId пришёл из плана своего
      // тенанта — то есть на честности вызывающего, а не на самом запросе.
      .where(and(eq(shops.id, plan.shopId!), eq(shops.tenantId, tenantId)))
      .limit(1))[0];

  if (!gpsPings) {
    const planDate = new Date(plan.planDate);
    const dayStart = new Date(planDate.getFullYear(), planDate.getMonth(), planDate.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    gpsPings = await db.select({
      lat: agentLocations.lat,
      lng: agentLocations.lng,
      createdAt: agentLocations.createdAt,
    }).from(agentLocations)
      .where(and(
        eq(agentLocations.tenantId, tenantId),
        eq(agentLocations.agentId, plan.agentId!),
        gte(agentLocations.createdAt, dayStart),
        lte(agentLocations.createdAt, dayEnd),
      ))
      .orderBy(agentLocations.createdAt);
  }

  let gpsVerified = false;
  let distanceToShop = 0;

  if (shop?.gpsLat && shop?.gpsLng) {
    let minDistance = Infinity;
    for (const ping of gpsPings) {
      const dist = haversineDistance(
        Number(shop.gpsLat), Number(shop.gpsLng),
        Number(ping.lat), Number(ping.lng)
      );
      if (dist < minDistance) minDistance = dist;
    }

    distanceToShop = Math.round(minDistance);
    gpsVerified = minDistance <= GEOFENCE_RADIUS;

    if (!gpsVerified) {
      reasons.push(`Агент был в ${distanceToShop}м от магазина (макс. ${GEOFENCE_RADIUS}м)`);
      fraudScore += 40;
    }
  } else {
    reasons.push("Нет GPS координат у магазина");
    fraudScore += 10;
  }

  let visitDuration = 0;
  if (shop?.gpsLat && shop?.gpsLng) {
    const pingsAtShop = gpsPings.filter(p => {
      const dist = haversineDistance(
        Number(shop.gpsLat), Number(shop.gpsLng),
        Number(p.lat), Number(p.lng)
      );
      return dist <= GEOFENCE_RADIUS;
    });

    if (pingsAtShop.length >= 2) {
      const firstPing = new Date(pingsAtShop[0].createdAt);
      const lastPing = new Date(pingsAtShop[pingsAtShop.length - 1].createdAt);
      visitDuration = Math.round((lastPing.getTime() - firstPing.getTime()) / 60000);
    }

    if (visitDuration < MIN_VISIT_DURATION && visitDuration > 0) {
      reasons.push(`Визит длился ${visitDuration} мин (мин. ${MIN_VISIT_DURATION} мин)`);
      fraudScore += 30;
    }
  }

  let duplicateVisit = false;
  const planDate = new Date(plan.planDate);
  const dayStart = new Date(planDate.getFullYear(), planDate.getMonth(), planDate.getDate());
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const duplicates = prefetched
    ? prefetched.duplicateCount
    : Number((await db.select({
      count: sql<number>`count(*)`,
    }).from(dailyPlans)
      .where(and(
        eq(dailyPlans.tenantId, tenantId),
        eq(dailyPlans.agentId, plan.agentId!),
        eq(dailyPlans.shopId, plan.shopId!),
        eq(dailyPlans.status, "visited"),
        gte(dailyPlans.planDate, dayStart),
        lte(dailyPlans.planDate, dayEnd),
      )))[0]?.count ?? 0);

  if (duplicates > MAX_SAME_SHOP_VISITS) {
    duplicateVisit = true;
    reasons.push(`${duplicates} визитов в один магазин за день (макс. ${MAX_SAME_SHOP_VISITS})`);
    fraudScore += 25;
  }

  const photoTimingValid = providedPhotoUrl != null || plan.photoUrl != null;

  const isSuspicious = fraudScore >= 30;

  return {
    isSuspicious,
    fraudScore: Math.min(100, fraudScore),
    reasons,
    details: {
      gpsVerified,
      distanceToShop,
      visitDuration,
      duplicateVisit,
      photoTimingValid,
    },
  };
}

export async function calculateFraudMetrics(
  db: DrizzleInstance,
  agentId: number,
  tenantId: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<{
  totalVisits: number;
  suspiciousVisits: number;
  fraudRate: number;
  avgVisitDuration: number;
  avgDistanceToShop: number;
}> {
  const plans = await db.select({
    id: dailyPlans.id,
    shopId: dailyPlans.shopId,
    planDate: dailyPlans.planDate,
    agentId: dailyPlans.agentId,
    status: dailyPlans.status,
    photoUrl: dailyPlans.photoUrl,
  }).from(dailyPlans)
    .where(and(
      eq(dailyPlans.tenantId, tenantId),
      eq(dailyPlans.agentId, agentId),
      eq(dailyPlans.status, "visited"),
      gte(dailyPlans.planDate, periodStart),
      lte(dailyPlans.planDate, periodEnd),
    ));

  const plansByDay = new Map<string, typeof plans>();
  for (const plan of plans) {
    const dayKey = new Date(plan.planDate).toISOString().slice(0, 10);
    if (!plansByDay.has(dayKey)) plansByDay.set(dayKey, []);
    plansByDay.get(dayKey)!.push(plan);
  }

  const gpsCache = new Map<string, GpsPing[]>();
  for (const [dayKey] of plansByDay) {
    const dayStart = new Date(dayKey + "T00:00:00");
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const pings = await db.select({
      lat: agentLocations.lat,
      lng: agentLocations.lng,
      createdAt: agentLocations.createdAt,
    }).from(agentLocations)
      .where(and(
        eq(agentLocations.tenantId, tenantId),
        eq(agentLocations.agentId, agentId),
        gte(agentLocations.createdAt, dayStart),
        lte(agentLocations.createdAt, dayEnd),
      ))
      .orderBy(agentLocations.createdAt);
    gpsCache.set(dayKey, pings);
  }

  // Магазины и счётчики повторных визитов — по одному групповому запросу на
  // весь период вместо двух запросов на каждый визит.
  //
  // Раньше verifyVisit в цикле ниже читал план, магазин и счётчик повторов
  // сам: агент с 20 визитами в день за месяц — это ~440 планов × 3
  // последовательных запроса, ~1320 round-trip к MySQL подряд внутри одного
  // HTTP-запроса. На удалённой базе (RTT 2-5 мс) экран «KPI агентов» думал
  // 3-7 секунд на один клик, на квартале — втрое дольше, а territoryKpi на
  // десять агентов запускал десять таких цепочек разом.
  const shopIds = [...new Set(plans.map(p => p.shopId).filter((id): id is number => id != null))];
  const shopById = new Map<number, VisitShopRow>();
  if (shopIds.length > 0) {
    const shopRows = await db.select({
      id: shops.id,
      gpsLat: shops.gpsLat,
      gpsLng: shops.gpsLng,
      name: shops.name,
    }).from(shops)
      .where(and(eq(shops.tenantId, tenantId), inArray(shops.id, shopIds)));
    for (const row of shopRows) {
      shopById.set(row.id, { gpsLat: row.gpsLat, gpsLng: row.gpsLng, name: row.name });
    }
  }

  // Счётчик повторов группируется по паре «магазин + день». Окно проверки в
  // verifyVisit — от полуночи дня визита ВКЛЮЧИТЕЛЬНО до полуночи следующего
  // дня, а plan_date — колонка DATE, поэтому в него попадает и сам день, и
  // следующий. Окно сохранено ровно таким: цель правки — убрать лишние
  // запросы, а не изменить числа, по которым уже разбирали агентов.
  // Диапазон запроса на день шире периода — иначе у визита в последний день
  // периода «завтра» просто не нашлось бы.
  const dupWindowEnd = new Date(periodEnd.getTime() + 24 * 60 * 60 * 1000);
  const dupRows = await db.select({
    shopId: dailyPlans.shopId,
    planDate: dailyPlans.planDate,
    count: sql<number>`count(*)`,
  }).from(dailyPlans)
    .where(and(
      eq(dailyPlans.tenantId, tenantId),
      eq(dailyPlans.agentId, agentId),
      eq(dailyPlans.status, "visited"),
      gte(dailyPlans.planDate, periodStart),
      lte(dailyPlans.planDate, dupWindowEnd),
    ))
    .groupBy(dailyPlans.shopId, dailyPlans.planDate);

  const visitsByShopDay = new Map<string, number>();
  for (const row of dupRows) {
    visitsByShopDay.set(`${row.shopId}:${dayKeyOf(row.planDate)}`, Number(row.count));
  }

  const duplicateCountFor = (shopId: number | null, planDate: Date): number => {
    const day = new Date(planDate);
    const nextDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    return (visitsByShopDay.get(`${shopId}:${dayKeyOf(day)}`) ?? 0)
      + (visitsByShopDay.get(`${shopId}:${dayKeyOf(nextDay)}`) ?? 0);
  };

  let suspiciousVisits = 0;
  let totalDuration = 0;
  let totalDistance = 0;
  let validChecks = 0;

  for (const plan of plans) {
    const dayKey = new Date(plan.planDate).toISOString().slice(0, 10);
    const dayPings = gpsCache.get(dayKey) ?? [];
    const check = await verifyVisit(db, plan.id, tenantId, dayPings, undefined, {
      plan,
      shop: plan.shopId != null ? shopById.get(plan.shopId) : undefined,
      duplicateCount: duplicateCountFor(plan.shopId, new Date(plan.planDate)),
    });
    if (check.isSuspicious) suspiciousVisits++;
    if (check.details.visitDuration > 0) {
      totalDuration += check.details.visitDuration;
      validChecks++;
    }
    if (check.details.distanceToShop > 0) {
      totalDistance += check.details.distanceToShop;
    }
  }

  const totalVisits = plans.length;
  const fraudRate = totalVisits > 0 ? Math.round((suspiciousVisits / totalVisits) * 100) : 0;
  const avgVisitDuration = validChecks > 0 ? Math.round(totalDuration / validChecks) : 0;
  const avgDistanceToShop = validChecks > 0 ? Math.round(totalDistance / validChecks) : 0;

  return {
    totalVisits,
    suspiciousVisits,
    fraudRate,
    avgVisitDuration,
    avgDistanceToShop,
  };
}

/**
 * Ключ дня по локальному календарю сервера.
 *
 * Именно так дни и режет verifyVisit (new Date(y, m, d)), поэтому и группировка
 * повторных визитов обязана резать их так же. toISOString() здесь не годится:
 * он переводит в UTC, и при положительном смещении сервера визит, записанный
 * вечером, уехал бы в следующие сутки и перестал бы считаться повтором.
 */
function dayKeyOf(value: Date | string): string {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
