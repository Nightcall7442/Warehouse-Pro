INSERT INTO `order_shortages` (`tenant_id`, `order_id`, `user_id`, `amount`, `note`, `recorded_by`, `created_at`)
SELECT o.`tenant_id`, o.`id`, o.`shortage_user_id`, o.`courier_shortage`, o.`shortage_note`, o.`closed_by`, COALESCE(o.`shortage_at`, o.`closed_at`, o.`updated_at`)
FROM `orders` o WHERE o.`courier_shortage` > 0
  AND NOT EXISTS (SELECT 1 FROM `order_shortages` s WHERE s.`order_id` = o.`id`);
