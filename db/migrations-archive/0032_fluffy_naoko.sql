CREATE TABLE `agent_territories` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`agent_id` bigint unsigned NOT NULL,
	`territory_id` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agent_territories_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_agent_territory` UNIQUE(`agent_id`,`territory_id`)
);
--> statement-breakpoint
CREATE TABLE `loading_list_orders` (
	`list_id` bigint unsigned NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	CONSTRAINT `loading_list_orders_list_id_order_id_pk` PRIMARY KEY(`list_id`,`order_id`)
);
--> statement-breakpoint
CREATE TABLE `loading_lists` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`list_number` varchar(50) NOT NULL,
	`warehouse_id` bigint unsigned,
	`agent_id` bigint unsigned,
	`route_data` json,
	`status` enum('preparing','ready','loading','loaded','delivered') NOT NULL DEFAULT 'preparing',
	`total_orders` int NOT NULL DEFAULT 0,
	`total_items` int NOT NULL DEFAULT 0,
	`total_weight` decimal(10,3),
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`loaded_at` timestamp,
	`delivered_at` timestamp,
	CONSTRAINT `loading_lists_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_list_number_tenant` UNIQUE(`list_number`,`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `order_comments` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`content` text NOT NULL,
	`parent_id` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `saved_filters` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`name` varchar(100) NOT NULL,
	`filter_config` json NOT NULL,
	`is_default` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `saved_filters_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `visit_schedules` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`agent_id` bigint unsigned NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`day_of_week` tinyint NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `visit_schedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_schedule_agent_shop_day` UNIQUE(`agent_id`,`shop_id`,`day_of_week`)
);
--> statement-breakpoint
ALTER TABLE `warehouse_stock` DROP INDEX `uq_stock_product_tenant`;--> statement-breakpoint
ALTER TABLE `daily_plans` MODIFY COLUMN `photo_url` mediumtext;--> statement-breakpoint
ALTER TABLE `products` MODIFY COLUMN `photo_url` mediumtext;--> statement-breakpoint
ALTER TABLE `shops` MODIFY COLUMN `photo_url` mediumtext;--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `avatar` mediumtext;--> statement-breakpoint
ALTER TABLE `order_items` ADD `cost_price` decimal(10,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `invoice_printed_at` timestamp;--> statement-breakpoint
ALTER TABLE `orders` ADD `priority` enum('low','normal','high') DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `sales_targets` ADD `territory_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `sales_targets` ADD `order_count_target` int;--> statement-breakpoint
ALTER TABLE `sales_targets` ADD `visit_target` decimal(5,2);--> statement-breakpoint
ALTER TABLE `sales_targets` ADD `actual_order_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales_targets` ADD `actual_visit_pct` decimal(5,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_branding` ADD `inn` varchar(20);--> statement-breakpoint
ALTER TABLE `tenant_branding` ADD `legal_address` varchar(500);--> statement-breakpoint
ALTER TABLE `territories` ADD `center_lat` decimal(10,8);--> statement-breakpoint
ALTER TABLE `territories` ADD `center_lng` decimal(11,8);--> statement-breakpoint
ALTER TABLE `territories` ADD `radius_km` decimal(6,2) DEFAULT '10.00';--> statement-breakpoint
ALTER TABLE `warehouse_stock` ADD CONSTRAINT `uq_stock_product_warehouse_tenant` UNIQUE(`product_id`,`warehouse_id`,`tenant_id`);--> statement-breakpoint
ALTER TABLE `agent_territories` ADD CONSTRAINT `agent_territories_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `agent_territories` ADD CONSTRAINT `agent_territories_agent_id_users_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `agent_territories` ADD CONSTRAINT `agent_territories_territory_id_territories_id_fk` FOREIGN KEY (`territory_id`) REFERENCES `territories`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loading_list_orders` ADD CONSTRAINT `loading_list_orders_list_id_loading_lists_id_fk` FOREIGN KEY (`list_id`) REFERENCES `loading_lists`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loading_list_orders` ADD CONSTRAINT `loading_list_orders_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loading_lists` ADD CONSTRAINT `loading_lists_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loading_lists` ADD CONSTRAINT `loading_lists_warehouse_id_warehouses_id_fk` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loading_lists` ADD CONSTRAINT `loading_lists_agent_id_users_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loading_lists` ADD CONSTRAINT `loading_lists_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_comments` ADD CONSTRAINT `order_comments_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_comments` ADD CONSTRAINT `order_comments_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_comments` ADD CONSTRAINT `order_comments_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `saved_filters` ADD CONSTRAINT `saved_filters_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `saved_filters` ADD CONSTRAINT `saved_filters_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visit_schedules` ADD CONSTRAINT `visit_schedules_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visit_schedules` ADD CONSTRAINT `visit_schedules_agent_id_users_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visit_schedules` ADD CONSTRAINT `visit_schedules_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visit_schedules` ADD CONSTRAINT `visit_schedules_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_agent_territories_tenant` ON `agent_territories` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_territories_agent` ON `agent_territories` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_territories_territory` ON `agent_territories` (`territory_id`);--> statement-breakpoint
CREATE INDEX `idx_llo_order` ON `loading_list_orders` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_lists_tenant_status` ON `loading_lists` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_lists_agent` ON `loading_lists` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_comments_order` ON `order_comments` (`order_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_filters_user` ON `saved_filters` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_schedules_tenant` ON `visit_schedules` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_schedules_agent` ON `visit_schedules` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_schedules_shop` ON `visit_schedules` (`shop_id`);--> statement-breakpoint
CREATE INDEX `idx_schedules_tenant_agent` ON `visit_schedules` (`tenant_id`,`agent_id`);--> statement-breakpoint
ALTER TABLE `sales_targets` ADD CONSTRAINT `sales_targets_territory_id_territories_id_fk` FOREIGN KEY (`territory_id`) REFERENCES `territories`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_sales_targets_territory` ON `sales_targets` (`territory_id`);