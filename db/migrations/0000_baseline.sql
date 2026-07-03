CREATE TABLE `agent_locations` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`agent_id` bigint unsigned NOT NULL,
	`lat` decimal(10,8) NOT NULL,
	`lng` decimal(11,8) NOT NULL,
	`accuracy` decimal(8,2),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agent_locations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `arrival_items` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`arrival_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`quantity` decimal(12,2) NOT NULL,
	`condition` varchar(255),
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `arrival_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `arrivals` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`arrival_number` varchar(50) NOT NULL,
	`truck_id` varchar(100),
	`driver_name` varchar(255),
	`driver_phone` varchar(20),
	`status` enum('pending','unloading','completed') NOT NULL DEFAULT 'pending',
	`fuel_cost` decimal(10,2) NOT NULL DEFAULT '0.00',
	`toll_cost` decimal(10,2) NOT NULL DEFAULT '0.00',
	`other_cost` decimal(10,2) NOT NULL DEFAULT '0.00',
	`total_expense` decimal(12,2) NOT NULL DEFAULT '0.00',
	`arrival_date` date NOT NULL,
	`arrival_time` time,
	`unloading_time` time,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `arrivals_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_arrival_number_tenant` UNIQUE(`arrival_number`,`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `billing_events` (
	`id` varchar(36) NOT NULL,
	`tenant_id` bigint unsigned,
	`type` varchar(100) NOT NULL,
	`stripe_event_id` varchar(255),
	`payload` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `billing_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `billing_events_stripe_event_id_unique` UNIQUE(`stripe_event_id`)
);
--> statement-breakpoint
CREATE TABLE `daily_plans` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`agent_id` bigint unsigned NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`plan_date` date NOT NULL,
	`status` enum('planned','visited','skipped') NOT NULL DEFAULT 'planned',
	`notes` text,
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `daily_plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` varchar(36) NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`email` varchar(320) NOT NULL,
	`role` enum('operator','agent','supervisor','merchandiser') NOT NULL,
	`token` varchar(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`accepted_at` timestamp,
	`created_by` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invites_id` PRIMARY KEY(`id`),
	CONSTRAINT `invites_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`type` enum('order','payment','stock','system') NOT NULL,
	`title` varchar(255) NOT NULL,
	`message` text,
	`is_read` boolean NOT NULL DEFAULT false,
	`link` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`quantity` decimal(10,2) NOT NULL,
	`unit_price` decimal(10,2) NOT NULL,
	`subtotal` decimal(12,2) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`order_number` varchar(50) NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`agent_id` bigint unsigned NOT NULL,
	`status` enum('new','processing','completed','cancelled') NOT NULL DEFAULT 'new',
	`subtotal` decimal(12,2) NOT NULL DEFAULT '0.00',
	`discount` decimal(12,2) NOT NULL DEFAULT '0.00',
	`total` decimal(12,2) NOT NULL DEFAULT '0.00',
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_order_number_tenant` UNIQUE(`order_number`,`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`type` enum('payment','debt') NOT NULL DEFAULT 'payment',
	`notes` text,
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`code` varchar(50) NOT NULL,
	`name` varchar(255) NOT NULL,
	`category` varchar(100),
	`cost_price` decimal(10,2) NOT NULL DEFAULT '0.00',
	`unit_price` decimal(10,2) NOT NULL,
	`unit` enum('kg','l','pcs','box','pack','m') NOT NULL DEFAULT 'pcs',
	`unit_weight` decimal(10,3) NOT NULL DEFAULT '0.000',
	`description` text,
	`photo_url` text,
	`reorder_point` decimal(10,2) NOT NULL DEFAULT '10.00',
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_product_code_tenant` UNIQUE(`code`,`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`company_name` varchar(255) NOT NULL DEFAULT 'Warehouse Pro',
	`currency` varchar(10) NOT NULL DEFAULT 'CNY',
	`currency_symbol` varchar(10) NOT NULL DEFAULT '¥',
	`default_reorder_point` decimal(10,2) NOT NULL DEFAULT '10.00',
	`low_stock_threshold` decimal(10,2) NOT NULL DEFAULT '50.00',
	`symbol_position` enum('before','after') NOT NULL DEFAULT 'after',
	`company_address` text,
	`company_phone` varchar(50),
	`company_inn` varchar(50),
	`company_director` varchar(255),
	`company_bank` varchar(255),
	`company_bank_account` varchar(50),
	`company_mfo` varchar(20),
	`logo_url` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `settings_tenant_id_unique` UNIQUE(`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `shops` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`owner_name` varchar(255),
	`phone` varchar(20),
	`address` varchar(500),
	`city` varchar(100),
	`district` varchar(100),
	`photo_url` text,
	`gps_lat` decimal(10,8),
	`gps_lng` decimal(11,8),
	`agent_id` bigint unsigned,
	`debt` decimal(12,2) NOT NULL DEFAULT '0.00',
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shops_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`type` enum('in','out','adjustment') NOT NULL,
	`quantity` decimal(12,2) NOT NULL,
	`reference_type` varchar(50),
	`reference_id` bigint unsigned,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stock_movements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` varchar(36) NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`stripe_subscription_id` varchar(255),
	`stripe_customer_id` varchar(255),
	`plan` enum('trial','basic','pro') NOT NULL DEFAULT 'trial',
	`status` enum('trialing','active','past_due','canceled','incomplete') NOT NULL DEFAULT 'trialing',
	`trial_ends_at` timestamp,
	`current_period_ends` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `subscriptions_tenant_id_unique` UNIQUE(`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`slug` varchar(100) NOT NULL,
	`name` varchar(255) NOT NULL,
	`plan` enum('trial','basic','pro') NOT NULL DEFAULT 'trial',
	`status` enum('active','suspended') NOT NULL DEFAULT 'active',
	`trial_ends_at` timestamp,
	`plan_expires_at` timestamp,
	`max_users` bigint unsigned,
	`max_products` bigint unsigned,
	`max_orders_month` bigint unsigned,
	`owner_email` varchar(320),
	`owner_phone` varchar(30),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tenants_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenants_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`password_hash` varchar(512) NOT NULL,
	`avatar` text,
	`phone` varchar(20),
	`role` enum('superadmin','ceo','operator','agent','supervisor','merchandiser') NOT NULL DEFAULT 'agent',
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`lastSignInAt` timestamp NOT NULL DEFAULT (now()),
	`telegram_chat_id` varchar(50),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_user_email_tenant` UNIQUE(`email`,`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `warehouse_stock` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`current_stock` decimal(12,2) NOT NULL DEFAULT '0.00',
	`reserved` decimal(12,2) NOT NULL DEFAULT '0.00',
	`available` decimal(12,2) NOT NULL DEFAULT '0.00',
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `warehouse_stock_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_stock_product_tenant` UNIQUE(`product_id`,`tenant_id`)
);
--> statement-breakpoint
ALTER TABLE `agent_locations` ADD CONSTRAINT `agent_locations_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `agent_locations` ADD CONSTRAINT `agent_locations_agent_id_users_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `arrival_items` ADD CONSTRAINT `arrival_items_arrival_id_arrivals_id_fk` FOREIGN KEY (`arrival_id`) REFERENCES `arrivals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `arrival_items` ADD CONSTRAINT `arrival_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `arrivals` ADD CONSTRAINT `arrivals_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billing_events` ADD CONSTRAINT `billing_events_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_plans` ADD CONSTRAINT `daily_plans_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_plans` ADD CONSTRAINT `daily_plans_agent_id_users_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_plans` ADD CONSTRAINT `daily_plans_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_plans` ADD CONSTRAINT `daily_plans_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invites` ADD CONSTRAINT `invites_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invites` ADD CONSTRAINT `invites_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_agent_id_users_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `settings` ADD CONSTRAINT `settings_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shops` ADD CONSTRAINT `shops_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shops` ADD CONSTRAINT `shops_agent_id_users_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `warehouse_stock` ADD CONSTRAINT `warehouse_stock_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `warehouse_stock` ADD CONSTRAINT `warehouse_stock_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_locations_tenant` ON `agent_locations` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_arrivals_tenant` ON `arrivals` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_billing_events_tenant` ON `billing_events` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_plans_tenant` ON `daily_plans` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_invites_token` ON `invites` (`token`);--> statement-breakpoint
CREATE INDEX `idx_invites_tenant` ON `invites` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_notif_tenant` ON `notifications` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_tenant` ON `orders` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_tenant` ON `payments` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_products_tenant` ON `products` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_shops_tenant` ON `shops` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_shops_city` ON `shops` (`city`);--> statement-breakpoint
CREATE INDEX `idx_shops_district` ON `shops` (`district`);--> statement-breakpoint
CREATE INDEX `idx_movements_tenant` ON `stock_movements` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sub_tenant` ON `subscriptions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sub_stripe` ON `subscriptions` (`stripe_subscription_id`);--> statement-breakpoint
CREATE INDEX `idx_users_tenant` ON `users` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_stock_tenant` ON `warehouse_stock` (`tenant_id`);