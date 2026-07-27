-- Migration 0023: Extend sales_targets for multi-metric quota system
-- Adds order count target, visit completion target, and actual tracking columns.

ALTER TABLE `sales_targets`
  ADD COLUMN `order_count_target` int DEFAULT NULL AFTER `actual_amount`,
  ADD COLUMN `visit_target` decimal(5,2) DEFAULT NULL COMMENT 'Target visit completion %' AFTER `order_count_target`,
  ADD COLUMN `actual_order_count` int NOT NULL DEFAULT 0 AFTER `visit_target`,
  ADD COLUMN `actual_visit_pct` decimal(5,2) NOT NULL DEFAULT 0.00 AFTER `actual_order_count`;
