-- Column and index use IF NOT EXISTS / DROP-then-CREATE. MySQL has no
-- "ADD CONSTRAINT IF NOT EXISTS" for foreign keys, so the FK add is guarded by
-- an information_schema check instead — all to make this a safe no-op if
-- already applied.
ALTER TABLE `sales_targets` ADD COLUMN IF NOT EXISTS `territory_id` bigint unsigned DEFAULT NULL AFTER `shop_id`;

SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sales_targets'
    AND CONSTRAINT_NAME = 'sales_targets_territory_id_territories_id_fk'
);
SET @ddl = IF(@fk_exists = 0,
  'ALTER TABLE `sales_targets` ADD CONSTRAINT `sales_targets_territory_id_territories_id_fk` FOREIGN KEY (`territory_id`) REFERENCES `territories`(`id`) ON DELETE restrict',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Not a plain DROP-then-CREATE here: this index backs the FK just added above,
-- and MySQL/MariaDB refuse to drop an index a foreign key depends on
-- ("Cannot drop index ... needed in a foreign key constraint") — confirmed by
-- testing this file against an already-migrated database. Guarded the same
-- way as the FK itself instead.
SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sales_targets'
    AND INDEX_NAME = 'idx_sales_targets_territory'
);
SET @ddl2 = IF(@idx_exists = 0,
  'CREATE INDEX `idx_sales_targets_territory` ON `sales_targets` (`territory_id`)',
  'SELECT 1'
);
PREPARE stmt2 FROM @ddl2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;
