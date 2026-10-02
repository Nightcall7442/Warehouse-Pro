/* ═══════════════════════════════════════════════════════════════════════════
   «Карта продаж»: факты по каждому магазину для contracts/sales-map.ts.

   Здесь только чтение базы — решения (состояние магазина, район, «ехать или
   нет») принимает договор, чистыми функциями, и их держат тесты.

   ── Откуда каждое число ─────────────────────────────────────────────────────

     • выручка магазина за период и за такой же период до него — доставленные
       заказы по created_at (revenuePeriodConditions) минус возвраты,
       проведённые в том же промежутке (services/revenue-returns.ts). Тот же
       расчёт, что у выручки P&L, поэтому сумма по магазинам с ней сходится;
       магазины в архиве идут отдельной строкой, а не теряются;
     • «заказывал / перестал» — любые неудалённые заказы, кроме отменённых
       (то же правило, что у ритма светофора): заказ, который ещё везут,
       значит, что магазин не молчит;
     • светофор и последняя причина «без заказа» — services/shop-light.ts,
       одним пакетным расчётом и только у замолчавших: долг считается своим
       правилом (shop-debt.ts), и сюда он попадает только цветом и словами.

   ── Сколько запросов ────────────────────────────────────────────────────────

   Шесть чтений разом и светофор после них — число не зависит от того,
   сколько у организации магазинов. Результат кэшируется на пять минут по
   периоду (reports.salesMap); фильтры по агенту и территории накладываются
   на готовое, не пересчитывая базу.
   ═══════════════════════════════════════════════════════════════════════════ */
import { and, eq, sql } from "drizzle-orm";
import { agentTerritories, orders, shops, territories, users } from "@db/schema";
import { revenuePeriodConditions } from "../lib/order-status";
import { returnsInPeriod, groupReturned } from "./revenue-returns";
import { shopLights } from "./shop-light";
import {
  previousPeriod, shopStateOf, SALES_MAP_RULES,
  type SalesMapBase, type SalesShopFacts,
} from "@contracts/sales-map";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  const rows = Array.isArray(result) ? result[0] : result;
  return Array.isArray(rows) ? rows as Array<Record<string, unknown>> : [];
}

/** Координата из справочника: пусто, мусор и «0, 0» (так их «стирали») — координат нет. */
function coord(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (lat == null || lng == null || lat === "" || lng === "") return null;
  const a = Number(lat), b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  if (a === 0 && b === 0) return null;
  return { lat: a, lng: b };
}

