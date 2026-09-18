DROP TABLE `tare_movements`;--> statement-breakpoint
DROP TABLE `tare_types`;--> statement-breakpoint
ALTER TABLE `orders` DROP FOREIGN KEY `orders_warehouse_id_warehouses_id_fk`;
--> statement-breakpoint
ALTER TABLE `stock_transfers` DROP FOREIGN KEY `stock_transfers_accepted_by_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `warehouses` DROP FOREIGN KEY `warehouses_driver_id_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `orders` DROP COLUMN `warehouse_id`;--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `tare_type_id`;--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `tare_per_unit`;--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `van_selling_enabled`;--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `tare_enabled`;--> statement-breakpoint
ALTER TABLE `stock_transfers` DROP COLUMN `accepted_by`;--> statement-breakpoint
ALTER TABLE `stock_transfers` DROP COLUMN `accepted_at`;--> statement-breakpoint
ALTER TABLE `warehouses` DROP COLUMN `kind`;--> statement-breakpoint
ALTER TABLE `warehouses` DROP COLUMN `driver_id`;--> statement-breakpoint
ALTER TABLE `warehouses` DROP COLUMN `plate`;