-- Migration 0016: Add cost_price and selling_price to arrival_items
-- These columns exist in db/schema.ts but were never added via migration.
-- Uses IF NOT EXISTS for safety (can be run multiple times).

ALTER TABLE `arrival_items`
  ADD COLUMN IF NOT EXISTS `cost_price` decimal(10,2) DEFAULT '0.00';

ALTER TABLE `arrival_items`
  ADD COLUMN IF NOT EXISTS `selling_price` decimal(10,2) DEFAULT '0.00';
