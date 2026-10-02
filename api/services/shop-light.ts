/* ═══════════════════════════════════════════════════════════════════════════
   Светофор магазина: факты на сервере, решение — contracts/shop-light.ts.

   Карточке нужен один магазин, списку — сотни. Расчёт один и пакетный:
   запросов всегда одно и то же число (их держит тест), сколько бы магазинов
   ни спросили. Цикл «по запросу на магазин» на списке из трёх тысяч точек —
   три тысячи запросов на каждое открытие экрана каждым агентом.

   Откуда каждое число — и почему не из другого места:

     • долг — shops.debt, выведенный recalcShopDebt по правилу «по заказу»
       (services/shop-debt.ts);
     • просрочка — services/overdue-hold.ts → overdueByShops: то же правило,
       что держит заказ («стоп отгрузки»), второго здесь нет;
     • средний чек — выручка за период по правилам отчётов: доставленные
       заказы по created_at (revenuePeriodConditions) минус возвраты,
       проведённые в том же периоде (services/revenue-returns.ts). Долг и
       выручка считаются разными правилами нарочно — у долга нет периода, у
       выручки нет отдельного заказа;
     • ритм — дни с заказом (любой неудалённый, кроме отменённого) в окне от
       последнего заказа назад;
     • последняя причина «без заказа» — services/no-order-visits.ts.
   ═══════════════════════════════════════════════════════════════════════════ */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { format, subDays } from "date-fns";
import { orders, shops } from "@db/schema";
import { lightOf, SHOP_LIGHT_RULES, type ShopLight } from "@contracts/shop-light";
import { overdueByShops } from "./overdue-hold";
import { returnsInPeriod, groupReturned } from "./revenue-returns";
import { revenuePeriodConditions } from "../lib/order-status";
import { lastNoOrderByShop } from "./no-order-visits";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  const rows = Array.isArray(result) ? result[0] : result;
  return Array.isArray(rows) ? rows as Array<Record<string, unknown>> : [];
}

/**
 * Какие из спрошенных магазинов — «свои» для полевого сотрудника.
 *
 * Свой — закреплённый за ним, ничей (закрепление у многих организаций не
 * ведут, и агент обслуживает общие точки — см. agent.myShops) или стоящий у
 * него в плане визитов. Закреплённый за ДРУГИМ агентом и не стоящий у него в
 * плане — чужой: его долг, средний чек и причины отказов — не его дело.
 * Один запрос на любой список.
 */
export async function ownShopIds(db: Db, tenantId: number, userId: number, shopIds: number[]): Promise<number[]> {
  if (shopIds.length === 0) return [];
  const rows = await db.select({ id: shops.id }).from(shops).where(and(
    eq(shops.tenantId, tenantId),
    inArray(shops.id, shopIds),
    or(
      eq(shops.agentId, userId),
      isNull(shops.agentId),
      sql`EXISTS (SELECT 1 FROM daily_plans dp WHERE dp.tenant_id = ${tenantId} AND dp.shop_id = \`shops\`.\`id\` AND dp.agent_id = ${userId})`,
    ),
  ));
  return rows.map(r => Number(r.id));
}

