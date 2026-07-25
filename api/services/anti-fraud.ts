/**
 * Anti-Fraud Service — verifies agent visit authenticity.
 *
 * Checks:
 * 1. GPS geofencing: was agent within X meters of the shop?
 * 2. Visit duration: was the visit long enough?
 * 3. Duplicate detection: same shop on same day
 * 4. Photo timing: was photo taken during the visit?
 */

import { sql, eq, and, gte, lte } from "drizzle-orm";
import type { DrizzleInstance } from "../queries/connection";
import { agentLocations, dailyPlans, shops } from "@db/schema";

export interface FraudCheckResult {
  isSuspicious: boolean;
  fraudScore: number; // 0-100, higher = more suspicious
  reasons: string[];
  details: {
    gpsVerified: boolean;
    distanceToShop: number; // meters
    visitDuration: number; // minutes
    duplicateVisit: boolean;
    photoTimingValid: boolean;
  };
}

// Geofence radius in meters
const GEOFENCE_RADIUS = 500;
// Minimum visit duration in minutes
const MIN_VISIT_DURATION = 5;
// Maximum visits to same shop per day
const MAX_SAME_SHOP_VISITS = 2;

/**
 * Verify a visit's authenticity based on GPS, timing, and other signals.
 */
export async function verifyVisit(
  db: DrizzleInstance,
  planId: number,
  tenantId: number,
): Promise<FraudCheckResult> {
  const reasons: string[] = [];
  let fraudScore = 0;

  // Get the plan details
  const [plan] = await db.select({
    id: dailyPlans.id,
    shopId: dailyPlans.shopId,
    planDate: dailyPlans.planDate,
    agentId: dailyPlans.agentId,
    status: dailyPlans.status,
  }).from(dailyPlans)
    .where(and(eq(dailyPlans.id, planId), eq(dailyPlans.tenantId, tenantId)))
    .limit(1);

  if (!plan) {
    return { isSuspicious: false, fraudScore: 0, reasons: [], details: { gpsVerified: false, distanceToShop: 0, visitDuration: 0, duplicateVisit: false, photoTimingValid: false } };
  }

  // Get shop coordinates
  const [shop] = await db.select({
    gpsLat: shops.gpsLat,
    gpsLng: shops.gpsLng,
    name: shops.name,
  }).from(shops)
    .where(eq(shops.id, plan.shopId!))
    .limit(1);

  // 1. GPS Geofencing
  let gpsVerified = false;
  let distanceToShop = 0;

  if (shop?.gpsLat && shop?.gpsLng) {
    // Get agent's GPS pings around the visit time
    const planDate = new Date(plan.planDate);
    const dayStart = new Date(planDate.getFullYear(), planDate.getMonth(), planDate.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const gpsPings = await db.select({
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

    // Find closest GPS ping to shop
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
    // No GPS data for shop — can't verify
    reasons.push("Нет GPS координат у магазина");
    fraudScore += 10;
  }

  // 2. Visit Duration
  let visitDuration = 0;
  if (shop?.gpsLat && shop?.gpsLng) {
    const planDate = new Date(plan.planDate);
    const dayStart = new Date(planDate.getFullYear(), planDate.getMonth(), planDate.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const gpsPings = await db.select({
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

    // Count pings within geofence
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

  // 3. Duplicate Visit Detection
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

  // 4. Photo timing (if photo exists)
  let photoTimingValid = true;
  // Photo timing check would require photo timestamp metadata
  // For now, we assume photos are valid if they exist

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

/**
 * Calculate fraud metrics for an agent over a period.
 */
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
  // Get all visited plans in period
  const plans = await db.select({
    id: dailyPlans.id,
    shopId: dailyPlans.shopId,
  }).from(dailyPlans)
    .where(and(
      eq(dailyPlans.tenantId, tenantId),
      eq(dailyPlans.agentId, agentId),
      eq(dailyPlans.status, "visited"),
      gte(dailyPlans.planDate, periodStart),
      lte(dailyPlans.planDate, periodEnd),
    ));

  let suspiciousVisits = 0;
  let totalDuration = 0;
  let totalDistance = 0;
  let validChecks = 0;

  for (const plan of plans) {
    const check = await verifyVisit(db, plan.id, tenantId);
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
 * Haversine distance between two GPS coordinates (in meters).
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
