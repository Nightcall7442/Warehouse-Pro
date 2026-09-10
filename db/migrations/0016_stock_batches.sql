CREATE TABLE `stock_batches` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`warehouse_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`batch_number` varchar(64),
	`expires_at` date,
	`batch_key` varchar(96) NOT NULL,
	`quantity` decimal(12,2) NOT NULL DEFAULT '0.00',
	`received_at` timestamp NOT NULL DEFAULT (now()),
	`arrival_item_id` bigint unsigned,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stock_batches_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_batch_product_warehouse` UNIQUE(`tenant_id`,`warehouse_id`,`product_id`,`batch_key`)
);
--> statement-breakpoint
ALTER TABLE `stock_batches` ADD CONSTRAINT `stock_batches_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_batches` ADD CONSTRAINT `stock_batches_warehouse_id_warehouses_id_fk` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_batches` ADD CONSTRAINT `stock_batches_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_batches_tenant_expiry` ON `stock_batches` (`tenant_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_batches_lookup` ON `stock_batches` (`tenant_id`,`warehouse_id`,`product_id`);