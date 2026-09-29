import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { sql, eq, and, gte, lte, inArray } from "drizzle-orm";
import * as schema from "@db/schema";
import { agentLocations, dailyPlans, shops } from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import {
  verifyVisit, calculateFraudMetrics, calculateFraudMetricsForAgents,
  type FraudMetrics, type VisitShopRow,
} from "../../services/anti-fraud";

/**
 * Проверка визитов за период: четыре запроса вместо запроса на каждый день
 * каждого агента — и те же числа до визита.
 *
 * Что было: calculateFraudMetrics читал точки GPS отдельным запросом на
 * каждый день с визитами, а ведомость зарплаты и «KPI агентов» звали его на
 * всех агентов разом. 30 агентов × 22 рабочих дня — около 750 запросов,
 * из них 660 к agent_locations, одновременно: пул соединений занят целиком.
 *
 * Что проверяется — на настоящей базе, на месяце 30 агентов по 22 рабочих
 * дня со случайными (но воспроизводимыми) визитами и точками:
 *   · числа нового расчёта (calculateFraudMetricsForAgents) по каждому агенту
 *     совпадают со СТАРЫМ расчётом — он перенесён сюда дословно
 *     (legacyFraudMetrics); одиночный calculateFraudMetrics — тоже;
 *   · в данных есть всё, на чём окна могли бы разойтись: точки ровно в
 *     полночь (попадают в два дня), визиты за границами периода, повтор в
 *     последний день периода с визитом «завтра», подменённые координаты,
 *     агент без единой точки, магазины без координат, точки и визиты того
 *     же агента в чужой организации;
 *   · сверка не пустая: есть и подозрительные, и чистые визиты, и визиты с
 *     длительностью;
 *   · запросов к базе — 4 на всех, у старого — больше, чем агенто-дней.
 *
 * Нарочная поломка (в calculateFraudMetricsForAgents): сделай окно дня
 * полуоткрытым (`p.t < to`) — падает сверка чисел; убери eq(tenantId) у
 * выборки точек — падает сверка чисел; не склеивай соседние дни в отрезок и
 * читай точки циклом по дням — падает «4 запроса».
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

type Db = Parameters<typeof calculateFraudMetrics>[0];

// ── Старый расчёт, дословно (до перехода на один запрос) ────────────────────
interface GpsPing { lat: string; lng: string; createdAt: Date; mocked?: boolean }
function legacyDayKeyOf(value: Date | string): string {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
async function legacyFraudMetrics(db: Db, agentId: number, tenantId: number, periodStart: Date, periodEnd: Date): Promise<FraudMetrics> {
  const plans = await db.select({
    id: dailyPlans.id, shopId: dailyPlans.shopId, planDate: dailyPlans.planDate,
    agentId: dailyPlans.agentId, status: dailyPlans.status, photoUrl: dailyPlans.photoUrl,
  }).from(dailyPlans)
    .where(and(
      eq(dailyPlans.tenantId, tenantId), eq(dailyPlans.agentId, agentId), eq(dailyPlans.status, "visited"),
      gte(dailyPlans.planDate, periodStart), lte(dailyPlans.planDate, periodEnd),
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
      lat: agentLocations.lat, lng: agentLocations.lng, createdAt: agentLocations.createdAt, mocked: agentLocations.mocked,
    }).from(agentLocations)
      .where(and(
        eq(agentLocations.tenantId, tenantId), eq(agentLocations.agentId, agentId),
        gte(agentLocations.createdAt, dayStart), lte(agentLocations.createdAt, dayEnd),
      ))
      .orderBy(agentLocations.createdAt);
    gpsCache.set(dayKey, pings);
  }

  const shopIds = [...new Set(plans.map(p => p.shopId).filter((id): id is number => id != null))];
  const shopById = new Map<number, VisitShopRow>();
  if (shopIds.length > 0) {
    const shopRows = await db.select({ id: shops.id, gpsLat: shops.gpsLat, gpsLng: shops.gpsLng, name: shops.name }).from(shops)
      .where(and(eq(shops.tenantId, tenantId), inArray(shops.id, shopIds)));
    for (const row of shopRows) shopById.set(row.id, { gpsLat: row.gpsLat, gpsLng: row.gpsLng, name: row.name });
  }

  const dupWindowEnd = new Date(periodEnd.getTime() + 24 * 60 * 60 * 1000);
  const dupRows = await db.select({
    shopId: dailyPlans.shopId, planDate: dailyPlans.planDate, count: sql<number>`count(*)`,
  }).from(dailyPlans)
    .where(and(
      eq(dailyPlans.tenantId, tenantId), eq(dailyPlans.agentId, agentId), eq(dailyPlans.status, "visited"),
      gte(dailyPlans.planDate, periodStart), lte(dailyPlans.planDate, dupWindowEnd),
    ))
    .groupBy(dailyPlans.shopId, dailyPlans.planDate);

  const visitsByShopDay = new Map<string, number>();
  for (const row of dupRows) visitsByShopDay.set(`${row.shopId}:${legacyDayKeyOf(row.planDate)}`, Number(row.count));
  const duplicateCountFor = (shopId: number | null, planDate: Date): number => {
    const day = new Date(planDate);
    const nextDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    return (visitsByShopDay.get(`${shopId}:${legacyDayKeyOf(day)}`) ?? 0)
      + (visitsByShopDay.get(`${shopId}:${legacyDayKeyOf(nextDay)}`) ?? 0);
  };

  let suspiciousVisits = 0, totalDuration = 0, totalDistance = 0, validChecks = 0;
  for (const plan of plans) {
    const dayKey = new Date(plan.planDate).toISOString().slice(0, 10);
    const dayPings = gpsCache.get(dayKey) ?? [];
    const check = await verifyVisit(db, plan.id, tenantId, dayPings, undefined, {
      plan,
      shop: plan.shopId != null ? shopById.get(plan.shopId) : undefined,
      duplicateCount: duplicateCountFor(plan.shopId, new Date(plan.planDate)),
    });
    if (check.isSuspicious) suspiciousVisits++;
    if (check.details.visitDuration > 0) { totalDuration += check.details.visitDuration; validChecks++; }
    if (check.details.distanceToShop > 0) totalDistance += check.details.distanceToShop;
  }

  const totalVisits = plans.length;
  return {
    totalVisits,
    suspiciousVisits,
    fraudRate: totalVisits > 0 ? Math.round((suspiciousVisits / totalVisits) * 100) : 0,
    avgVisitDuration: validChecks > 0 ? Math.round(totalDuration / validChecks) : 0,
    avgDistanceToShop: validChecks > 0 ? Math.round(totalDistance / validChecks) : 0,
  };
}
// ─────────────────────────────────────────────────────────────────────────────

/** База, которая считает запросы: каждый db.select(...) — один поход в MySQL. */
function counting(db: ServiceDb) {
  const count = { n: 0 };
  const proxy = new Proxy(db as object, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (key === "select") return (...args: unknown[]) => { count.n++; return (value as (...a: unknown[]) => unknown).apply(target, args); };
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: proxy as unknown as Db, count };
}

