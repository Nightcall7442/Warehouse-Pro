import { sql } from "drizzle-orm";

type Tx = Parameters<Parameters<ReturnType<typeof import("../queries/connection").getDb>["transaction"]>[0]>[0];

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
              THEN GREATEST(0, CAST(o.total AS DECIMAL(15,2)) - COALESCE((
                -- Сколько уже заплачено по ЭТОМУ заказу.
                --
                -- Раньше здесь стоял LEFT JOIN на подзапрос, который считал
                -- суммы по всем заказам всех организаций разом, а потом
                -- отбрасывал всё лишнее. Пересчёт долга вызывается на каждое
                -- изменение статуса заказа, каждую оплату, каждый возврат и
                -- каждое действие курьера, так что вся таблица платежей
                -- перемалывалась заново по нескольку раз в минуту. Сейчас в
                -- ней полторы сотни строк и этого не видно; на десятках тысяч
                -- это стало бы самым дорогим запросом в системе.
                --
                -- Здесь же читаются только платежи одного заказа, по индексу
                -- idx_payments_order. Результат тот же: прежний JOIN
                -- группировал по order_id и подставлял строку с тем же
                -- условием, что стоит теперь в WHERE.
                SELECT SUM(CAST(p.amount AS DECIMAL(15,2))) FROM payments p
                WHERE p.order_id = o.id AND p.type = 'payment'
              ), 0))
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
