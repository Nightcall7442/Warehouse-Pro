import { sql } from "drizzle-orm";

type Db = ReturnType<typeof import("../queries/connection").getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/*
  Сколько уже заплачено по ЗАКАЗУ `o` — одно выражение на долг магазина и на
  его просрочку (overdueDebt ниже): разойдись они — и «просрочено» назвало бы
  сумму, которой нет в долге.

  Раньше здесь стоял LEFT JOIN на подзапрос, который считал суммы по всем
  заказам всех организаций разом, а потом отбрасывал всё лишнее. Пересчёт
  долга вызывается на каждое изменение статуса заказа, каждую оплату, каждый
  возврат и каждое действие курьера, так что вся таблица платежей
  перемалывалась заново по нескольку раз в минуту. На десятках тысяч строк
  это стало бы самым дорогим запросом в системе.

  Здесь же читаются только платежи одного заказа, по индексу
  idx_payments_order. Результат тот же: прежний JOIN группировал по order_id
  и подставлял строку с тем же условием, что стоит теперь в WHERE.
*/
const PAID_ON_ORDER = sql`COALESCE((
  SELECT SUM(CAST(p.amount AS DECIMAL(15,2))) FROM payments p
  WHERE p.order_id = o.id AND p.type = 'payment'
), 0)`;

/**
 * `shops.debt` is a cached running balance, and for a long time every caller
 * maintained it by hand — "add the total here", "subtract what was paid
 * there". That approach produced a steady trickle of bugs: a delivery that
 * booked nothing because the order wasn't marked "в долг", a partial payment
 * that subtracted from a balance nothing had ever been added to, two helpers
 * composed in one transaction where the second read a status the first had
 * just written and drew the wrong conclusion from it. Each was individually
 * plausible; together they meant real money silently vanished from the
 * debtor list.
 *
 * So the balance is no longer maintained incrementally. It is *derived*:
 * this function recomputes it from the underlying records, and every mutation
 * that can affect what a shop owes simply calls it once it is done. That
 * makes the write idempotent and order-independent — running it twice, or
 * after an unrelated change, can't drift — and removes the entire class of
 * "we forgot to adjust the balance on this path" bug, because there is no
 * adjustment to forget.
 *
 * ── What a shop owes ────────────────────────────────────────────────────────
 *
 * Per order, unless it was cancelled or fully returned (nothing is owed for
 * goods that never stayed with the shop):
 *
 *   • a credit order ("в долг") owes from the moment it is created — that is
 *     what selling on credit means;
 *   • any other order owes only once the goods actually left, i.e. the order
 *     reached "delivered";
 *   • in both cases what's owed is the total minus whatever has been paid
 *     against that specific order.
 *
 * Plus shop-level entries not tied to any order: manual "новый долг" rows add,
 * manual payments subtract. Completed returns subtract too — the goods came
 * back, so their value is no longer owed.
 *
 * Floored at zero: an overpayment is not a negative debt.
 */
