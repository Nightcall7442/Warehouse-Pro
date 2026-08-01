-- Migration 0023: Extend sales_targets for multi-metric quota system
-- Adds order count target, visit completion target, and actual tracking columns.
-- Each ADD COLUMN is its own IF NOT EXISTS statement so this is a safe no-op if
-- these columns already exist (this repo's migrations were historically
-- applied to production via `drizzle-kit push` before being checked in here).

ALTER TABLE `sales_targets` ADD COLUMN IF NOT EXISTS `order_count_target` int DEFAULT NULL AFTER `actual_amount`;
ALTER TABLE `sales_targets` ADD COLUMN IF NOT EXISTS `visit_target` decimal(5,2) DEFAULT NULL COMMENT 'Target visit completion %' AFTER `order_count_target`;
ALTER TABLE `sales_targets` ADD COLUMN IF NOT EXISTS `actual_order_count` int NOT NULL DEFAULT 0 AFTER `visit_target`;
ALTER TABLE `sales_targets` ADD COLUMN IF NOT EXISTS `actual_visit_pct` decimal(5,2) NOT NULL DEFAULT 0.00 AFTER `actual_order_count`;
