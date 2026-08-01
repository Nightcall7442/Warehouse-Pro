-- Create the new unique index FIRST (guarded — MySQL has no CREATE INDEX IF
-- NOT EXISTS), before dropping the old one. `product_id` has a FOREIGN KEY
-- pointing at `products.id`, and `uq_stock_product_tenant` is currently the
-- only index covering it — dropping it first (as this file originally did)
-- fails with "Cannot drop index ... needed in a foreign key constraint"
-- (confirmed by testing against a schema with the real FK in place). Creating
-- the new index first keeps `product_id` covered throughout, since it's also
-- a leftmost prefix of the new index, so the old one becomes safely droppable.
SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'warehouse_stock' AND INDEX_NAME = 'uq_stock_product_warehouse_tenant'
);
SET @ddl = IF(@idx_exists = 0,
  'CREATE UNIQUE INDEX `uq_stock_product_warehouse_tenant` ON `warehouse_stock` (`product_id`, `warehouse_id`, `tenant_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Drop old unique index that prevents multi-warehouse stock — safe now that
-- the new index above also covers product_id.
DROP INDEX IF EXISTS `uq_stock_product_tenant` ON `warehouse_stock`;
