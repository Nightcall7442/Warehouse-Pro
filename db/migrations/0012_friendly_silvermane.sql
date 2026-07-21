CREATE TABLE `api_keys` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`name` varchar(100) NOT NULL,
	`key_hash` varchar(64) NOT NULL,
	`key_prefix` varchar(12) NOT NULL,
	`scopes` varchar(500) NOT NULL DEFAULT 'read',
	`rate_limit` int NOT NULL DEFAULT 100,
	`last_used_at` timestamp,
	`expires_at` timestamp,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_apikey_hash` UNIQUE(`key_hash`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`actor_id` bigint unsigned,
	`actor_name` varchar(100),
	`action` varchar(100) NOT NULL,
	`target_type` varchar(50),
	`target_id` bigint unsigned,
	`meta` json,
	`ip` varchar(45),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `commissions` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`commission_rate` decimal(5,2) NOT NULL DEFAULT '0.00',
	`period_type` enum('monthly','quarterly') NOT NULL DEFAULT 'monthly',
	`period_start` date NOT NULL,
	`period_end` date NOT NULL,
	`sales_amount` decimal(14,2) NOT NULL DEFAULT '0.00',
	`commission_amount` decimal(14,2) NOT NULL DEFAULT '0.00',
	`status` enum('pending','approved','paid') NOT NULL DEFAULT 'pending',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `commissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`used_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `password_reset_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_reset_token_hash` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `price_list_assignments` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`price_list_id` bigint unsigned NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `price_list_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `price_list_items` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`price_list_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`price` decimal(10,2) NOT NULL,
	`min_quantity` decimal(10,2) NOT NULL DEFAULT '1',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `price_list_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `price_lists` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`type` enum('shop','tier','volume') NOT NULL DEFAULT 'shop',
	`is_active` boolean NOT NULL DEFAULT true,
	`priority` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `price_lists_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `return_items` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`return_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`quantity` decimal(10,2) NOT NULL,
	`unit_price` decimal(10,2) NOT NULL,
	`subtotal` decimal(12,2) NOT NULL,
	`reason` varchar(255),
	`condition` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `return_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `returns` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`order_id` bigint unsigned,
	`shop_id` bigint unsigned NOT NULL,
	`agent_id` bigint unsigned,
	`return_number` varchar(50) NOT NULL,
	`status` enum('pending','approved','rejected','completed') NOT NULL DEFAULT 'pending',
	`reason` enum('defect','wrong_item','expired','damaged','other') NOT NULL DEFAULT 'other',
	`notes` text,
	`total_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `returns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sales_targets` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`shop_id` bigint unsigned,
	`period_type` enum('daily','weekly','monthly') NOT NULL DEFAULT 'monthly',
	`period_start` date NOT NULL,
	`period_end` date NOT NULL,
	`target_amount` decimal(14,2) NOT NULL,
	`actual_amount` decimal(14,2) NOT NULL DEFAULT '0.00',
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sales_targets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stock_transfers` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`from_warehouse_id` bigint unsigned NOT NULL,
	`to_warehouse_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`quantity` decimal(12,2) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`notes` text,
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`completed_at` timestamp,
	CONSTRAINT `stock_transfers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `territories` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`color` varchar(7),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `territories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `warehouses` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`address` varchar(500),
	`city` varchar(100),
	`is_default` boolean NOT NULL DEFAULT false,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `warehouses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `agent_locations` DROP FOREIGN KEY `agent_locations_tenant_id_tenants_id_fk`;
--> statement-breakpoint
ALTER TABLE `agent_locations` DROP FOREIGN KEY `agent_locations_agent_id_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `arrival_items` DROP FOREIGN KEY `arrival_items_arrival_id_arrivals_id_fk`;
--> statement-breakpoint
ALTER TABLE `arrival_items` DROP FOREIGN KEY `arrival_items_product_id_products_id_fk`;
--> statement-breakpoint
ALTER TABLE `arrivals` DROP FOREIGN KEY `arrivals_tenant_id_tenants_id_fk`;
--> statement-breakpoint
ALTER TABLE `billing_events` DROP FOREIGN KEY `billing_events_tenant_id_tenants_id_fk`;
--> statement-breakpoint
ALTER TABLE `daily_plans` DROP FOREIGN KEY `daily_plans_tenant_id_tenants_id_fk`;
--> statement-breakpoint
ALTER TABLE `daily_plans` DROP FOREIGN KEY `daily_plans_agent_id_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `daily_plans` DROP FOREIGN KEY `daily_plans_shop_id_shops_id_fk`;
--> statement-breakpoint
ALTER TABLE `daily_plans` DROP FOREIGN KEY `daily_plans_created_by_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `invites` DROP FOREIGN KEY `invites_tenant_id_tenants_id_fk`;
--> statement-breakpoint
ALTER TABLE `invites` DROP FOREIGN KEY `invites_created_by_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `notifications` DROP FOREIGN KEY `notifications_tenant_id_tenants_id_fk`;
--> statement-breakpoint
ALTER TABLE `notifications` DROP FOREIGN KEY `notifications_user_id_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `order_items` DROP FOREIGN KEY `order_items_order_id_orders_id_fk`;
--> statement-breakpoint
ALTER TABLE `order_items` DROP FOREIGN KEY `order_items_product_id_products_id_fk`;
--> statement-breakpoint
ALTER TABLE `orders` DROP FOREIGN KEY `orders_tenant_id_tenants_id_fk`;
--> statement-breakpoint
ALTER TABLE `orders` DROP FOREIGN KEY `orders_shop_id_shops_id_fk`;
--> statement-breakpoint
ALTER TABLE `orders` DROP FOREIGN KEY `orders_agent_id_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `orders` DROP FOREIGN KEY `orders_courier_id_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `payments` DROP FOREIGN KEY `payments_tenant_id_tenants_id_fk`;
--> statement-breakpoint
ALTER TABLE `payments` DROP FOREIGN KEY `payments_shop_id_shops_id_fk`;
--> statement-breakpoint
ALTER TABLE `payments` DROP FOREIGN KEY `payments_created_by_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `products` DROP FOREIGN KEY `products_tenant_id_tenants_id_fk`;
--> statement-breakpoint
ALTER TABLE `settings` DROP FOREIGN KEY `settings_tenant_id_tenants_id_fk`;
--> statement-breakpoint
ALTER TABLE `shops` DROP FOREIGN KEY `shops_tenant_id_tenants_id_fk`;
--> statement-breakpoint
ALTER TABLE `shops` DROP FOREIGN KEY `shops_agent_id_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `stock_movements` DROP FOREIGN KEY `stock_movements_tenant_id_tenants_id_fk`;
--> statement-breakpoint
ALTER TABLE `stock_movements` DROP FOREIGN KEY `stock_movements_product_id_products_id_fk`;
--> statement-breakpoint
ALTER TABLE `subscriptions` DROP FOREIGN KEY `subscriptions_tenant_id_tenants_id_fk`;
--> statement-breakpoint
ALTER TABLE `tenant_branding` DROP FOREIGN KEY `tenant_branding_tenant_id_tenants_id_fk`;
--> statement-breakpoint
ALTER TABLE `users` DROP FOREIGN KEY `users_tenant_id_tenants_id_fk`;
--> statement-breakpoint
ALTER TABLE `visit_reports` DROP FOREIGN KEY `visit_reports_tenant_id_tenants_id_fk`;
--> statement-breakpoint
ALTER TABLE `visit_reports` DROP FOREIGN KEY `visit_reports_shop_id_shops_id_fk`;
--> statement-breakpoint
ALTER TABLE `visit_reports` DROP FOREIGN KEY `visit_reports_user_id_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `visit_reports` DROP FOREIGN KEY `visit_reports_plan_id_daily_plans_id_fk`;
--> statement-breakpoint
ALTER TABLE `warehouse_stock` DROP FOREIGN KEY `warehouse_stock_tenant_id_tenants_id_fk`;
--> statement-breakpoint
ALTER TABLE `warehouse_stock` DROP FOREIGN KEY `warehouse_stock_product_id_products_id_fk`;
--> statement-breakpoint
ALTER TABLE `products` MODIFY COLUMN `reorder_point` decimal(10,2) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `settings` MODIFY COLUMN `default_reorder_point` decimal(10,2) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `subscriptions` MODIFY COLUMN `plan` enum('trial','basic','pro','exclusive') NOT NULL DEFAULT 'trial';--> statement-breakpoint
ALTER TABLE `tenants` MODIFY COLUMN `plan` enum('trial','basic','pro','exclusive') NOT NULL DEFAULT 'trial';--> statement-breakpoint
ALTER TABLE `agent_locations` ADD `battery_level` int;--> statement-breakpoint
ALTER TABLE `daily_plans` ADD `photo_url` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `idempotency_key` varchar(64);--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_method` enum('cash','card','transfer','debt') DEFAULT 'cash' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `deleted_at` timestamp;--> statement-breakpoint
ALTER TABLE `shops` ADD `territory_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `tenant_branding` ADD `custom_domain` varchar(255);--> statement-breakpoint
ALTER TABLE `tenant_branding` ADD `favicon_url` varchar(500);--> statement-breakpoint
ALTER TABLE `tenant_branding` ADD `login_title` varchar(100);--> statement-breakpoint
ALTER TABLE `tenant_branding` ADD `login_subtitle` varchar(255);--> statement-breakpoint
ALTER TABLE `tenant_branding` ADD `footer_text` varchar(500);--> statement-breakpoint
ALTER TABLE `tenant_branding` ADD `mobile_theme` varchar(10) DEFAULT 'auto';--> statement-breakpoint
ALTER TABLE `users` ADD `token_version` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `push_token` text;--> statement-breakpoint
ALTER TABLE `warehouse_stock` ADD `warehouse_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `warehouse_stock` ADD `reorder_point` decimal(12,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `uq_orders_idempotency` UNIQUE(`idempotency_key`,`tenant_id`);--> statement-breakpoint
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `commissions` ADD CONSTRAINT `commissions_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `commissions` ADD CONSTRAINT `commissions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `price_list_assignments` ADD CONSTRAINT `price_list_assignments_price_list_id_price_lists_id_fk` FOREIGN KEY (`price_list_id`) REFERENCES `price_lists`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `price_list_assignments` ADD CONSTRAINT `price_list_assignments_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `price_list_items` ADD CONSTRAINT `price_list_items_price_list_id_price_lists_id_fk` FOREIGN KEY (`price_list_id`) REFERENCES `price_lists`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `price_list_items` ADD CONSTRAINT `price_list_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `price_lists` ADD CONSTRAINT `price_lists_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `return_items` ADD CONSTRAINT `return_items_return_id_returns_id_fk` FOREIGN KEY (`return_id`) REFERENCES `returns`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `return_items` ADD CONSTRAINT `return_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `returns` ADD CONSTRAINT `returns_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `returns` ADD CONSTRAINT `returns_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `returns` ADD CONSTRAINT `returns_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `returns` ADD CONSTRAINT `returns_agent_id_users_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `returns` ADD CONSTRAINT `returns_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sales_targets` ADD CONSTRAINT `sales_targets_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sales_targets` ADD CONSTRAINT `sales_targets_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sales_targets` ADD CONSTRAINT `sales_targets_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD CONSTRAINT `stock_transfers_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD CONSTRAINT `stock_transfers_from_warehouse_id_warehouses_id_fk` FOREIGN KEY (`from_warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD CONSTRAINT `stock_transfers_to_warehouse_id_warehouses_id_fk` FOREIGN KEY (`to_warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD CONSTRAINT `stock_transfers_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD CONSTRAINT `stock_transfers_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `territories` ADD CONSTRAINT `territories_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `warehouses` ADD CONSTRAINT `warehouses_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_apikey_tenant` ON `api_keys` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_apikey_prefix` ON `api_keys` (`key_prefix`);--> statement-breakpoint
CREATE INDEX `idx_audit_tenant_created` ON `audit_log` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_tenant_action` ON `audit_log` (`tenant_id`,`action`);--> statement-breakpoint
CREATE INDEX `idx_audit_actor` ON `audit_log` (`actor_id`);--> statement-breakpoint
CREATE INDEX `idx_commissions_tenant` ON `commissions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_commissions_user_period` ON `commissions` (`user_id`,`period_type`,`period_start`);--> statement-breakpoint
CREATE INDEX `idx_reset_user` ON `password_reset_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_pl_assignments_list` ON `price_list_assignments` (`price_list_id`);--> statement-breakpoint
CREATE INDEX `idx_pl_assignments_shop` ON `price_list_assignments` (`shop_id`);--> statement-breakpoint
CREATE INDEX `idx_price_list_items_list` ON `price_list_items` (`price_list_id`);--> statement-breakpoint
CREATE INDEX `idx_price_list_items_product` ON `price_list_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_price_lists_tenant` ON `price_lists` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_price_lists_type` ON `price_lists` (`type`);--> statement-breakpoint
CREATE INDEX `idx_return_items_return` ON `return_items` (`return_id`);--> statement-breakpoint
CREATE INDEX `idx_return_items_product` ON `return_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_returns_tenant` ON `returns` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_returns_order` ON `returns` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_returns_shop` ON `returns` (`shop_id`);--> statement-breakpoint
CREATE INDEX `idx_returns_status` ON `returns` (`status`);--> statement-breakpoint
CREATE INDEX `idx_sales_targets_tenant` ON `sales_targets` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_targets_user_period` ON `sales_targets` (`user_id`,`period_type`,`period_start`);--> statement-breakpoint
CREATE INDEX `idx_sales_targets_tenant_period` ON `sales_targets` (`tenant_id`,`period_type`,`period_start`);--> statement-breakpoint
CREATE INDEX `idx_transfers_tenant` ON `stock_transfers` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_transfers_from` ON `stock_transfers` (`from_warehouse_id`);--> statement-breakpoint
CREATE INDEX `idx_transfers_to` ON `stock_transfers` (`to_warehouse_id`);--> statement-breakpoint
CREATE INDEX `idx_transfers_status` ON `stock_transfers` (`status`);--> statement-breakpoint
CREATE INDEX `idx_territories_tenant` ON `territories` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_warehouses_tenant` ON `warehouses` (`tenant_id`);--> statement-breakpoint
ALTER TABLE `agent_locations` ADD CONSTRAINT `agent_locations_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `agent_locations` ADD CONSTRAINT `agent_locations_agent_id_users_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `arrival_items` ADD CONSTRAINT `arrival_items_arrival_id_arrivals_id_fk` FOREIGN KEY (`arrival_id`) REFERENCES `arrivals`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `arrival_items` ADD CONSTRAINT `arrival_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `arrivals` ADD CONSTRAINT `arrivals_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billing_events` ADD CONSTRAINT `billing_events_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_plans` ADD CONSTRAINT `daily_plans_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_plans` ADD CONSTRAINT `daily_plans_agent_id_users_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_plans` ADD CONSTRAINT `daily_plans_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_plans` ADD CONSTRAINT `daily_plans_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invites` ADD CONSTRAINT `invites_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invites` ADD CONSTRAINT `invites_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_agent_id_users_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_courier_id_users_id_fk` FOREIGN KEY (`courier_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `settings` ADD CONSTRAINT `settings_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shops` ADD CONSTRAINT `shops_territory_id_territories_id_fk` FOREIGN KEY (`territory_id`) REFERENCES `territories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shops` ADD CONSTRAINT `shops_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shops` ADD CONSTRAINT `shops_agent_id_users_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenant_branding` ADD CONSTRAINT `tenant_branding_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visit_reports` ADD CONSTRAINT `visit_reports_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visit_reports` ADD CONSTRAINT `visit_reports_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visit_reports` ADD CONSTRAINT `visit_reports_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visit_reports` ADD CONSTRAINT `visit_reports_plan_id_daily_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `daily_plans`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `warehouse_stock` ADD CONSTRAINT `warehouse_stock_warehouse_id_warehouses_id_fk` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `warehouse_stock` ADD CONSTRAINT `warehouse_stock_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `warehouse_stock` ADD CONSTRAINT `warehouse_stock_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_stock_warehouse` ON `warehouse_stock` (`warehouse_id`);