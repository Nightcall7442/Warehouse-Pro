-- Migration 0017: Ensure warehouse_id exists in warehouse_stock
-- Migration 0012 should have added this, but if it didn't run, we need it.
-- Uses IF NOT EXISTS for safety.

-- Add warehouse_id if missing
SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'warehouse_stock' AND COLUMN_NAME = 'warehouse_id');

SET @sql = IF(@exists = 0,
  'ALTER TABLE `warehouse_stock` ADD COLUMN `warehouse_id` bigint unsigned AFTER `tenant_id`',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Backfill: set warehouse_id to default warehouse for any NULL rows
UPDATE warehouse_stock ws
  JOIN warehouses w ON w.tenant_id = ws.tenant_id AND w.is_default = true
  SET ws.warehouse_id = w.id
  WHERE ws.warehouse_id IS NULL;

-- Make NOT NULL if it was nullable
SET @nullable = (SELECT IS_NULLABLE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'warehouse_stock' AND COLUMN_NAME = 'warehouse_id');
SET @sql2 = IF(@nullable = 'YES',
  'ALTER TABLE `warehouse_stock` MODIFY `warehouse_id` bigint unsigned NOT NULL',
  'SELECT 1');
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

-- Ensure unique index includes warehouse_id
SET @idxExists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'warehouse_stock' AND INDEX_NAME = 'uq_stock_product_warehouse');
SET @sql3 = IF(@idxExists = 0,
  'ALTER TABLE `warehouse_stock` DROP INDEX IF EXISTS `uq_stock_product_tenant`, ADD UNIQUE INDEX `uq_stock_product_warehouse` (`product_id`, `warehouse_id`, `tenant_id`)',
  'SELECT 1');
PREPARE stmt3 FROM @sql3;
EXECUTE stmt3;
DEALLOCATE PREPARE stmt3;