export async function recalcShopDebt(tx: Tx, tenantId: number, shopId: number): Promise<void> {
  await tx.execute(sql`
    UPDATE shops s
    SET s.debt = GREATEST(0,
      -- Obligations arising from this shop's orders.
      COALESCE((
        SELECT SUM(
          CASE
            WHEN o.status IN ('cancelled', 'returned') THEN 0
            WHEN o.payment_method = 'debt' OR o.status = 'delivered'
              THEN GREATEST(0, CAST(o.total AS DECIMAL(15,2)) - ${PAID_ON_ORDER})
            ELSE 0
          END
        )
        FROM orders o
        WHERE o.shop_id = s.id AND o.tenant_id = s.tenant_id AND o.deleted_at IS NULL
      ), 0)
      -- Shop-level entries recorded directly against the shop, not an order.
      + COALESCE((
        SELECT SUM(CAST(amount AS DECIMAL(15,2))) FROM payments
        WHERE shop_id = s.id AND tenant_id = s.tenant_id AND type = 'debt' AND order_id IS NULL
      ), 0)
      - COALESCE((
        SELECT SUM(CAST(amount AS DECIMAL(15,2))) FROM payments
        WHERE shop_id = s.id AND tenant_id = s.tenant_id AND type = 'payment' AND order_id IS NULL
      ), 0)
      /*
        Оплата заказа, который БОЛЬШЕ НИЧЕГО НЕ ДОЛЖЕН.

        Выше платёж вычитается изнутри слагаемого своего заказа. Но заказ
        попадает в ту сумму, только пока он должен: отменённый, возвращённый и
        просто ещё не доставленный не-долговой заказ дают ноль — и платёж по
        ним исчезает вместе с ними, как будто денег не приносили.

        Так деньги и пропадали. Магазин внёс 100 из 300, заказ отменили —
        обязательство ушло правильно, а сотня растворилась: она не вычлась
        нигде. Заплатив, магазин получил право на эти деньги, и право не
        зависит от того, чем кончился заказ.

        Удалённые заказы сюда не входят намеренно. Удаление — штатный способ
        исправить ошибку ВВОДА: заказа не было вовсе, значит не было и оплаты
        по нему. Засчитать её значило бы выдать магазину придуманный кредит.
      */
      - COALESCE((
        SELECT SUM(CAST(p2.amount AS DECIMAL(15,2)))
        FROM payments p2
        JOIN orders o2 ON o2.id = p2.order_id
        WHERE p2.shop_id = s.id AND p2.tenant_id = s.tenant_id AND p2.type = 'payment'
          AND o2.deleted_at IS NULL
          AND NOT (
            o2.status NOT IN ('cancelled', 'returned')
            AND (o2.payment_method = 'debt' OR o2.status = 'delivered')
          )
      ), 0)
      -- Returned goods are no longer owed for.
      --
      -- Skipped when the return's own order is already cancelled or returned,
      -- because that order contributed 0 above — its whole value is written
      -- off already. Subtracting the return document on top would take the
      -- same money off twice. The floor at the end hides that for a shop whose
      -- only order this is, but on a shop with other open orders the surplus
      -- eats into a balance it has nothing to do with.
      --
      -- Returns against a still-delivered order (the partial case: shop kept
      -- some, handed the rest back) do subtract, which is the whole point of
      -- the document.
      -- Условие здесь обязано быть ТЕМ ЖЕ, что у начисления выше, а не похожим.
      --
      -- Стояло «заказ не отменён и не возвращён». Этого мало: заказ перестаёт
      -- быть должным и другими способами — его удаляют, или он выходит из
      -- 'delivered' обратно в работу (а не-долговой заказ в работе не должен
      -- ничего). Во всех этих случаях его вклад выше равен нулю, а возврат
      -- продолжал вычитаться — то есть те же деньги списывались дважды.
      --
      -- Нижняя граница по нулю это прятала у магазина с единственным заказом,
      -- но у магазина с другими открытыми заказами излишек съедал чужой долг.
      --
      -- Возврат без заказа (r.order_id IS NULL) вычитается всегда: ему нечему
      -- соответствовать, это отдельное обязательство.
      - COALESCE((
        SELECT SUM(CAST(r.total_amount AS DECIMAL(15,2))) FROM returns r
        WHERE r.shop_id = s.id AND r.tenant_id = s.tenant_id AND r.status = 'completed'
          AND (
            r.order_id IS NULL
            OR EXISTS (
              SELECT 1 FROM orders o3
              WHERE o3.id = r.order_id
                AND o3.deleted_at IS NULL
                AND o3.status NOT IN ('cancelled', 'returned')
                AND (o3.payment_method = 'debt' OR o3.status = 'delivered')
            )
          )
      ), 0)
    )
    WHERE s.id = ${shopId} AND s.tenant_id = ${tenantId}
  `);
}

/**
 * Просроченная часть долга магазина — по тем же правилам, что и сам долг.
 *
 * Просрочен неоплаченный остаток ДОСТАВЛЕННОГО заказа, у которого
 *   • явный срок оплаты из напоминания (debt_reminders.due_date — его ставят
 *     курьер и офис при закрытии расчёта) уже прошёл, или
 *   • явного срока нет, а со дня доставки прошло больше graceDays.
 * Явный срок главнее отсрочки: офис договорился с магазином — значит, так.
 *
 * Остаток заказа — итог минус оплаты этого заказа (PAID_ON_ORDER, то же
 * выражение, что в recalcShopDebt) минус завершённые возвраты по нему (долг
 * вычитает их так же). Недоставленный заказ «в долг» уже долг, но
 * просрочиться не может: товар ещё не у магазина.
 *
 * Потолок — сам долг магазина (shops.debt, выведенный recalcShopDebt выше):
 * платёж и возврат без привязки к заказу уменьшают долг, и просрочка не может
 * быть больше того, что магазин вообще должен.
 *
 * Возраст самого старого — от даты заказа, как в отчёте «Дебиторка»
 * (services/receivables.ts): директор видит одно и то же число в двух местах.
 *
 * Деньги целыми: копейки остатка не держат заказ.
 */
