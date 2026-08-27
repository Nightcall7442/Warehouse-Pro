import { sql } from "drizzle-orm";
import type { getDb } from "../queries/connection";

type Db = ReturnType<typeof getDb>;

/**
 * Что магазин принёс за всю историю и как он платит.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Два вопроса, на которые в системе не было ответа. Первый — «сколько этот
 * магазин нам вообще принёс»: выручка считалась только за период, и отличить
 * точку, которая работает с нами три года, от новой было нечем. Второй — «как
 * он платит»: долг видно текущий, а поведение — берёт ли всё время в долг и
 * как долго не рассчитывается — нет.
 *
 * Оба вопроса задаются про один и тот же список магазинов, поэтому считаются
 * одним запросом.
 *
 * ── Что считается выручкой ──────────────────────────────────────────────────
 *
 * То же, что и везде в отчётах: доставленные и завершённые заказы, без
 * удалённых и отменённых, минус проведённые возвраты. Иначе цифра на карте
 * разошлась бы с цифрой в P&L, и доверия к обеим не осталось бы.
 */

/** Сколько дней открытого долга уже считается «долго не рассчитывается». */
const SLOW_PAYER_DAYS = 30;

/** Сколько дней терпимо, если магазин почти всё берёт в долг. */
const SLOW_PAYER_DAYS_HABITUAL = 14;

/** Доля заказов в долг, начиная с которой это уже привычка, а не случай. */
const HABITUAL_DEBT_SHARE = 0.7;

/**
 * Меньше этого числа заказов — о ПРИВЫЧКЕ брать в долг говорить рано.
 *
 * Только о привычке. Сам долг судится с первого заказа: магазин, который
 * держит наши деньги третий месяц, красный и с одной покупкой.
 *
 * Проверено на живых данных: у организации с 983 заказами на 719 точек почти
 * у всех магазинов один-два заказа. Порог «трёх заказов на любой приговор»
 * красил 446 точек из 500 в серый, и карта не показывала ничего.
 */
const MIN_ORDERS_FOR_HABIT = 3;

export type ShopTier = "green" | "yellow" | "red" | "new";

export type ShopScore = {
  shopId: number;
  name: string;
  lat: number | null;
  lng: number | null;
  /** Выручка за всю историю, минус возвраты. */
  ltv: number;
  /** Текущий долг — та же цифра, что в карточке магазина. */
  debt: number;
  orderCount: number;
  /** Доля заказов, оформленных в долг, 0…1. */
  debtShare: number;
  /** Возраст самого старого неоплаченного заказа в днях; 0 — открытых нет. */
  oldestUnpaidDays: number;
  lastOrderAt: string | null;
  tier: ShopTier;
  /** Человеческое объяснение цвета — его показывают в подсказке на карте. */
  reason: string;
};

/**
 * Цвет магазина.
 *
 * Правило намеренно простое и объяснимое вслух: им пользуется супервайзер,
 * глядя на карту, и оно должно совпадать с тем, что он и так знает про свои
 * точки. Заумная формула, которую нельзя пересказать, доверия не получит.
 *
 *   красный — держит наши деньги: есть открытый долг, и самому старому
 *             неоплаченному заказу больше месяца. Либо магазин берёт в долг
 *             почти всё и не рассчитывается уже две недели.
 *   зелёный — открытых долгов нет вовсе, и он не новичок.
 *   жёлтый  — всё остальное: долг есть, но свежий; или берёт в долг, но платит.
 *   серый   — заказов слишком мало, чтобы судить.
 */
export function classify(s: {
  debt: number;
  orderCount: number;
  debtShare: number;
  oldestUnpaidDays: number;
}): { tier: ShopTier; reason: string } {
  // Серый — только когда сказать действительно нечего.
  if (s.orderCount === 0) {
    return { tier: "new", reason: "Заказов ещё не было" };
  }

  // Привычка — это про повторяемость, поэтому доля считается только при
  // нескольких заказах. Долг же судится с первого.
  const habitual = s.orderCount >= MIN_ORDERS_FOR_HABIT && s.debtShare >= HABITUAL_DEBT_SHARE;

  if (s.debt > 0 && s.oldestUnpaidDays >= SLOW_PAYER_DAYS) {
    return {
      tier: "red",
      reason: `Долг ${fmt(s.debt)}, самый старый неоплаченный заказ — ${s.oldestUnpaidDays} дн. назад`,
    };
  }
  if (habitual && s.debt > 0 && s.oldestUnpaidDays >= SLOW_PAYER_DAYS_HABITUAL) {
    return {
      tier: "red",
      reason: `Почти всё берёт в долг (${pct(s.debtShare)}) и не рассчитывается ${s.oldestUnpaidDays} дн.`,
    };
  }
  if (s.debt === 0) {
    return {
      tier: "green",
      reason: habitual
        ? `Берёт в долг (${pct(s.debtShare)}), но рассчитывается полностью`
        : "Открытых долгов нет",
    };
  }
  return {
    tier: "yellow",
    reason: `Долг ${fmt(s.debt)}, самому старому заказу ${s.oldestUnpaidDays} дн.`,
  };
}

