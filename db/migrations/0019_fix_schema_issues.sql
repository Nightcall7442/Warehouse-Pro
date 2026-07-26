-- Migration 0019: Fix schema issues
-- 1. warehouse_stock unique index: ensure warehouse_id is in the unique constraint
-- 2. Add FK references for id_mappings.tenant_id and sync_status.tenant_id
-- 3. Add missing indexes: shops(territory_id), sales_targets(shop_id)
-- 4. Add order_id column to payments table (optional)

-- ============================================
-- Step 1: Fix warehouse_stock unique index
-- Drop the old constraint if still present, then ensure the correct one exists
-- ============================================
DROP INDEX IF EXISTS `uq_stock_product_tenant` ON `warehouse_stock`;

SET @idxExists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'warehouse_stock' AND INDEX_NAME = 'uq_stock_product_warehouse');
SET @sql1 = IF(@idxExists = 0,
  'ALTER TABLE `warehouse_stock` ADD UNIQUE INDEX `uq_stock_product_warehouse` (`product_id`, `warehouse_id`, `tenant_id`)',
  'SELECT 1');
PREPARE stmt1 FROM @sql1;
EXECUTE stmt1;
DEALLOCATE PREPARE stmt1;

-- ============================================
-- Step 2: Add FK references for id_mappings and sync_status
-- ============================================

-- id_mappings.tenant_id -> tenants.id
SET @fk1 = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'id_mappings' AND CONSTRAINT_TYPE = 'FOREIGN KEY' AND CONSTRAINT_NAME = 'fk_idmappings_tenant');
SET @sql2 = IF(@fk1 = 0,
  'ALTER TABLE `id_mappings` ADD CONSTRAINT `fk_idmappings_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE',
  'SELECT 1');
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

-- sync_status.tenant_id -> tenants.id
SET @fk2 = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sync_status' AND CONSTRAINT_TYPE = 'FOREIGN KEY' AND CONSTRAINT_NAME = 'fk_syncstatus_tenant');
SET @sql3 = IF(@fk2 = 0,
  'ALTER TABLE `sync_status` ADD CONSTRAINT `fk_syncstatus_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE',
  'SELECT 1');
PREPARE stmt3 FROM @sql3;
EXECUTE stmt3;
DEALLOCATE PREPARE stmt3;

-- ============================================
-- Step 3: Add missing indexes
-- ============================================

-- shops(territory_id)
SET @idx1 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shops' AND INDEX_NAME = 'idx_shops_territory');
SET @sql4 = IF(@idx1 = 0,
  'CREATE INDEX `idx_shops_territory` ON `shops`(`territory_id`)',
  'SELECT 1');
PREPARE stmt4 FROM @sql4;
EXECUTE stmt4;
DEALLOCATE PREPARE stmt4;

-- sales_targets(shop_id)
SET @idx2 = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_targets' AND INDEX_NAME = 'idx_sales_targets_shop');
SET @sql5 = IF(@idx2 = 0,
  'CREATE INDEX `idx_sales_targets_shop` ON `sales_targets`(`shop_id`)',
  'SELECT 1');
PREPARE stmt5 FROM @sql5;
EXECUTE stmt5;
DEALLOCATE PREPARE stmt5;

-- ============================================
-- Step 4: Add order_id column to payments (optional)
-- ============================================
ALTER TABLE `payments`
  ADD COLUMN IF NOT EXISTS `order_id` bigint unsigned AFTER `shop_id`;

-- Add FK for the new column if it doesn't exist yet
SET @fk3 = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND CONSTRAINT_TYPE = 'FOREIGN KEY' AND CONSTRAINT_NAME = 'fk_payments_order');
SET @sql6 = IF(@fk3 = 0,
  'ALTER TABLE `payments` ADD CONSTRAINT `fk_payments_order` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt6 FROM @sql6;
EXECUTE stmt6;
DEALLOCATE PREPARE stmt6;
