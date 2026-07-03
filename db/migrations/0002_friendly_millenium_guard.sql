CREATE TABLE `id_mappings` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`entity_type` varchar(50) NOT NULL,
	`external_id` varchar(100) NOT NULL,
	`internal_id` bigint unsigned NOT NULL,
	`last_synced_at` timestamp DEFAULT (now()),
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `id_mappings_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_mapping` UNIQUE(`tenant_id`,`entity_type`,`external_id`)
);
--> statement-breakpoint
CREATE TABLE `sync_status` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`entity_type` varchar(50) NOT NULL,
	`direction` varchar(20) NOT NULL,
	`status` varchar(20) NOT NULL,
	`records_processed` int DEFAULT 0,
	`last_successful_sync` timestamp,
	`error_count` int DEFAULT 0,
	`last_error` text,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `sync_status_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tenant_branding` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`logo_url` text,
	`primary_color` varchar(7) DEFAULT '#2563eb',
	`secondary_color` varchar(7) DEFAULT '#1e40af',
	`accent_color` varchar(7) DEFAULT '#3b82f6',
	`company_name` varchar(255),
	`app_name` varchar(255) DEFAULT 'Warehouse Pro',
	`support_email` varchar(320),
	`support_phone` varchar(50),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tenant_branding_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenant_branding_tenant_id_unique` UNIQUE(`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `visit_reports` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`plan_id` bigint unsigned NOT NULL,
	`photos` json DEFAULT ('[]'),
	`checklist` json DEFAULT ('[]'),
	`competitor_notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `visit_reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `invites` MODIFY COLUMN `role` enum('operator','agent','supervisor','merchandiser','courier') NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` MODIFY COLUMN `currency` varchar(10) NOT NULL DEFAULT 'UZS';--> statement-breakpoint
ALTER TABLE `settings` MODIFY COLUMN `currency_symbol` varchar(10) NOT NULL DEFAULT 'сум';--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('superadmin','ceo','operator','agent','supervisor','merchandiser','courier') NOT NULL DEFAULT 'agent';--> statement-breakpoint
ALTER TABLE `orders` ADD `courier_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_status` enum('not_assigned','assigned','out_for_delivery','delivered','failed') DEFAULT 'not_assigned' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivered_at` timestamp;--> statement-breakpoint
ALTER TABLE `products` ADD `barcode` varchar(100);--> statement-breakpoint
ALTER TABLE `tenant_branding` ADD CONSTRAINT `tenant_branding_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visit_reports` ADD CONSTRAINT `visit_reports_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visit_reports` ADD CONSTRAINT `visit_reports_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visit_reports` ADD CONSTRAINT `visit_reports_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visit_reports` ADD CONSTRAINT `visit_reports_plan_id_daily_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `daily_plans`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_mapping_internal` ON `id_mappings` (`tenant_id`,`entity_type`,`internal_id`);--> statement-breakpoint
CREATE INDEX `idx_sync_status_tenant` ON `sync_status` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sync_status_entity` ON `sync_status` (`tenant_id`,`entity_type`);--> statement-breakpoint
CREATE INDEX `idx_branding_tenant` ON `tenant_branding` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_vr_tenant_shop` ON `visit_reports` (`tenant_id`,`shop_id`);--> statement-breakpoint
CREATE INDEX `idx_vr_tenant_plan` ON `visit_reports` (`tenant_id`,`plan_id`);--> statement-breakpoint
CREATE INDEX `idx_vr_tenant_user` ON `visit_reports` (`tenant_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_courier_id_users_id_fk` FOREIGN KEY (`courier_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_locations_tenant_agent` ON `agent_locations` (`tenant_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_locations_tenant_created` ON `agent_locations` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_arrival_items_arrival` ON `arrival_items` (`arrival_id`);--> statement-breakpoint
CREATE INDEX `idx_arrival_items_product` ON `arrival_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_arrivals_tenant_status` ON `arrivals` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_plans_tenant_date` ON `daily_plans` (`tenant_id`,`plan_date`);--> statement-breakpoint
CREATE INDEX `idx_plans_tenant_agent` ON `daily_plans` (`tenant_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_plans_shop` ON `daily_plans` (`shop_id`);--> statement-breakpoint
CREATE INDEX `idx_plans_status` ON `daily_plans` (`status`);--> statement-breakpoint
CREATE INDEX `idx_notif_user_tenant` ON `notifications` (`user_id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_notif_user_tenant_read` ON `notifications` (`user_id`,`tenant_id`,`is_read`);--> statement-breakpoint
CREATE INDEX `idx_order_items_order` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_order_items_product` ON `order_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_tenant_status` ON `orders` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_orders_tenant_agent` ON `orders` (`tenant_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_tenant_date` ON `orders` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_orders_shop` ON `orders` (`shop_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_agent` ON `orders` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_status` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `idx_orders_created_at` ON `orders` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_payments_shop` ON `payments` (`shop_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_tenant_shop` ON `payments` (`tenant_id`,`shop_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_created_at` ON `payments` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_products_barcode` ON `products` (`barcode`);--> statement-breakpoint
CREATE INDEX `idx_products_tenant_category` ON `products` (`tenant_id`,`category`);--> statement-breakpoint
CREATE INDEX `idx_products_tenant_status` ON `products` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_shops_agent` ON `shops` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_shops_tenant_status` ON `shops` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_movements_product` ON `stock_movements` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_movements_tenant_product` ON `stock_movements` (`tenant_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `idx_movements_tenant_created` ON `stock_movements` (`tenant_id`,`created_at`);