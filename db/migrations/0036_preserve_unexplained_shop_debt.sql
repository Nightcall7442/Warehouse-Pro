-- `shops.debt` used to be a hand-maintained running balance; it is now derived
-- from orders, payments and returns (see api/services/shop-debt.ts). Before the
-- derived value takes over, any balance the underlying records cannot account
-- for has to be written down explicitly — otherwise the first recalculation
-- would silently erase it.
--
-- Unexplained balances are legitimate: a tenant migrating from another system
-- may have entered opening balances straight onto the shop, and seeded demo
-- data does the same. Each one becomes a shop-level "debt" entry, which is
-- exactly how a manual «Новый долг» is already recorded, so the derived value
-- reproduces today's number to the kopek.
--
-- Shops whose stored balance is *lower* than the records imply need nothing
-- here: that is the accounting gap this whole change fixes, and the first
-- recalculation correctly raises them.
INSERT INTO `payments` (`tenant_id`, `shop_id`, `order_id`, `amount`, `type`, `notes`, `created_by`, `created_at`)
SELECT s.tenant_id, s.id, NULL, d.gap, 'debt',
       'Начальный остаток задолженности (перенос при переходе на расчётный баланс)',
       NULL, NOW()
FROM `shops` s
JOIN (
  SELECT sh.id AS shop_id,
         CAST(sh.debt AS DECIMAL(15,2)) - GREATEST(0,
           COALESCE((
             SELECT SUM(CASE
                 WHEN o.status IN ('cancelled','returned') THEN 0
                 WHEN o.payment_method = 'debt' OR o.status = 'delivered'
                   THEN GREATEST(0, CAST(o.total AS DECIMAL(15,2)) - COALESCE(op.paid, 0))
                 ELSE 0
               END)
             FROM `orders` o
             LEFT JOIN (
               SELECT order_id, SUM(CAST(amount AS DECIMAL(15,2))) AS paid
               FROM `payments` WHERE type = 'payment' AND order_id IS NOT NULL
               GROUP BY order_id
             ) op ON op.order_id = o.id
             WHERE o.shop_id = sh.id AND o.tenant_id = sh.tenant_id AND o.deleted_at IS NULL
           ), 0)
           + COALESCE((SELECT SUM(CAST(amount AS DECIMAL(15,2))) FROM `payments`
                       WHERE shop_id = sh.id AND tenant_id = sh.tenant_id AND type = 'debt' AND order_id IS NULL), 0)
           - COALESCE((SELECT SUM(CAST(amount AS DECIMAL(15,2))) FROM `payments`
                       WHERE shop_id = sh.id AND tenant_id = sh.tenant_id AND type = 'payment' AND order_id IS NULL), 0)
           - COALESCE((SELECT SUM(CAST(total_amount AS DECIMAL(15,2))) FROM `returns`
                       WHERE shop_id = sh.id AND tenant_id = sh.tenant_id AND status = 'completed'), 0)
         ) AS gap
  FROM `shops` sh
) d ON d.shop_id = s.id
WHERE d.gap > 0.01;
