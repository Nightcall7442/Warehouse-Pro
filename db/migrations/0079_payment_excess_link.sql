UPDATE `payments` p JOIN `orders` o ON o.`tenant_id` = p.`tenant_id` AND p.`notes` = CONCAT('Излишек сверх остатка по заказу ', o.`order_number`)
SET p.`excess_of_order_id` = o.`id`
WHERE p.`order_id` IS NULL AND p.`excess_of_order_id` IS NULL AND p.`type` = 'payment' AND p.`notes` LIKE 'Излишек сверх остатка по заказу %';
