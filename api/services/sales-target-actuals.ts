/**
 * Выполнение плана: одно число на всех, посчитанное сейчас.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Прогресс по плану считался в двух местах и по-разному.
 *
 * Агент открывает свой план (`myQuota`) — там он считается ВЖИВУЮ, запросом по
 * заказам за период. Начальник открывает тот же план у себя (`list`,
 * `summary`) — там читались колонки `actual_amount`, `actual_order_count`,
 * `actual_visit_pct`. Заполнять их было некому: единственная ручка, которая
 * это делала, не вызывалась ниоткуда, и её убрали.
 *
 * То есть у колонок стояли умолчания — нули. Агент видел «выполнено на 80%»,
 * начальник в тот же час видел ноль, и ни один экран не сообщал, что числа
 * разной свежести. Спорить об этом можно долго, а проверить нечем.
 *
 * ── Почему один запрос, а не по одному на план ──────────────────────────────
 *
 * Прежний пересчёт ходил в базу по два раза на каждый план — так можно, когда
 * его жмут руками раз в месяц. У экрана начальника планов два-три десятка, и
 * тридцать пар запросов на каждое открытие — это уже не отчёт, а нагрузка.
 *
 * Поэтому границы периода берутся из самой строки плана прямо в соединении:
 * MySQL считает все планы разом, каждый по своим датам и своему магазину.
 *
 * ── Ответ прежней формы ─────────────────────────────────────────────────────
 *
 * Наружу уходят те же поля `actualAmount` / `actualOrderCount` /
 * `actualVisitPct`, только заполненные посчитанным. Мобильное приложение
 * читает их по именам, и менять там нечего.
 */
import { sql } from "drizzle-orm";
import { REVENUE_ORDER_STATUSES } from "../lib/order-status";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

export interface TargetActuals {
  /** Выручка агента за период плана. */
  revenue: number;
  /** Сколько заказов эту выручку дали. */
  orderCount: number;
  /** Доля состоявшихся визитов из запланированных, в процентах. */
  visitPct: number;
}

const EMPTY: TargetActuals = { revenue: 0, orderCount: 0, visitPct: 0 };

/** Развернуть ответ db.execute в строки — так же, как в services/receivables. */
function rowsOf(raw: unknown): Record<string, unknown>[] {
  const list = Array.isArray(raw) ? raw[0] : raw;
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
}

/**
 * Посчитать выполнение для перечисленных планов.
 *
 * Планов может не быть вовсе — тогда запросов не будет тоже: `IN ()` в MySQL
 * это синтаксическая ошибка, а не пустой результат.
 */
export async function actualsForTargets(
  db: Db, tenantId: number, targetIds: number[],
): Promise<Map<number, TargetActuals>> {
  const out = new Map<number, TargetActuals>();
  if (targetIds.length === 0) return out;

  const ids = sql.join(targetIds.map(id => sql`${id}`), sql`, `);
  const revenueStatuses = sql.join(REVENUE_ORDER_STATUSES.map(s => sql`${s}`), sql`, `);

  /*
    Условия отбора заказов — те же, что в revenueOrderConditions: организация,
    выручковые статусы и — обязательно — отсечение удалённых. Удаление штатно
    исправляет ошибку ввода, и заказ на девять миллионов, стёртый оператором,
    не должен оставаться в выполнении плана агента.

    Верхняя граница периода — начало следующего дня, а не сам period_end:
    period_end это DATE, то есть полночь, и заказы последнего дня плана иначе
    выпадают целиком.

    shop_id у плана может быть пуст — тогда план на всю работу агента, и
    условие по магазину не сужает ничего.
  */
  const money = rowsOf(await db.execute(sql`
    SELECT
      t.id AS targetId,
      COALESCE(SUM(CAST(o.total AS DECIMAL(15,2))), 0) AS revenue,
      COUNT(o.id) AS orderCount
    FROM sales_targets t
    LEFT JOIN orders o
      ON  o.tenant_id  = t.tenant_id
      AND o.agent_id   = t.user_id
      AND o.deleted_at IS NULL
      AND o.status IN (${revenueStatuses})
      AND o.created_at >= t.period_start
      AND o.created_at <  DATE_ADD(t.period_end, INTERVAL 1 DAY)
      AND (t.shop_id IS NULL OR o.shop_id = t.shop_id)
    WHERE t.tenant_id = ${tenantId} AND t.id IN (${ids})
    GROUP BY t.id
  `));

  const visits = rowsOf(await db.execute(sql`
    SELECT
      t.id AS targetId,
      COUNT(dp.id) AS planned,
      COALESCE(SUM(CASE WHEN dp.status = 'visited' THEN 1 ELSE 0 END), 0) AS visited
    FROM sales_targets t
    LEFT JOIN daily_plans dp
      ON  dp.tenant_id = t.tenant_id
      AND dp.agent_id  = t.user_id
      AND dp.plan_date >= t.period_start
      AND dp.plan_date <= t.period_end
    WHERE t.tenant_id = ${tenantId} AND t.id IN (${ids})
    GROUP BY t.id
  `));

  for (const id of targetIds) out.set(id, { ...EMPTY });

  for (const row of money) {
    const entry = out.get(Number(row.targetId));
    if (!entry) continue;
    entry.revenue = Number(row.revenue ?? 0);
    entry.orderCount = Number(row.orderCount ?? 0);
  }

  for (const row of visits) {
    const entry = out.get(Number(row.targetId));
    if (!entry) continue;
    const planned = Number(row.planned ?? 0);
    // Без запланированных визитов доли не существует. Ноль здесь читался бы
    // как «ни одного не сделал», хотя делать было нечего.
    entry.visitPct = planned > 0 ? (Number(row.visited ?? 0) / planned) * 100 : 0;
  }

  return out;
}
