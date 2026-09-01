-- Stock movements record physical goods entering or leaving, but until now
-- they did not say *which* warehouse — so with more than one warehouse the
-- ledger could not be read back per location, and could not be reconciled
-- against warehouse_stock at all.
ALTER TABLE `stock_movements` ADD COLUMN `warehouse_id` bigint unsigned;
--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_warehouse_id_warehouses_id_fk`
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `idx_movements_warehouse` ON `stock_movements` (`warehouse_id`);
--> statement-breakpoint
-- Every movement written before this point came from a flow that only ever
-- touched the tenant's default warehouse, so that is where they belong.
UPDATE `stock_movements` sm
JOIN `warehouses` w ON w.tenant_id = sm.tenant_id AND w.is_default = 1
SET sm.warehouse_id = w.id
WHERE sm.warehouse_id IS NULL;