export async function salesMapBase(db: Db, tenantId: number, from: string, to: string): Promise<SalesMapBase> {
  const { prevFrom, prevTo, lookbackFrom } = previousPeriod(from, to);

  const [shopRows, zoneRows, revenueRows, returnedNow, returnedBefore, activityRes] = await Promise.all([
    db.select({
      id: shops.id, name: shops.name, city: shops.city, district: shops.district,
      territoryId: shops.territoryId, territoryName: territories.name,
      agentId: shops.agentId, agentName: users.name,
      lat: shops.gpsLat, lng: shops.gpsLng,
    })
      .from(shops)
      .leftJoin(territories, and(eq(territories.id, shops.territoryId), eq(territories.tenantId, tenantId)))
      // Уволенный агент закреплённым не считается: имя пустое — «агента нет».
      .leftJoin(users, and(eq(users.id, shops.agentId), eq(users.tenantId, tenantId), eq(users.status, "active")))
      .where(and(eq(shops.tenantId, tenantId), eq(shops.status, "active"))),

    db.select({ territoryId: agentTerritories.territoryId, agentId: agentTerritories.agentId, agentName: users.name })
      .from(agentTerritories)
      .innerJoin(users, and(eq(users.id, agentTerritories.agentId), eq(users.tenantId, tenantId), eq(users.status, "active")))
      .where(eq(agentTerritories.tenantId, tenantId)),

    // Оба периода одним проходом: тот же набор условий, что у выручки P&L,
    // от начала прошлого периода до конца текущего, и деление по дате.
    db.select({
      shopId: orders.shopId,
      now: sql<string>`COALESCE(SUM(CASE WHEN ${orders.createdAt} >= ${from} THEN ${orders.total} ELSE 0 END), 0)`,
      before: sql<string>`COALESCE(SUM(CASE WHEN ${orders.createdAt} < ${from} THEN ${orders.total} ELSE 0 END), 0)`,
    })
      .from(orders)
      .where(and(...revenuePeriodConditions(tenantId, prevFrom, to)))
      .groupBy(orders.shopId),

    returnsInPeriod(db, tenantId, from, to),
    returnsInPeriod(db, tenantId, prevFrom, prevTo),

    db.execute(sql`
      SELECT o.shop_id AS shopId,
             SUM(o.created_at >= ${from}) AS inPeriod,
             SUM(o.created_at < ${from}) AS beforePeriod,
             DATE_FORMAT(MAX(o.created_at), '%Y-%m-%d') AS lastDay
      FROM orders o
      WHERE o.tenant_id = ${tenantId}
        AND o.deleted_at IS NULL AND o.status <> 'cancelled'
        AND o.created_at >= ${lookbackFrom} AND o.created_at <= ${to + " 23:59:59"}
      GROUP BY o.shop_id
    `),
  ]);

  const backNow = groupReturned(returnedNow, r => String(r.shopId));
  const backBefore = groupReturned(returnedBefore, r => String(r.shopId));
  const revenue = new Map<number, { now: number; before: number }>();
  for (const r of revenueRows) revenue.set(Number(r.shopId), { now: Number(r.now) || 0, before: Number(r.before) || 0 });
  // Магазин, у которого в промежутке только возврат, — тоже деньги промежутка.
  for (const id of [...backNow.keys(), ...backBefore.keys()]) {
    if (!revenue.has(Number(id))) revenue.set(Number(id), { now: 0, before: 0 });
  }
  const activity = new Map<number, { inPeriod: number; before: number; lastDay: string | null }>();
  for (const r of rowsOf(activityRes)) {
    activity.set(Number(r.shopId), { inPeriod: Number(r.inPeriod) || 0, before: Number(r.beforePeriod) || 0, lastDay: r.lastDay == null ? null : String(r.lastDay) });
  }

  const netOf = (id: number) => {
    const r = revenue.get(id);
    return {
      now: (r?.now ?? 0) - (backNow.get(String(id))?.amount ?? 0),
      before: (r?.before ?? 0) - (backBefore.get(String(id))?.amount ?? 0),
    };
  };

  const facts: SalesShopFacts[] = shopRows.map(s => {
    const id = Number(s.id);
    const net = netOf(id);
    const act = activity.get(id);
    const at = coord(s.lat, s.lng);
    return {
      id, name: s.name,
      city: s.city ?? null, district: s.district ?? null,
      territoryId: s.territoryId == null ? null : Number(s.territoryId),
      territoryName: s.territoryName ?? null,
      agentId: s.agentId == null ? null : Number(s.agentId),
      agentName: s.agentName ?? null,
      lat: at?.lat ?? null, lng: at?.lng ?? null,
      revenue: net.now, prevRevenue: net.before,
      ordersInPeriod: act?.inPeriod ?? 0, ordersBefore: act?.before ?? 0, lastOrderDay: act?.lastDay ?? null,
    };
  });

  // Деньги магазинов в архиве — отдельной строкой, чтобы итог сходился с P&L.
  const active = new Set(facts.map(f => f.id));
  const outside = { revenue: 0, prevRevenue: 0 };
  for (const id of revenue.keys()) {
    if (active.has(id)) continue;
    const net = netOf(id);
    outside.revenue += net.now;
    outside.prevRevenue += net.before;
  }

  // Светофор — только замолчавшим, самым денежным первыми; расчёт пакетный.
  const silent = facts.filter(f => shopStateOf(f) === "silent")
    .sort((x, y) => y.prevRevenue - x.prevRevenue || x.id - y.id)
    .slice(0, SALES_MAP_RULES.SILENT_LIGHTS_MAX);
  if (silent.length > 0) {
    const lights = await shopLights(db, tenantId, silent.map(f => f.id));
    for (const f of silent) {
      const l = lights.get(f.id);
      if (!l) continue;
      f.light = { color: l.color, reasons: l.reasons, daysSinceOrder: l.daysSinceOrder };
      f.lastNoOrder = l.lastNoOrder;
    }
  }

  return {
    from, to, prevFrom, prevTo,
    shops: facts,
    zones: zoneRows.map(z => ({ territoryId: Number(z.territoryId), agentId: Number(z.agentId), agentName: z.agentName ?? `#${z.agentId}` })),
    outside,
  };
}
