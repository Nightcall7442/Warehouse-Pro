INSERT INTO `payments` (`tenant_id`, `shop_id`, `order_id`, `amount`, `type`, `notes`, `created_by`, `created_at`)
SELECT d.tenant_id, d.shop_id, NULL, d.gap, 'debt', 'Начальный долг (импорт, перенос 23.11.2026)', NULL, NOW()
FROM (
  SELECT s.tenant_id AS tenant_id, s.id AS shop_id,
    ROUND(CAST(s.debt AS DECIMAL(15,2)) - GREATEST(0,
      COALESCE((
        SELECT SUM(
          CASE
            WHEN o.status IN ('cancelled', 'returned') THEN 0
            WHEN o.payment_method = 'debt' OR o.status = 'delivered'
              THEN GREATEST(0, CAST(o.total AS DECIMAL(15,2)) - COALESCE((
  SELECT SUM(CAST(p.amount AS DECIMAL(15,2))) FROM payments p
  WHERE p.order_id = o.id AND p.type = 'payment'
), 0))
            ELSE 0
          END
        )
        FROM orders o
        WHERE o.shop_id = s.id AND o.tenant_id = s.tenant_id AND o.deleted_at IS NULL
      ), 0)
      + COALESCE((
        SELECT SUM(CAST(amount AS DECIMAL(15,2))) FROM payments
        WHERE shop_id = s.id AND tenant_id = s.tenant_id AND type = 'debt' AND order_id IS NULL
      ), 0)
      - COALESCE((
        SELECT SUM(CAST(amount AS DECIMAL(15,2))) FROM payments
        WHERE shop_id = s.id AND tenant_id = s.tenant_id AND type = 'payment' AND order_id IS NULL
      ), 0)
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
    ), 2) AS gap
  FROM `shops` s
) d
WHERE d.gap > 0.01
  AND NOT EXISTS (
    SELECT 1 FROM `payments` px
    WHERE px.shop_id = d.shop_id AND px.tenant_id = d.tenant_id AND px.type = 'debt'
      AND px.notes = 'Начальный долг (импорт, перенос 23.11.2026)'
  );
-- Начальный долг из импорта магазинов — строкой журнала (бизнес-аудит 19.11.2026).
--
-- Импорт писал долг из файла прямо в shops.debt. Но shops.debt — итог, его
-- выводит recalcShopDebt (api/services/shop-debt.ts) из заказов, платежей и
-- возвратов, и первая же оплата или заказ магазина стирала импортированную
-- сумму. С 23.11.2026 импорт пишет начальный долг строкой «долг» без заказа;
-- эта миграция делает то же для магазинов, импортированных раньше и ещё не
-- пересчитанных: долг, который записи объяснить не могут, записывается
-- явно — ровно как миграция 0036, когда shops.debt стал расчётным.
--
-- Формула выше — ТА ЖЕ, что в recalcShopDebt, вплоть до слова: иначе
-- магазину записался бы долг, которого нет. Совпадение стережёт
-- api/__tests__/preserve-imported-debt-migration.test.ts.
--
-- Уже стёртые долги (магазин успели пересчитать) отсюда не вернуть: от них в
-- базе ничего не осталось. Магазины, у которых записанный долг МЕНЬШЕ
-- расчётного, не трогаются — их поднимет следующий пересчёт.
--
-- Идемпотентно дважды: после вставки расчётный долг равен записанному, и
-- повтор находит ноль строк; а магазин, у которого перенос уже записан,
-- пропускается по метке (NOT EXISTS выше) — даже если кто-то успел поменять
-- shops.debt между накатами.
