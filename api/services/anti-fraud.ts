import { sql, eq, and, or, gte, lte, inArray } from "drizzle-orm";
import { agentLocations, dailyPlans, shops } from "@db/schema";

type DrizzleInstance = ReturnType<typeof import("../queries/connection").getDb>;

export interface FraudCheckResult {
  isSuspicious: boolean;
  fraudScore: number;
  reasons: string[];
  details: {
    gpsVerified: boolean;
    /** За день нет ни одной точки: проверить нечем — это не подозрение. */
    gpsMissing: boolean;
    /** Есть точки с подменёнными координатами (эмулятор GPS). */
    gpsMocked: boolean;
    distanceToShop: number;
    visitDuration: number;
    duplicateVisit: boolean;
    photoTimingValid: boolean; // NOTE: actually checks if photo EXISTS, not timing
  };
}

/*
  Что считается «рядом с магазином» и «слишком быстро».

  Экспортируются, потому что разбор дня (services/visit-geo.ts) отвечает на те
  же два вопроса — где был и сколько пробыл — и обязан отвечать теми же
  числами. Своя копия пятисот метров в соседнем файле означала бы, что визит,
  признанный подозрительным здесь, на экране «как прошёл день» выглядит
  безупречным.
*/
export const GEOFENCE_RADIUS = 500;
export const MIN_VISIT_DURATION = 5;
const MAX_SAME_SHOP_VISITS = 2;

interface GpsPing {
  lat: string;
  lng: string;
  createdAt: Date;
  mocked?: boolean;
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
    return { isSuspicious: false, fraudScore: 0, reasons: [], details: { gpsVerified: false, gpsMissing: true, gpsMocked: false, distanceToShop: 0, visitDuration: 0, duplicateVisit: false, photoTimingValid: false } };
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
      mocked: agentLocations.mocked,
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

  /*
    Нет GPS ≠ фрод. Пустой день (телефон без разрешения, разряженный, старая
    сборка) давал minDistance = Infinity → «агент был в Infinityм от
    магазина», +40 и подозрение, а из подозрения — вычет из зарплаты. Данных
    нет — проверить нечем; это отдельный признак, не обвинение.
    Подмена координат — наоборот, единственный признак, который не бывает
    случайным.
  */
  const gpsMissing = gpsPings.length === 0;
  const gpsMocked = gpsPings.some(p => p.mocked === true);
  if (gpsMocked) {
    reasons.push("Подменённые GPS-координаты (эмулятор местоположения)");
    fraudScore += 50;
  }

  if (gpsMissing) {
    reasons.push("Нет GPS-данных за день — визит не проверен");
  } else if (shop?.gpsLat && shop?.gpsLng) {
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
  if (!gpsMissing && shop?.gpsLat && shop?.gpsLng) {
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
      gpsMissing,
      gpsMocked,
      distanceToShop,
      visitDuration,
      duplicateVisit,
      photoTimingValid,
    },
  };
}

/** Итог проверки визитов агента за период — то, что видят KPI и зарплата. */
export interface FraudMetrics {
  totalVisits: number;
  suspiciousVisits: number;
  fraudRate: number;
  avgVisitDuration: number;
  avgDistanceToShop: number;
}

const NO_VISITS: FraudMetrics = { totalVisits: 0, suspiciousVisits: 0, fraudRate: 0, avgVisitDuration: 0, avgDistanceToShop: 0 };
const DAY_MS = 24 * 60 * 60 * 1000;

