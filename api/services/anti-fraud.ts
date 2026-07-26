import { sql, eq, and, gte, lte } from "drizzle-orm";
import type { DrizzleInstance } from "../queries/connection";
import { agentLocations, dailyPlans, shops } from "@db/schema";

export interface FraudCheckResult {
  isSuspicious: boolean;
  fraudScore: number;
  reasons: string[];
  details: {
    gpsVerified: boolean;
    distanceToShop: number;
    visitDuration: number;
    duplicateVisit: boolean;
    photoTimingValid: boolean;
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

export async function verifyVisit(
  db: DrizzleInstance,
  planId: number,
  tenantId: number,
  gpsPings?: GpsPing[],
): Promise<FraudCheckResult> {
  const reasons: string[] = [];
  let fraudScore = 0;

  const [plan] = await db.select({
    id: dailyPlans.id,
    shopId: dailyPlans.shopId,
    planDate: dailyPlans.planDate,
    agentId: dailyPlans.agentId,
    status: dailyPlans.status,
    photoUrl: dailyPlans.photoUrl,
  }).from(dailyPlans)
    .where(and(eq(dailyPlans.id, planId), eq(dailyPlans.tenantId, tenantId)))
    .limit(1);

  if (!plan) {
    return { isSuspicious: false, fraudScore: 0, reasons: [], details: { gpsVerified: false, distanceToShop: 0, visitDuration: 0, duplicateVisit: false, photoTimingValid: false } };
  }

  const [shop] = await db.select({
    gpsLat: shops.gpsLat,
    gpsLng: shops.gpsLng,
    name: shops.name,
  }).from(shops)
    .where(eq(shops.id, plan.shopId!))
    .limit(1);

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

  const [duplicateCount] = await db.select({
    count: sql<number>`count(*)`,
  }).from(dailyPlans)
    .where(and(
      eq(dailyPlans.tenantId, tenantId),
      eq(dailyPlans.agentId, plan.agentId!),
      eq(dailyPlans.shopId, plan.shopId!),
      eq(dailyPlans.status, "visited"),
      gte(dailyPlans.planDate, dayStart),
      lte(dailyPlans.planDate, dayEnd),
    ));

  if (Number(duplicateCount?.count ?? 0) > MAX_SAME_SHOP_VISITS) {
    duplicateVisit = true;
    reasons.push(`${Number(duplicateCount?.count ?? 0)} визитов в один магазин за день (макс. ${MAX_SAME_SHOP_VISITS})`);
    fraudScore += 25;
  }

  const photoTimingValid = plan.photoUrl != null;

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

  let suspiciousVisits = 0;
  let totalDuration = 0;
  let totalDistance = 0;
  let validChecks = 0;

  for (const plan of plans) {
    const dayKey = new Date(plan.planDate).toISOString().slice(0, 10);
    const dayPings = gpsCache.get(dayKey) ?? [];
    const check = await verifyVisit(db, plan.id, tenantId, dayPings);
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
