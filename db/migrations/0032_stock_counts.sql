CREATE TABLE `stock_count_items` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`count_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`expected` decimal(12,2) NOT NULL,
	`counted` decimal(12,2),
	`note` varchar(255),
	CONSTRAINT `stock_count_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_stock_count_items_count_product` UNIQUE(`count_id`,`product_id`)
);
--> statement-breakpoint
CREATE TABLE `stock_counts` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`warehouse_id` bigint unsigned NOT NULL,
	`number` varchar(30) NOT NULL,
	`status` enum('draft','applied','cancelled') NOT NULL DEFAULT 'draft',
	`notes` text,
	`created_by` bigint unsigned NOT NULL,
	`applied_by` bigint unsigned,
	`applied_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stock_counts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `stock_count_items` ADD CONSTRAINT `stock_count_items_count_id_stock_counts_id_fk` FOREIGN KEY (`count_id`) REFERENCES `stock_counts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_count_items` ADD CONSTRAINT `stock_count_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_counts` ADD CONSTRAINT `stock_counts_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_counts` ADD CONSTRAINT `stock_counts_warehouse_id_warehouses_id_fk` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_counts` ADD CONSTRAINT `stock_counts_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_counts` ADD CONSTRAINT `stock_counts_applied_by_users_id_fk` FOREIGN KEY (`applied_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_stock_counts_tenant` ON `stock_counts` (`tenant_id`,`created_at`);