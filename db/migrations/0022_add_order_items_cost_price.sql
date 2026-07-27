-- Migration 0022: Add cost_price column to order_items
-- Drizzle schema defines costPrice but no migration added it to the actual table.

ALTER TABLE `order_items` ADD COLUMN IF NOT EXISTS `cost_price` decimal(10,2) NOT NULL DEFAULT '0.00' AFTER `unit_price`;