/** Один агент — частный случай пакетного расчёта ниже, с теми же числами. */
export async function calculateFraudMetrics(
  db: DrizzleInstance,
  agentId: number,
  tenantId: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<FraudMetrics> {
  const byAgent = await calculateFraudMetricsForAgents(db, [agentId], tenantId, periodStart, periodEnd);
  return byAgent.get(agentId) ?? { ...NO_VISITS };
}

/**
 * Проверка визитов за период — сразу по всем агентам, одним набором запросов.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Точки GPS читались отдельным запросом на КАЖДЫЙ день с визитами КАЖДОГО
 * агента, а ведомость зарплаты и «KPI агентов» звали расчёт на всех агентов
 * разом (Promise.all). 30 агентов за месяц — около 660 запросов к
 * agent_locations одновременно: пул соединений занят целиком, и любой другой
 * экран организации в это время ждёт в очереди.
 *
 * ── Что теперь ──────────────────────────────────────────────────────────────
 *
 * Четыре запроса на весь период при любом числе агентов и дней: визиты,
 * точки GPS, магазины, счётчики повторов. Точки берутся ровно по тем окнам,
 * что и раньше (сутки дня визита, границы включительно), только одним
 * запросом: окна соседних дней одного агента склеиваются в один отрезок, и в
 * запрос уходит OR отрезков по индексу (tenant, agent, created_at). Дни без
 * визитов, как и раньше, не читаются. Раскладка по дням — в памяти.
 *
 * Числа обязаны совпадать со старым расчётом до визита: по ним уже разбирали
 * агентов и удерживали из зарплаты. Это сверяет на настоящей базе
 * api/__tests__/real-db/fraud-metrics-one-query.test.ts — старый расчёт
 * перенесён туда дословно.
 */
export async function calculateFraudMetricsForAgents(
  db: DrizzleInstance,
  agentIds: readonly number[],
  tenantId: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<Map<number, FraudMetrics>> {
  const ids = [...new Set(agentIds)];
  const result = new Map<number, FraudMetrics>(ids.map(id => [id, { ...NO_VISITS }]));
  if (ids.length === 0) return result;

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
      inArray(dailyPlans.agentId, ids),
      eq(dailyPlans.status, "visited"),
      gte(dailyPlans.planDate, periodStart),
      lte(dailyPlans.planDate, periodEnd),
    ));
  if (plans.length === 0) return result;

  /*
    День визита — тем же ключом, что и раньше: дата плана в UTC
    (toISOString), окно — от полуночи этого дня по часам сервера плюс сутки.
    Смешанный ключ унаследован и сохранён намеренно: цель — убрать запросы, а
    не сдвинуть окна, по которым уже считали.
  */
  const visitDayOf = (planDate: Date) => new Date(planDate).toISOString().slice(0, 10);
  const plansByAgent = new Map<number, typeof plans>();
  for (const plan of plans) {
    const list = plansByAgent.get(plan.agentId!) ?? [];
    list.push(plan);
    plansByAgent.set(plan.agentId!, list);
  }

  // Окна суток по агентам; соседние склеиваются, чтобы запрос был коротким.
  const ranges: Array<{ agentId: number; start: Date; end: Date }> = [];
  for (const [agentId, list] of plansByAgent) {
    const days = [...new Set(list.map(p => visitDayOf(p.planDate)))].sort();
    let cur: { agentId: number; start: Date; end: Date } | null = null;
    for (const day of days) {
      const start = new Date(day + "T00:00:00");
      const end = new Date(start.getTime() + DAY_MS);
      if (cur && start.getTime() <= cur.end.getTime()) {
        if (end.getTime() > cur.end.getTime()) cur.end = end;
      } else {
        cur = { agentId, start, end };
        ranges.push(cur);
      }
    }
  }

  const shopIds = [...new Set(plans.map(p => p.shopId).filter((id): id is number => id != null))];
  // Окно повтора — сам день и следующий (см. duplicateCountFor), поэтому
  // выборка на сутки шире периода: у визита в последний день периода
  // «завтра» иначе просто не нашлось бы.
  const dupWindowEnd = new Date(periodEnd.getTime() + DAY_MS);

  const [pingRows, shopRows, dupRows] = await Promise.all([
    db.select({
      agentId: agentLocations.agentId,
      lat: agentLocations.lat,
      lng: agentLocations.lng,
      createdAt: agentLocations.createdAt,
      mocked: agentLocations.mocked,
    }).from(agentLocations)
      .where(and(
        eq(agentLocations.tenantId, tenantId),
        or(...ranges.map(r => and(
          eq(agentLocations.agentId, r.agentId),
          gte(agentLocations.createdAt, r.start),
          lte(agentLocations.createdAt, r.end),
        ))),
      ))
      .orderBy(agentLocations.agentId, agentLocations.createdAt),

    // Магазины — одним запросом на всех, как и было на одного.
    shopIds.length > 0
      ? db.select({
        id: shops.id,
        gpsLat: shops.gpsLat,
        gpsLng: shops.gpsLng,
        name: shops.name,
      }).from(shops)
        .where(and(eq(shops.tenantId, tenantId), inArray(shops.id, shopIds)))
      : Promise.resolve([] as Array<{ id: number } & VisitShopRow>),

    // Счётчик повторов группируется по «агент + магазин + день». Окно
    // проверки в verifyVisit — от полуночи дня визита ВКЛЮЧИТЕЛЬНО до
    // полуночи следующего дня, а plan_date — колонка DATE, поэтому в него
    // попадает и сам день, и следующий.
    db.select({
      agentId: dailyPlans.agentId,
      shopId: dailyPlans.shopId,
      planDate: dailyPlans.planDate,
      count: sql<number>`count(*)`,
    }).from(dailyPlans)
      .where(and(
        eq(dailyPlans.tenantId, tenantId),
        inArray(dailyPlans.agentId, ids),
        eq(dailyPlans.status, "visited"),
        gte(dailyPlans.planDate, periodStart),
        lte(dailyPlans.planDate, dupWindowEnd),
      ))
      .groupBy(dailyPlans.agentId, dailyPlans.shopId, dailyPlans.planDate),
  ]);

  const pingsByAgent = new Map<number, Array<GpsPing & { t: number }>>();
  for (const row of pingRows) {
    const list = pingsByAgent.get(row.agentId) ?? [];
    list.push({ lat: row.lat, lng: row.lng, createdAt: row.createdAt, mocked: row.mocked, t: new Date(row.createdAt).getTime() });
    pingsByAgent.set(row.agentId, list);
  }

  const shopById = new Map<number, VisitShopRow>();
  for (const row of shopRows) shopById.set(row.id, { gpsLat: row.gpsLat, gpsLng: row.gpsLng, name: row.name });

  const visitsByShopDay = new Map<string, number>();
  for (const row of dupRows) {
    visitsByShopDay.set(`${row.agentId}:${row.shopId}:${dayKeyOf(row.planDate)}`, Number(row.count));
  }
  const duplicateCountFor = (agentId: number, shopId: number | null, planDate: Date): number => {
    const day = new Date(planDate);
    const nextDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    return (visitsByShopDay.get(`${agentId}:${shopId}:${dayKeyOf(day)}`) ?? 0)
      + (visitsByShopDay.get(`${agentId}:${shopId}:${dayKeyOf(nextDay)}`) ?? 0);
  };

  for (const [agentId, agentPlans] of plansByAgent) {
    // Точки дня — из общей выборки агента по тем же границам, что стояли в
    // запросе на день: created_at от полуночи до полуночи, обе включительно.
    const all = pingsByAgent.get(agentId) ?? [];
    const pingsOfDay = new Map<string, GpsPing[]>();
    const dayPings = (day: string): GpsPing[] => {
      const known = pingsOfDay.get(day);
      if (known) return known;
      const from = new Date(day + "T00:00:00").getTime();
      const to = from + DAY_MS;
      const picked = all.filter(p => p.t >= from && p.t <= to);
      pingsOfDay.set(day, picked);
      return picked;
    };

    let suspiciousVisits = 0;
    let totalDuration = 0;
    let totalDistance = 0;
    let validChecks = 0;

    for (const plan of agentPlans) {
      const check = await verifyVisit(db, plan.id, tenantId, dayPings(visitDayOf(plan.planDate)), undefined, {
        plan,
        shop: plan.shopId != null ? shopById.get(plan.shopId) : undefined,
        duplicateCount: duplicateCountFor(agentId, plan.shopId, new Date(plan.planDate)),
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

    const totalVisits = agentPlans.length;
    result.set(agentId, {
      totalVisits,
      suspiciousVisits,
      fraudRate: totalVisits > 0 ? Math.round((suspiciousVisits / totalVisits) * 100) : 0,
      avgVisitDuration: validChecks > 0 ? Math.round(totalDuration / validChecks) : 0,
      avgDistanceToShop: validChecks > 0 ? Math.round(totalDistance / validChecks) : 0,
    });
  }

  return result;
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