/** Светофор по каждому найденному магазину организации. Чужих и несуществующих в ответе нет. */
export async function shopLights(db: Db, tenantId: number, shopIds: number[]): Promise<Map<number, ShopLight>> {
  const out = new Map<number, ShopLight>();
  const ids = [...new Set(shopIds)];
  if (ids.length === 0) return out;

  const base = await db.select({ id: shops.id, debt: shops.debt, creditLimit: shops.creditLimit })
    .from(shops).where(and(eq(shops.tenantId, tenantId), inArray(shops.id, ids)));
  if (base.length === 0) return out;
  const found = base.map(b => Number(b.id));

  const to = format(new Date(), "yyyy-MM-dd");
  const from = format(subDays(new Date(), SHOP_LIGHT_RULES.AVG_CHECK_DAYS), "yyyy-MM-dd");

  const [overdue, rhythmRes, revenue, returned, lastNoOrder] = await Promise.all([
    overdueByShops(db, tenantId, found),
    /*
      Ритм: дни с заказом в окне RHYTHM_WINDOW_DAYS до последнего заказа.
      Несколько заказов в один день — один день: три заказа утром не
      «привычка», а один визит, и средний интервал вышел бы нулём.
    */
    db.execute(sql`
      SELECT o.shop_id AS shopId,
             DATEDIFF(CURDATE(), l.last_day) AS daysSince,
             COUNT(DISTINCT DATE(o.created_at)) AS orderDays,
             DATEDIFF(l.last_day, MIN(DATE(o.created_at))) AS spanDays
      FROM orders o
      JOIN (
        SELECT lo.shop_id, MAX(DATE(lo.created_at)) AS last_day
        FROM orders lo
        WHERE lo.tenant_id = ${tenantId}
          AND lo.shop_id IN (${sql.join(found.map(id => sql`${id}`), sql`, `)})
          AND lo.deleted_at IS NULL AND lo.status <> 'cancelled'
        GROUP BY lo.shop_id
      ) l ON l.shop_id = o.shop_id
      WHERE o.tenant_id = ${tenantId}
        AND o.shop_id IN (${sql.join(found.map(id => sql`${id}`), sql`, `)})
        AND o.deleted_at IS NULL AND o.status <> 'cancelled'
        AND DATE(o.created_at) >= DATE_SUB(l.last_day, INTERVAL ${SHOP_LIGHT_RULES.RHYTHM_WINDOW_DAYS} DAY)
      GROUP BY o.shop_id, l.last_day
    `),
    db.select({
      shopId: orders.shopId,
      sum: sql<string>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL(15,2))), 0)`,
      n: sql<number>`COUNT(*)`,
    }).from(orders)
      .where(and(...revenuePeriodConditions(tenantId, from, to), inArray(orders.shopId, found)))
      .groupBy(orders.shopId),
    returnsInPeriod(db, tenantId, from, to, { shopIds: found }),
    lastNoOrderByShop(db, tenantId, found),
  ]);

  const rhythm = new Map<number, { daysSince: number; orderDays: number; spanDays: number }>();
  for (const r of rowsOf(rhythmRes)) {
    rhythm.set(Number(r.shopId), { daysSince: Number(r.daysSince), orderDays: Number(r.orderDays), spanDays: Number(r.spanDays) });
  }
  const sales = new Map(revenue.map(r => [Number(r.shopId), { sum: Number(r.sum) || 0, n: Number(r.n) || 0 }]));
  const back = groupReturned(returned, r => String(r.shopId));

  for (const b of base) {
    const id = Number(b.id);
    const debt = Math.round(Number(b.debt) || 0);
    const creditLimit = b.creditLimit == null ? null : Math.round(Number(b.creditLimit));
    const o = overdue.byShop.get(id) ?? { amount: 0, oldestDays: 0, graceDays: 0 };
    const rh = rhythm.get(id);
    const usual = rh && rh.orderDays >= SHOP_LIGHT_RULES.RHYTHM_MIN_ORDER_DAYS ? rh.spanDays / (rh.orderDays - 1) : null;
    const sale = sales.get(id);
    const net = sale ? sale.sum - (back.get(String(id))?.amount ?? 0) : 0;
    const decision = lightOf({
      debt, overdue: o, creditLimit,
      daysSinceOrder: rh ? rh.daysSince : null,
      usualIntervalDays: usual,
    });
    out.set(id, {
      shopId: id,
      color: decision.color,
      reasons: decision.reasons,
      debt,
      overdue: o.amount,
      oldestOverdueDays: o.oldestDays,
      graceDays: o.graceDays,
      holdsOrders: overdue.holdsOrders,
      creditLimit,
      avgCheck: sale && sale.n > 0 ? Math.round(Math.max(0, net) / sale.n) : null,
      avgCheckOrders: sale?.n ?? 0,
      daysSinceOrder: rh ? rh.daysSince : null,
      usualIntervalDays: usual == null ? null : Math.max(1, Math.round(usual)),
      lastNoOrder: lastNoOrder.get(id) ?? null,
    });
  }
  return out;
}
