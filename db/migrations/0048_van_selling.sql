ALTER TABLE `orders` ADD `warehouse_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `settings` ADD `van_selling_enabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD `accepted_by` bigint unsigned;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD `accepted_at` timestamp;--> statement-breakpoint
ALTER TABLE `warehouses` ADD `kind` enum('warehouse','van') DEFAULT 'warehouse' NOT NULL;--> statement-breakpoint
ALTER TABLE `warehouses` ADD `driver_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `warehouses` ADD `plate` varchar(20);--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_warehouse_id_warehouses_id_fk` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD CONSTRAINT `stock_transfers_accepted_by_users_id_fk` FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `warehouses` ADD CONSTRAINT `warehouses_driver_id_users_id_fk` FOREIGN KEY (`driver_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;