export async function overdueDebt(
  db: Db | Tx, tenantId: number, shopId: number, graceDays: number,
): Promise<{ amount: number; oldestDays: number }> {
  const byShop = await overdueDebtByShop(db, tenantId, new Map([[shopId, graceDays]]));
  return byShop.get(shopId) ?? { amount: 0, oldestDays: 0 };
}

/**
 * Та же просрочка — сразу по многим магазинам, одним запросом.
 *
 * Светофору магазинов (services/shop-light.ts) нужна просрочка каждой строки
 * списка, а звать overdueDebt в цикле — запрос на магазин. Второго правила
 * здесь нет: overdueDebt выше — это ровно этот запрос с одним магазином.
 *
 * Отсрочка у каждого магазина своя, поэтому приходит картой «магазин →
 * отсрочка» и подставляется в запрос через CASE. Какую отсрочку брать (своя
 * магазина или организации), решает вызывающий — services/overdue-hold.ts.
 * В ответе только магазины с просрочкой; нет строки — нет просрочки.
 */
export async function overdueDebtByShop(
  db: Db | Tx, tenantId: number, graceByShop: Map<number, number>,
): Promise<Map<number, { amount: number; oldestDays: number }>> {
  const out = new Map<number, { amount: number; oldestDays: number }>();
  const ids = [...graceByShop.keys()];
  if (ids.length === 0) return out;
  const grace = sql`CASE o.shop_id ${sql.join(
    ids.map(id => sql`WHEN ${id} THEN ${Math.max(0, Math.floor(graceByShop.get(id) ?? 0))}`), sql` `,
  )} ELSE 0 END`;
  const result = await db.execute(sql`
    SELECT
      x.shop_id                AS shopId,
      COALESCE(SUM(x.owed), 0) AS amount,
      COALESCE(MAX(x.age), 0)  AS oldestDays,
      (SELECT CAST(s.debt AS DECIMAL(15,2)) FROM shops s WHERE s.id = x.shop_id AND s.tenant_id = ${tenantId}) AS shopDebt
    FROM (
      SELECT
        o.shop_id,
        GREATEST(0, CAST(o.total AS DECIMAL(15,2)) - ${PAID_ON_ORDER} - COALESCE((
          SELECT SUM(CAST(r.total_amount AS DECIMAL(15,2))) FROM returns r
          WHERE r.order_id = o.id AND r.tenant_id = o.tenant_id AND r.status = 'completed'
        ), 0)) AS owed,
        DATEDIFF(CURDATE(), DATE(COALESCE(o.first_ordered_at, o.created_at))) AS age,
        COALESCE(
          (SELECT MAX(dr.due_date) FROM debt_reminders dr
           WHERE dr.order_id = o.id AND dr.tenant_id = o.tenant_id),
          DATE_ADD(DATE(COALESCE(o.delivered_at, o.first_ordered_at, o.created_at)), INTERVAL ${grace} DAY)
        ) AS due
      FROM orders o
      WHERE o.shop_id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)}) AND o.tenant_id = ${tenantId}
        AND o.deleted_at IS NULL AND o.status = 'delivered'
    ) x
    WHERE x.owed > 0 AND x.due < CURDATE()
    GROUP BY x.shop_id
  `);
  const rows = (Array.isArray(result) ? result[0] : result) as unknown as Array<{ shopId: unknown; amount: unknown; oldestDays: unknown; shopDebt: unknown }>;
  for (const row of Array.isArray(rows) ? rows : []) {
    const amount = Math.round(Math.min(Number(row.amount ?? 0), Number(row.shopDebt ?? 0)));
    if (amount >= 1) out.set(Number(row.shopId), { amount, oldestDays: Number(row.oldestDays ?? 0) });
  }
  return out;
}
