-- Drop old unique index that prevents multi-warehouse stock
DROP INDEX IF EXISTS `uq_stock_product_tenant` ON `warehouse_stock`;

-- Create new unique index that supports multi-warehouse stock
CREATE UNIQUE INDEX `uq_stock_product_warehouse_tenant` ON `warehouse_stock` (`product_id`, `warehouse_id`, `tenant_id`);