function fmt(v: number): string {
  return `${Math.round(v).toLocaleString("ru")} сум`;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/**
 * Один запрос на всю организацию.
 *
 * По магазину идут три независимых агрегата, поэтому они считаются
 * подзапросами, а не тремя JOIN-ами подряд: JOIN заказов с платежами и
 * возвратами размножил бы строки и сумма выручки выросла бы кратно числу
 * платежей — ровно та ошибка, которую в этом проекте уже ловили в отчётах.
 *
 * Ограничение по числу магазинов обязательно: справочник на три тысячи точек
 * без него превращает карту в мегабайты JSON на мобильном канале.
 */
export async function shopScores(db: Db, tenantId: number, limit = 500): Promise<ShopScore[]> {
  const rows = await db.execute(sql`
    SELECT
      s.id                                          AS shop_id,
      s.name                                        AS name,
      s.gps_lat                                     AS lat,
      s.gps_lng                                     AS lng,
      CAST(s.debt AS DECIMAL(15,2))                 AS debt,
      COALESCE(o.revenue, 0)                        AS revenue,
      COALESCE(r.returned, 0)                       AS returned,
      COALESCE(o.order_count, 0)                    AS order_count,
      COALESCE(o.debt_orders, 0)                    AS debt_orders,
      COALESCE(u.oldest_unpaid_days, 0)             AS oldest_unpaid_days,
      o.last_order_at                               AS last_order_at
    FROM shops s
    LEFT JOIN (
      SELECT
        o.shop_id,
        SUM(CASE WHEN o.status IN ('delivered', 'completed')
                 THEN CAST(o.total AS DECIMAL(15,2)) ELSE 0 END) AS revenue,
        COUNT(*)                                                  AS order_count,
        SUM(CASE WHEN o.payment_method = 'debt' THEN 1 ELSE 0 END) AS debt_orders,
        MAX(o.created_at)                                          AS last_order_at
      FROM orders o
      WHERE o.tenant_id = ${tenantId} AND o.deleted_at IS NULL
      GROUP BY o.shop_id
    ) o ON o.shop_id = s.id
    LEFT JOIN (
      SELECT r.shop_id, SUM(CAST(r.total_amount AS DECIMAL(15,2))) AS returned
      FROM returns r
      WHERE r.tenant_id = ${tenantId} AND r.status = 'completed'
      GROUP BY r.shop_id
    ) r ON r.shop_id = s.id
    LEFT JOIN (
      -- Возраст самого старого заказа, по которому ещё что-то не заплачено.
      -- Именно возраст заказа, а не срок из debt_due_date: срок проставляется
      -- только на пути частичной оплаты и у большинства долгов пуст, а
      -- «сколько магазин держит наши деньги» надо знать по всем.
      SELECT o.shop_id, MAX(DATEDIFF(NOW(), o.created_at)) AS oldest_unpaid_days
      FROM orders o
      WHERE o.tenant_id = ${tenantId}
        AND o.deleted_at IS NULL
        AND o.status NOT IN ('cancelled', 'returned')
        AND (o.payment_method = 'debt' OR o.status = 'delivered')
        AND CAST(o.total AS DECIMAL(15,2)) > COALESCE((
          SELECT SUM(CAST(p.amount AS DECIMAL(15,2))) FROM payments p
          WHERE p.order_id = o.id AND p.type = 'payment'
        ), 0)
      GROUP BY o.shop_id
    ) u ON u.shop_id = s.id
    WHERE s.tenant_id = ${tenantId} AND s.status = 'active'
    ORDER BY (COALESCE(o.revenue, 0) - COALESCE(r.returned, 0)) DESC
    LIMIT ${limit}
  `);

  // mysql2 отдаёт пару [строки, метаданные] — как в arrival-router и
  // warehouse-router рядом.
  const [list] = rows as unknown as [Array<Record<string, unknown>>, unknown];

  return (list ?? []).map(row => {
    const orderCount = Number(row.order_count ?? 0);
    const debtOrders = Number(row.debt_orders ?? 0);
    const ltv = Number(row.revenue ?? 0) - Number(row.returned ?? 0);
    const debt = Number(row.debt ?? 0);
    const debtShare = orderCount > 0 ? debtOrders / orderCount : 0;
    const oldestUnpaidDays = Number(row.oldest_unpaid_days ?? 0);

    const { tier, reason } = classify({ debt, orderCount, debtShare, oldestUnpaidDays });

    return {
      shopId: Number(row.shop_id),
      name: String(row.name ?? ""),
      lat: row.lat == null ? null : Number(row.lat),
      lng: row.lng == null ? null : Number(row.lng),
      // Возврат может превысить выручку у магазина, вернувшего заказ прошлого
      // периода: показывать «минус» в графе «принёс денег» бессмысленно.
      ltv: Math.max(0, ltv),
      debt,
      orderCount,
      debtShare,
      oldestUnpaidDays,
      lastOrderAt: row.last_order_at == null ? null : String(row.last_order_at),
      tier,
      reason,
    };
  });
}
