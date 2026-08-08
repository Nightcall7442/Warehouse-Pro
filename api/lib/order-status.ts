import { eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { orders, orderItems } from "@db/schema";

/**
 * The order lifecycle, named once.
 *
 * `orders.status` is a MySQL enum:
 *   new · processing · shipped · pending · delivered · cancelled · returned
 *
 * Forty-four query sites used to hard-code `["delivered", "completed"]` as
 * "the sale happened". `completed` has never been a member of that enum — no
 * row in production has ever carried it — so every one of those filters was
 * comparing an enum column against a value it could not hold. MySQL silently
 * matches nothing rather than erroring, which is why it survived: the queries
 * returned the right rows via `delivered` alone while the type-checker reported
 * two dozen errors about it.
 *
 * Naming the sets here keeps a rename of the lifecycle to one edit, and lets
 * `order-status-invariant.test.ts` fail if a literal status list reappears.
 */

/** Still moving through the pipeline — nothing final has happened to the goods. */
export const OPEN_ORDER_STATUSES = ["new", "processing", "shipped", "pending"] as const;

/** Goods are no longer in play, whatever the outcome. */
export const CLOSED_ORDER_STATUSES = ["delivered", "cancelled", "returned"] as const;

/**
 * The sale actually happened: goods handed over, money owed or paid.
 * This is the set every revenue, KPI, commission and forecast query wants.
 */
export const REVENUE_ORDER_STATUSES = ["delivered"] as const;

export type OrderStatus =
  | (typeof OPEN_ORDER_STATUSES)[number]
  | (typeof CLOSED_ORDER_STATUSES)[number];

/** Goods are still reserved against the warehouse. */
export function holdsStock(status: string): boolean {
  return (OPEN_ORDER_STATUSES as readonly string[]).includes(status);
}

/** Goods have left the warehouse for good. */
export function deductsStock(status: string): boolean {
  return (REVENUE_ORDER_STATUSES as readonly string[]).includes(status);
}

/**
 * «Этот заказ считается выручкой» — одним выражением, чтобы условие нельзя было
 * забыть по частям.
 *
 * Забывали именно так: OrderService.delete помечает заказ deletedAt, снимает
 * резерв и пересчитывает долг магазина — то есть по всем признакам заказа
 * больше нет. Но isNull(orders.deletedAt) не встречалось НИ РАЗУ в семи файлах
 * отчётности (analytics, reports, sales-target, kpi-router, forecast,
 * warehouse-reports, quota-suggest), хотя dashboard-router фильтрует его в
 * одиннадцати местах. Оператор удалял ошибочный заказ на 9 000 000 — заказ
 * исчезал из списка, из дашборда и из долга магазина, и НАВСЕГДА оставался в
 * P&L, в продажах по магазинам, в прогрессе квоты агента и в прогнозе спроса.
 * Две цифры выручки в продукте расходились, и ни один экран не объяснял почему.
 *
 * Удаление — это штатный способ исправить ошибку ввода, поэтому промах бил
 * ровно по тем заказам, которые считать и не следовало.
 *
 * Возвращает массив условий, который дописывается фильтрами вызывающего:
 *   const conditions = [...revenueOrderConditions(ctx.tenant.id)];
 *   if (input?.agentId) conditions.push(eq(orders.agentId, input.agentId));
 *
 * Для запросов, которым нужны заказы ЛЮБОГО статуса (например, воронка по
 * статусам), есть liveOrderConditions — та же защита от удалённых, без фильтра
 * статуса.
 */
export function revenueOrderConditions(tenantId: number): SQL[] {
  return [
    eq(orders.tenantId, tenantId),
    inArray(orders.status, [...REVENUE_ORDER_STATUSES]),
    isNull(orders.deletedAt),
  ];
}

/**
 * Выручка арендатора за период — набор условий целиком.
 *
 * Отдельный помощник, потому что «за период» переписывалось руками в шести
 * местах, и в четырёх из них потерялся фильтр удалённых заказов. Итог был
 * виден на одном экране: карточка прибыли считала по удалённым, а месячный
 * график под ней — нет, и две цифры на одной странице расходились.
 *
 * Верхняя граница расширяется до конца дня. Даты приходят в виде «2026-08-09»,
 * то есть полночь; без этого заказ, оформленный в тот же день после полуночи,
 * не попадал бы в период, который человек считает включающим сегодня.
 */
export function revenuePeriodConditions(tenantId: number, from: string, to: string): SQL[] {
  return [
    ...revenueOrderConditions(tenantId),
    sql`${orders.createdAt} >= ${from}`,
    sql`${orders.createdAt} <= ${to + " 23:59:59"}`,
  ];
}

/**
 * Сколько единиц товара по строке заказа реально ушло магазину.
 *
 * `orderItems.quantity` — сколько ЗАКАЗАЛИ, и оно не меняется при частичной
 * доставке. Доставленное лежит в `deliveredQuantity` и заполняется только
 * тогда, когда часть товара вернулась; у обычного заказа там NULL, и тогда
 * доставлено ровно заказанное.
 *
 * Из-за этого себестоимость считалась по заказанному, а выручка — по
 * доставленному: при частичной доставке валовая прибыль показывалась нулевой
 * или отрицательной на совершенно нормальной сделке.
 *
 * Функция, а не константа: объект SQL от drizzle нельзя переиспользовать между
 * запросами — он несёт связанные параметры.
 */
export function deliveredQty() {
  return sql`COALESCE(${orderItems.deliveredQuantity}, ${orderItems.quantity})`;
}

/** Заказы арендатора без учёта статуса, но по-прежнему без удалённых. */
export function liveOrderConditions(tenantId: number): SQL[] {
  return [
    eq(orders.tenantId, tenantId),
    isNull(orders.deletedAt),
  ];
}
