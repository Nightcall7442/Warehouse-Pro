/**
 * Выручка и себестоимость периода — верх P&L до расходов.
 *
 * ── Почему отдельно ─────────────────────────────────────────────────────────
 *
 * Жили внутри analytics.pnl. Отчёт «Прибыль» (services/margin-report.ts)
 * раскладывает ту же валовую прибыль по товарам, магазинам и агентам и обязан
 * с ней сходиться — а сверять разложение с ДРУГИМ, похожим запросом значит
 * сверять с копией. Копии в этом проекте расходились уже трижды: фильтр
 * удалённых заказов, возвраты, отбор статусов. Поэтому один расчёт на оба
 * экрана, а сверка — с ним.
 *
 * Правила не менялись: выручка — сумма доставленных неудалённых заказов
 * периода (после скидки), себестоимость — слепок строк на доставленное
 * количество, обе за вычетом возвратов, проведённых в периоде.
 */
import { and, eq, sql } from "drizzle-orm";
import { orders, orderItems, products } from "@db/schema";
import { revenueOrderConditions, revenuePeriodConditions, deliveredQty } from "../lib/order-status";
import { returnsInPeriod, totalReturned, type ReturnRow, type ReturnedValue } from "./revenue-returns";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

export interface PeriodGross {
  /** Выручка за вычетом проведённых возвратов. */
  revenue: number;
  /** Скидка заказов периода — справочно: в revenue она уже учтена. */
  discount: number;
  orderCount: number;
  /** Себестоимость за вычетом себестоимости вернувшегося. */
  cogs: number;
  returned: ReturnedValue;
  /** Строки возвратов — вызывающему, чтобы не читать их второй раз. */
  returnRows: ReturnRow[];
}

export async function periodGross(
  db: Db, tenantId: number, from: string, to: string,
  /** Уже прочитанные возвраты этого периода — чтобы не ходить за ними дважды. */
  preloadedReturns?: ReturnRow[],
): Promise<PeriodGross> {
  const revRowP = db.select({
    totalRevenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
    totalDiscount: sql<string>`COALESCE(SUM(${orders.discount}), 0)`,
    orderCount: sql<number>`count(*)`,
  })
    .from(orders)
    .where(and(...revenuePeriodConditions(tenantId, from, to)));

  // Себестоимость — по ТОМУ ЖЕ набору заказов, что и выручка: общий помощник,
  // а не условия, выписанные руками (из таких наборов однажды выпал фильтр
  // удалённых заказов, и COGS удалённого заказа оставался в прибыли).
  const cogsRowP = db.select({
    totalCOGS: sql<string>`COALESCE(SUM(${deliveredQty()} * ${orderItems.costPrice}), 0)`,
  })
    .from(orderItems)
    .leftJoin(products, and(eq(orderItems.productId, products.id), eq(products.tenantId, tenantId)))
    .leftJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(
      ...revenueOrderConditions(tenantId),
      sql`${orders.createdAt} >= ${from}`,
      sql`${orders.createdAt} <= ${to + " 23:59:59"}`,
    ));

  const [revRow, cogsRow, returnRows] = await Promise.all([
    revRowP, cogsRowP, preloadedReturns ? Promise.resolve(preloadedReturns) : returnsInPeriod(db, tenantId, from, to),
  ]);
  const returned = totalReturned(returnRows);
  return {
    revenue: Number(revRow[0]?.totalRevenue ?? 0) - returned.amount,
    discount: Number(revRow[0]?.totalDiscount ?? 0),
    orderCount: Number(revRow[0]?.orderCount ?? 0),
    cogs: Number(cogsRow[0]?.totalCOGS ?? 0) - returned.cost,
    returned,
    returnRows,
  };
}