/** Воспроизводимая случайность: одинаковые данные на каждом прогоне. */
function rng(seedValue: number) {
  let a = seedValue >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AGENTS = 30;
const PERIOD_START = new Date(2026, 8, 1);             // 1 сентября, полночь по часам сервера
const PERIOD_END = new Date(2026, 8, 30, 23, 59, 59);  // 30 сентября, конец дня
const BASE = { lat: 41.3, lng: 69.24 };

describe.skipIf(!hasRealDb)("проверка визитов за период: один набор запросов, те же числа", () => {
  let db: ServiceDb;
  let s: Seeded;
  let agentIds: number[];
  let workdays: number;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });

  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    const rand = rng(20260930);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];

    // Агенты: сидовый и ещё 29.
    agentIds = [s.agentId];
    for (let i = 1; i < AGENTS; i++) {
      const [r] = await db.insert(schema.users).values({
        tenantId: s.tenantId, name: `Агент ${i}`, email: `agent${i}@test.local`, passwordHash: "x", role: "agent",
      } as never);
      agentIds.push(Number(r.insertId));
    }
    const silentAgent = agentIds[AGENTS - 1]; // ни одной точки за месяц

    // Магазины: шесть с координатами в паре километров друг от друга, два без.
    const shopRows: Array<{ id: number; lat: number | null; lng: number | null }> = [];
    for (let i = 0; i < 8; i++) {
      const lat = i < 6 ? BASE.lat + (i % 3) * 0.02 : null;
      const lng = i < 6 ? BASE.lng + Math.floor(i / 3) * 0.02 : null;
      const [r] = await db.insert(schema.shops).values({
        tenantId: s.tenantId, name: `Точка ${i}`,
        gpsLat: lat === null ? null : lat.toFixed(8), gpsLng: lng === null ? null : lng.toFixed(8),
      } as never);
      shopRows.push({ id: Number(r.insertId), lat, lng });
    }

    // Дни: весь сентябрь (визиты только в будни) плюс по дню до и после периода.
    const days: Date[] = [];
    for (let d = new Date(2026, 7, 31); d <= new Date(2026, 9, 1); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) days.push(d);
    workdays = days.filter(d => d >= PERIOD_START && d <= PERIOD_END && d.getDay() !== 0 && d.getDay() !== 6).length;

    const plans: Array<Record<string, unknown>> = [];
    const pings: Array<Record<string, unknown>> = [];
    const at = (day: Date, minutes: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes, 0);
    const jitter = (m: number) => (rand() - 0.5) * m;

    for (const agentId of agentIds) {
      for (const day of days) {
        const weekday = day.getDay() !== 0 && day.getDay() !== 6;
        if (!weekday) continue;
        const visits = 1 + Math.floor(rand() * 4);
        for (let v = 0; v < visits; v++) {
          const shop = pick(shopRows);
          const r = rand();
          const status = r < 0.75 ? "visited" : r < 0.9 ? "skipped" : "planned";
          plans.push({ tenantId: s.tenantId, agentId, shopId: shop.id, planDate: day, status, photoUrl: rand() < 0.5 ? "p.jpg" : null });
          if (agentId === silentAgent || status !== "visited" || shop.lat === null) continue;
          // Честный визит: серия точек у магазина (иногда короткая — «слишком быстро»).
          if (rand() < 0.7) {
            const startMin = 8 * 60 + Math.floor(rand() * 600);
            const n = 1 + Math.floor(rand() * 4);
            let t = startMin;
            for (let k = 0; k < n; k++) {
              pings.push({
                tenantId: s.tenantId, agentId, lat: (shop.lat + jitter(0.004)).toFixed(8), lng: (shop.lng! + jitter(0.004)).toFixed(8),
                createdAt: at(day, t), mocked: rand() < 0.03,
              });
              t += 1 + Math.floor(rand() * 8);
            }
          }
        }
        if (agentId === silentAgent) continue;
        // Точки по дороге — далеко от всех магазинов.
        const far = Math.floor(rand() * 4);
        for (let k = 0; k < far; k++) {
          pings.push({
            tenantId: s.tenantId, agentId, lat: (BASE.lat + 0.1 + rand() * 0.2).toFixed(8), lng: (BASE.lng + 0.1 + rand() * 0.2).toFixed(8),
            createdAt: at(day, Math.floor(rand() * 1440)), mocked: false,
          });
        }
        // Точка ровно в полночь: граница двух окон, попадает в оба.
        if (rand() < 0.3) {
          const shop = pick(shopRows.filter(x => x.lat !== null));
          pings.push({ tenantId: s.tenantId, agentId, lat: shop.lat!.toFixed(8), lng: shop.lng!.toFixed(8), createdAt: at(day, 0), mocked: false });
        }
      }
    }

    // Повтор: первый агент трижды в одной точке 30-го и дважды 1 октября —
    // счётчик повторов у визита последнего дня периода смотрит и в «завтра».
    for (let k = 0; k < 3; k++) plans.push({ tenantId: s.tenantId, agentId: s.agentId, shopId: shopRows[0].id, planDate: new Date(2026, 8, 30), status: "visited", photoUrl: null });
    for (let k = 0; k < 2; k++) plans.push({ tenantId: s.tenantId, agentId: s.agentId, shopId: shopRows[0].id, planDate: new Date(2026, 9, 1), status: "visited", photoUrl: null });

    // Чужая организация: визит и точки того же агента — не должны попасть никуда.
    const [otherShop] = await db.insert(schema.shops).values({ tenantId: s.otherTenantId, name: "Чужая точка", gpsLat: "40.00000000", gpsLng: "70.00000000" } as never);
    plans.push({ tenantId: s.otherTenantId, agentId: s.agentId, shopId: Number(otherShop.insertId), planDate: new Date(2026, 8, 15), status: "visited", photoUrl: null });
    for (const day of days) {
      pings.push({ tenantId: s.otherTenantId, agentId: s.agentId, lat: (BASE.lat).toFixed(8), lng: (BASE.lng).toFixed(8), createdAt: at(day, 600), mocked: true });
      pings.push({ tenantId: s.otherTenantId, agentId: s.agentId, lat: (BASE.lat).toFixed(8), lng: (BASE.lng).toFixed(8), createdAt: at(day, 700), mocked: true });
    }

    for (let i = 0; i < plans.length; i += 500) await db.insert(schema.dailyPlans).values(plans.slice(i, i + 500) as never);
    for (let i = 0; i < pings.length; i += 500) await db.insert(schema.agentLocations).values(pings.slice(i, i + 500) as never);
  }, 180_000);

  it("числа по каждому агенту — как у старого расчёта; запросов 4 вместо сотен", async () => {
    const legacyDb = counting(db);
    const legacy = new Map<number, FraudMetrics>();
    for (const id of agentIds) legacy.set(id, await legacyFraudMetrics(legacyDb.db, id, s.tenantId, PERIOD_START, PERIOD_END));

    const batchDb = counting(db);
    const batched = await calculateFraudMetricsForAgents(batchDb.db, agentIds, s.tenantId, PERIOD_START, PERIOD_END);

    for (const id of agentIds) {
      expect(batched.get(id), `агент ${id}: новый расчёт разошёлся со старым`).toEqual(legacy.get(id));
    }

    // Сверка не пустая: есть подозрительные, чистые, с длительностью и без точек.
    const all = [...legacy.values()];
    expect(all.reduce((n, m) => n + m.totalVisits, 0)).toBeGreaterThan(AGENTS * workdays);
    expect(all.reduce((n, m) => n + m.suspiciousVisits, 0)).toBeGreaterThan(0);
    expect(all.reduce((n, m) => n + (m.totalVisits - m.suspiciousVisits), 0)).toBeGreaterThan(0);
    expect(all.some(m => m.avgVisitDuration > 0)).toBe(true);
    expect(legacy.get(agentIds[AGENTS - 1])!.totalVisits).toBeGreaterThan(0);

    // 30 агентов × 22 рабочих дня: у старого — запрос на каждый агенто-день
    // с визитами плюс три на агента; у нового — четыре на всех.
    const [days] = await db.select({ n: sql<number>`count(distinct ${dailyPlans.agentId}, ${dailyPlans.planDate})` }).from(dailyPlans)
      .where(and(eq(dailyPlans.tenantId, s.tenantId), eq(dailyPlans.status, "visited"), gte(dailyPlans.planDate, PERIOD_START), lte(dailyPlans.planDate, PERIOD_END)));
    expect(workdays).toBe(22);
    expect(Number(days.n)).toBeGreaterThan(AGENTS * workdays * 0.8);
    expect(legacyDb.count.n).toBe(AGENTS * 3 + Number(days.n));
    expect(batchDb.count.n).toBe(4);
  }, 120_000);

  it("одиночный calculateFraudMetrics — те же числа, что у старого", async () => {
    for (const id of [s.agentId, agentIds[7], agentIds[AGENTS - 1]]) {
      expect(await calculateFraudMetrics(db as unknown as Db, id, s.tenantId, PERIOD_START, PERIOD_END))
        .toEqual(await legacyFraudMetrics(db as unknown as Db, id, s.tenantId, PERIOD_START, PERIOD_END));
    }
  }, 60_000);

  it("агент без визитов за период — нули, лишних запросов нет", async () => {
    const [r] = await db.insert(schema.users).values({
      tenantId: s.tenantId, name: "Новичок", email: "new@test.local", passwordHash: "x", role: "agent",
    } as never);
    const idle = Number(r.insertId);
    const c = counting(db);
    const res = await calculateFraudMetricsForAgents(c.db, [idle], s.tenantId, PERIOD_START, PERIOD_END);
    expect(res.get(idle)).toEqual({ totalVisits: 0, suspiciousVisits: 0, fraudRate: 0, avgVisitDuration: 0, avgDistanceToShop: 0 });
    expect(c.count.n).toBe(1);
    expect((await calculateFraudMetricsForAgents(c.db, [], s.tenantId, PERIOD_START, PERIOD_END)).size).toBe(0);
    expect(c.count.n).toBe(1);
  });
});
