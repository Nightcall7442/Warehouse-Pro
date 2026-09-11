ALTER TABLE `commissions` ADD `base_salary` decimal(14,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
INSERT INTO `commissions` (`tenant_id`, `user_id`, `period_type`, `period_start`, `period_end`, `base_salary`, `commission_rate`, `sales_amount`, `commission_amount`)
SELECT st.`tenant_id`, st.`user_id`, 'monthly', st.`period_start`, st.`period_end`, st.`target_amount`, 0.00, 0.00, 0.00
FROM `sales_targets` st
WHERE st.`period_type` = 'monthly'
  AND st.`shop_id` IS NULL AND st.`territory_id` IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM `commissions` c
    WHERE c.`tenant_id` = st.`tenant_id` AND c.`user_id` = st.`user_id`
      AND c.`period_type` = 'monthly' AND c.`period_start` = st.`period_start`
  );--> statement-breakpoint
UPDATE `commissions` c
SET c.`base_salary` = COALESCE((
  SELECT st.`target_amount` FROM `sales_targets` st
  WHERE st.`tenant_id` = c.`tenant_id` AND st.`user_id` = c.`user_id`
    AND st.`period_type` = 'monthly' AND st.`shop_id` IS NULL AND st.`territory_id` IS NULL
    AND st.`period_start` <= c.`period_end`
  ORDER BY st.`period_start` DESC LIMIT 1
), 0.00)
WHERE c.`period_type` = 'monthly' AND c.`base_salary` = 0.00;
