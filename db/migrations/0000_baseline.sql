CREATE TABLE `agent_locations` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`agent_id` bigint unsigned NOT NULL,
	`lat` decimal(10,8) NOT NULL,
	`lng` decimal(11,8) NOT NULL,
	`accuracy` decimal(8,2),
	`battery_level` int,
	`recorded_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agent_locations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
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
CREATE TABLE `arrival_items` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`arrival_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`quantity` decimal(12,2) NOT NULL,
	`cost_price` decimal(10,2) DEFAULT '0.00',
	`selling_price` decimal(10,2) DEFAULT '0.00',
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
CREATE TABLE `billing_events` (
	`id` varchar(36) NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`type` varchar(100) NOT NULL,
	`stripe_event_id` varchar(255),
	`payload` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `billing_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `billing_events_stripe_event_id_unique` UNIQUE(`stripe_event_id`)
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
CREATE TABLE `daily_plans` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`agent_id` bigint unsigned NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`plan_date` date NOT NULL,
	`status` enum('planned','visited','skipped') NOT NULL DEFAULT 'planned',
	`visited_at` timestamp,
	`photo_url` mediumtext,
	`notes` text,
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `daily_plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `debt_reminders` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`order_id` bigint unsigned,
	`amount` decimal(15,2) NOT NULL,
	`due_date` date NOT NULL,
	`sent_at` timestamp,
	`paid_at` timestamp,
	`status` enum('pending','sent','paid','overdue') NOT NULL DEFAULT 'pending',
	`reminder_count` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `debt_reminders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
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
CREATE TABLE `invites` (
	`id` varchar(36) NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`email` varchar(320) NOT NULL,
	`role` enum('operator','agent','supervisor','merchandiser','courier') NOT NULL,
	`token` varchar(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`accepted_at` timestamp,
	`created_by` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invites_id` PRIMARY KEY(`id`),
	CONSTRAINT `invites_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`company` varchar(200),
	`phone` varchar(32) NOT NULL,
	`comment` text,
	`source` varchar(64),
	`notified` boolean NOT NULL DEFAULT false,
	`handled_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `leads_id` PRIMARY KEY(`id`)
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
CREATE TABLE `onec_config` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`url` varchar(500) NOT NULL,
	`username` varchar(100) NOT NULL,
	`password` varchar(500) NOT NULL,
	`sync_products` boolean DEFAULT true,
	`sync_orders` boolean DEFAULT true,
	`interval_minutes` int DEFAULT 60,
	`last_tested_at` timestamp,
	`last_test_ok` boolean,
	`webhook_secret_hash` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `onec_config_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_onec_config_tenant` UNIQUE(`tenant_id`),
	CONSTRAINT `uq_onec_webhook_secret` UNIQUE(`webhook_secret_hash`)
);
--> statement-breakpoint
CREATE TABLE `order_adjustments` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	`adjusted_by` bigint unsigned NOT NULL,
	`type` enum('partial_delivery','partial_payment','price_change','quantity_change') NOT NULL,
	`old_value` json NOT NULL,
	`new_value` json NOT NULL,
	`reason` text,
	`photos` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_adjustments_id` PRIMARY KEY(`id`)
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
CREATE TABLE `order_items` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`quantity` decimal(10,2) NOT NULL,
	`unit_price` decimal(10,2) NOT NULL,
	`cost_price` decimal(10,2) NOT NULL DEFAULT '0.00',
	`subtotal` decimal(12,2) NOT NULL,
	`delivered_quantity` decimal(10,2),
	`return_reason` varchar(100),
	`return_photos` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_order_items_order_product` UNIQUE(`order_id`,`product_id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`order_number` varchar(50) NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`agent_id` bigint unsigned NOT NULL,
	`status` enum('new','processing','shipped','pending','delivered','cancelled','returned') NOT NULL DEFAULT 'new',
	`subtotal` decimal(12,2) NOT NULL DEFAULT '0.00',
	`discount` decimal(12,2) NOT NULL DEFAULT '0.00',
	`total` decimal(12,2) NOT NULL DEFAULT '0.00',
	`notes` text,
	`idempotency_key` varchar(64),
	`courier_id` bigint unsigned,
	`payment_method` enum('cash','card','transfer','debt') NOT NULL DEFAULT 'cash',
	`delivery_status` enum('not_assigned','assigned','out_for_delivery','delivered','failed') NOT NULL DEFAULT 'not_assigned',
	`delivered_at` timestamp,
	`invoice_printed_at` timestamp,
	`delivery_result` varchar(30),
	`delivery_notes` text,
	`priority` enum('low','normal','high') NOT NULL DEFAULT 'normal',
	`deleted_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_order_number_tenant` UNIQUE(`order_number`,`tenant_id`),
	CONSTRAINT `uq_orders_idempotency` UNIQUE(`idempotency_key`,`tenant_id`)
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
CREATE TABLE `payments` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`order_id` bigint unsigned,
	`amount` decimal(12,2) NOT NULL,
	`type` enum('payment','debt') NOT NULL DEFAULT 'payment',
	`payment_method` enum('cash','card','transfer') DEFAULT 'cash',
	`status` varchar(30) DEFAULT 'paid',
	`total_order_amount` decimal(15,2),
	`paid_amount` decimal(15,2),
	`debt_amount` decimal(15,2) DEFAULT '0.00',
	`debt_due_date` date,
	`paid_at` timestamp,
	`notes` text,
	`idempotency_key` varchar(100),
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_payments_idempotency` UNIQUE(`tenant_id`,`idempotency_key`)
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
CREATE TABLE `products` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`code` varchar(50) NOT NULL,
	`barcode` varchar(100),
	`name` varchar(255) NOT NULL,
	`category` varchar(100),
	`cost_price` decimal(10,2) NOT NULL DEFAULT '0.00',
	`unit_price` decimal(10,2) NOT NULL,
	`unit` enum('kg','l','pcs','box','pack','m','block') NOT NULL DEFAULT 'pcs',
	`unit_weight` decimal(10,3) NOT NULL DEFAULT '0.000',
	`description` text,
	`photo_url` mediumtext,
	`reorder_point` decimal(10,2) NOT NULL DEFAULT '0.00',
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_product_code_tenant` UNIQUE(`code`,`tenant_id`)
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
	`territory_id` bigint unsigned,
	`period_type` enum('daily','weekly','monthly') NOT NULL DEFAULT 'monthly',
	`period_start` date NOT NULL,
	`period_end` date NOT NULL,
	`target_amount` decimal(14,2) NOT NULL,
	`actual_amount` decimal(14,2) NOT NULL DEFAULT '0.00',
	`order_count_target` int,
	`visit_target` decimal(5,2),
	`actual_order_count` int NOT NULL DEFAULT 0,
	`actual_visit_pct` decimal(5,2) NOT NULL DEFAULT '0.00',
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sales_targets_id` PRIMARY KEY(`id`)
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
CREATE TABLE `settings` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`company_name` varchar(255) NOT NULL DEFAULT 'Warehouse Pro',
	`currency` varchar(10) NOT NULL DEFAULT 'UZS',
	`currency_symbol` varchar(10) NOT NULL DEFAULT 'сум',
	`default_reorder_point` decimal(10,2) NOT NULL DEFAULT '0.00',
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
	`photo_url` mediumtext,
	`gps_lat` decimal(10,8),
	`gps_lng` decimal(11,8),
	`agent_id` bigint unsigned,
	`territory_id` bigint unsigned,
	`debt` decimal(12,2) NOT NULL DEFAULT '0.00',
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`notes` text,
	`idempotency_key` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shops_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_shops_idempotency` UNIQUE(`tenant_id`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`warehouse_id` bigint unsigned,
	`type` enum('in','out','adjustment') NOT NULL,
	`quantity` decimal(12,2) NOT NULL,
	`reference_type` varchar(50),
	`reference_id` bigint unsigned,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stock_movements_id` PRIMARY KEY(`id`)
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
CREATE TABLE `subscriptions` (
	`id` varchar(36) NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`stripe_subscription_id` varchar(255),
	`stripe_customer_id` varchar(255),
	`plan` enum('trial','basic','pro','exclusive') NOT NULL DEFAULT 'trial',
	`status` enum('trialing','active','past_due','canceled','incomplete') NOT NULL DEFAULT 'trialing',
	`trial_ends_at` timestamp,
	`current_period_ends` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `subscriptions_tenant_id_unique` UNIQUE(`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `supplier_payments` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`supplier_id` bigint unsigned NOT NULL,
	`supply_id` bigint unsigned NOT NULL,
	`amount` decimal(15,2) NOT NULL,
	`paid_uzs` decimal(15,2),
	`rate_to_uzs` decimal(12,4),
	`payment_method` enum('cash','card','transfer') NOT NULL DEFAULT 'transfer',
	`paid_at` timestamp NOT NULL DEFAULT (now()),
	`notes` text,
	`created_by` bigint unsigned,
	`idempotency_key` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `supplier_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_supplier_payment_idem` UNIQUE(`idempotency_key`,`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`contact_name` varchar(255),
	`phone` varchar(32),
	`inn` varchar(32),
	`address` varchar(500),
	`notes` text,
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `suppliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_supplier_name_tenant` UNIQUE(`name`,`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `supplies` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`supplier_id` bigint unsigned NOT NULL,
	`arrival_id` bigint unsigned,
	`supply_number` varchar(50) NOT NULL,
	`amount` decimal(15,2) NOT NULL,
	`currency` enum('UZS','USD') NOT NULL DEFAULT 'UZS',
	`rate_to_uzs` decimal(12,4),
	`supply_date` date NOT NULL,
	`due_date` date,
	`notes` text,
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `supplies_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_supply_number_tenant` UNIQUE(`supply_number`,`tenant_id`)
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
	`custom_domain` varchar(255),
	`favicon_url` varchar(500),
	`login_title` varchar(100),
	`login_subtitle` varchar(255),
	`footer_text` varchar(500),
	`mobile_theme` varchar(10) DEFAULT 'auto',
	`inn` varchar(20),
	`legal_address` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tenant_branding_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenant_branding_tenant_id_unique` UNIQUE(`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`slug` varchar(100) NOT NULL,
	`name` varchar(255) NOT NULL,
	`plan` enum('trial','basic','pro','exclusive') NOT NULL DEFAULT 'trial',
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
CREATE TABLE `territories` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`color` varchar(7),
	`center_lat` decimal(10,8),
	`center_lng` decimal(11,8),
	`radius_km` decimal(6,2) DEFAULT '10.00',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `territories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`password_hash` varchar(512) NOT NULL,
	`avatar` mediumtext,
	`phone` varchar(20),
	`role` enum('superadmin','ceo','operator','agent','supervisor','merchandiser','courier') NOT NULL DEFAULT 'agent',
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`token_version` int NOT NULL DEFAULT 0,
	`push_token` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`lastSignInAt` timestamp NOT NULL DEFAULT (now()),
	`telegram_chat_id` varchar(50),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_user_email_tenant` UNIQUE(`email`,`tenant_id`)
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
CREATE TABLE `warehouse_stock` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`warehouse_id` bigint unsigned,
	`product_id` bigint unsigned NOT NULL,
	`current_stock` decimal(12,2) NOT NULL DEFAULT '0.00',
	`reserved` decimal(12,2) NOT NULL DEFAULT '0.00',
	`available` decimal(12,2) NOT NULL DEFAULT '0.00',
	`reorder_point` decimal(12,2) NOT NULL DEFAULT '0.00',
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `warehouse_stock_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_stock_product_warehouse_tenant` UNIQUE(`product_id`,`warehouse_id`,`tenant_id`)
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
ALTER TABLE `agent_locations` ADD CONSTRAINT `agent_locations_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `agent_locations` ADD CONSTRAINT `agent_locations_agent_id_users_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `agent_territories` ADD CONSTRAINT `agent_territories_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `agent_territories` ADD CONSTRAINT `agent_territories_agent_id_users_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `agent_territories` ADD CONSTRAINT `agent_territories_territory_id_territories_id_fk` FOREIGN KEY (`territory_id`) REFERENCES `territories`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `arrival_items` ADD CONSTRAINT `arrival_items_arrival_id_arrivals_id_fk` FOREIGN KEY (`arrival_id`) REFERENCES `arrivals`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `arrival_items` ADD CONSTRAINT `arrival_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `arrivals` ADD CONSTRAINT `arrivals_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billing_events` ADD CONSTRAINT `billing_events_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `commissions` ADD CONSTRAINT `commissions_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `commissions` ADD CONSTRAINT `commissions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_plans` ADD CONSTRAINT `daily_plans_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_plans` ADD CONSTRAINT `daily_plans_agent_id_users_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_plans` ADD CONSTRAINT `daily_plans_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_plans` ADD CONSTRAINT `daily_plans_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `debt_reminders` ADD CONSTRAINT `debt_reminders_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `debt_reminders` ADD CONSTRAINT `debt_reminders_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `debt_reminders` ADD CONSTRAINT `debt_reminders_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invites` ADD CONSTRAINT `invites_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invites` ADD CONSTRAINT `invites_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loading_list_orders` ADD CONSTRAINT `loading_list_orders_list_id_loading_lists_id_fk` FOREIGN KEY (`list_id`) REFERENCES `loading_lists`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loading_list_orders` ADD CONSTRAINT `loading_list_orders_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loading_lists` ADD CONSTRAINT `loading_lists_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loading_lists` ADD CONSTRAINT `loading_lists_warehouse_id_warehouses_id_fk` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loading_lists` ADD CONSTRAINT `loading_lists_agent_id_users_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loading_lists` ADD CONSTRAINT `loading_lists_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `onec_config` ADD CONSTRAINT `onec_config_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_adjustments` ADD CONSTRAINT `order_adjustments_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_adjustments` ADD CONSTRAINT `order_adjustments_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_adjustments` ADD CONSTRAINT `order_adjustments_adjusted_by_users_id_fk` FOREIGN KEY (`adjusted_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_comments` ADD CONSTRAINT `order_comments_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_comments` ADD CONSTRAINT `order_comments_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_comments` ADD CONSTRAINT `order_comments_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_agent_id_users_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_courier_id_users_id_fk` FOREIGN KEY (`courier_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `price_list_assignments` ADD CONSTRAINT `price_list_assignments_price_list_id_price_lists_id_fk` FOREIGN KEY (`price_list_id`) REFERENCES `price_lists`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `price_list_assignments` ADD CONSTRAINT `price_list_assignments_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `price_list_items` ADD CONSTRAINT `price_list_items_price_list_id_price_lists_id_fk` FOREIGN KEY (`price_list_id`) REFERENCES `price_lists`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `price_list_items` ADD CONSTRAINT `price_list_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `price_lists` ADD CONSTRAINT `price_lists_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE `sales_targets` ADD CONSTRAINT `sales_targets_territory_id_territories_id_fk` FOREIGN KEY (`territory_id`) REFERENCES `territories`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `saved_filters` ADD CONSTRAINT `saved_filters_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `saved_filters` ADD CONSTRAINT `saved_filters_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `settings` ADD CONSTRAINT `settings_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shops` ADD CONSTRAINT `shops_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shops` ADD CONSTRAINT `shops_agent_id_users_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shops` ADD CONSTRAINT `shops_territory_id_territories_id_fk` FOREIGN KEY (`territory_id`) REFERENCES `territories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_warehouse_id_warehouses_id_fk` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD CONSTRAINT `stock_transfers_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD CONSTRAINT `stock_transfers_from_warehouse_id_warehouses_id_fk` FOREIGN KEY (`from_warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD CONSTRAINT `stock_transfers_to_warehouse_id_warehouses_id_fk` FOREIGN KEY (`to_warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD CONSTRAINT `stock_transfers_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD CONSTRAINT `stock_transfers_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payments_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payments_supplier_id_suppliers_id_fk` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payments_supply_id_supplies_id_fk` FOREIGN KEY (`supply_id`) REFERENCES `supplies`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payments_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `suppliers` ADD CONSTRAINT `suppliers_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplies` ADD CONSTRAINT `supplies_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplies` ADD CONSTRAINT `supplies_supplier_id_suppliers_id_fk` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplies` ADD CONSTRAINT `supplies_arrival_id_arrivals_id_fk` FOREIGN KEY (`arrival_id`) REFERENCES `arrivals`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplies` ADD CONSTRAINT `supplies_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenant_branding` ADD CONSTRAINT `tenant_branding_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `territories` ADD CONSTRAINT `territories_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visit_reports` ADD CONSTRAINT `visit_reports_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visit_reports` ADD CONSTRAINT `visit_reports_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visit_reports` ADD CONSTRAINT `visit_reports_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visit_reports` ADD CONSTRAINT `visit_reports_plan_id_daily_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `daily_plans`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visit_schedules` ADD CONSTRAINT `visit_schedules_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visit_schedules` ADD CONSTRAINT `visit_schedules_agent_id_users_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visit_schedules` ADD CONSTRAINT `visit_schedules_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visit_schedules` ADD CONSTRAINT `visit_schedules_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `warehouse_stock` ADD CONSTRAINT `warehouse_stock_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `warehouse_stock` ADD CONSTRAINT `warehouse_stock_warehouse_id_warehouses_id_fk` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `warehouse_stock` ADD CONSTRAINT `warehouse_stock_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `warehouses` ADD CONSTRAINT `warehouses_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_locations_tenant` ON `agent_locations` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_locations_tenant_agent` ON `agent_locations` (`tenant_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_locations_tenant_created` ON `agent_locations` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_territories_tenant` ON `agent_territories` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_territories_agent` ON `agent_territories` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_territories_territory` ON `agent_territories` (`territory_id`);--> statement-breakpoint
CREATE INDEX `idx_apikey_tenant` ON `api_keys` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_apikey_prefix` ON `api_keys` (`key_prefix`);--> statement-breakpoint
CREATE INDEX `idx_arrival_items_arrival` ON `arrival_items` (`arrival_id`);--> statement-breakpoint
CREATE INDEX `idx_arrival_items_product` ON `arrival_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_arrivals_tenant` ON `arrivals` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_arrivals_tenant_status` ON `arrivals` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_audit_tenant_created` ON `audit_log` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_tenant_action` ON `audit_log` (`tenant_id`,`action`);--> statement-breakpoint
CREATE INDEX `idx_audit_actor` ON `audit_log` (`actor_id`);--> statement-breakpoint
CREATE INDEX `idx_billing_events_tenant` ON `billing_events` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_commissions_tenant` ON `commissions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_commissions_user_period` ON `commissions` (`user_id`,`period_type`,`period_start`);--> statement-breakpoint
CREATE INDEX `idx_plans_tenant` ON `daily_plans` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_plans_tenant_date` ON `daily_plans` (`tenant_id`,`plan_date`);--> statement-breakpoint
CREATE INDEX `idx_plans_tenant_agent` ON `daily_plans` (`tenant_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_plans_shop` ON `daily_plans` (`shop_id`);--> statement-breakpoint
CREATE INDEX `idx_plans_status` ON `daily_plans` (`status`);--> statement-breakpoint
CREATE INDEX `idx_reminders_tenant` ON `debt_reminders` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_reminders_shop` ON `debt_reminders` (`shop_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_reminders_due` ON `debt_reminders` (`due_date`,`status`);--> statement-breakpoint
CREATE INDEX `idx_mapping_internal` ON `id_mappings` (`tenant_id`,`entity_type`,`internal_id`);--> statement-breakpoint
CREATE INDEX `idx_invites_token` ON `invites` (`token`);--> statement-breakpoint
CREATE INDEX `idx_invites_tenant` ON `invites` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_leads_created` ON `leads` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_leads_notified` ON `leads` (`notified`);--> statement-breakpoint
CREATE INDEX `idx_llo_order` ON `loading_list_orders` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_lists_tenant_status` ON `loading_lists` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_lists_agent` ON `loading_lists` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_notif_tenant` ON `notifications` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_notif_user_tenant` ON `notifications` (`user_id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_notif_user_tenant_read` ON `notifications` (`user_id`,`tenant_id`,`is_read`);--> statement-breakpoint
CREATE INDEX `idx_adjustments_order` ON `order_adjustments` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_adjustments_tenant` ON `order_adjustments` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_comments_order` ON `order_comments` (`order_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_order_items_order` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_order_items_product` ON `order_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_tenant` ON `orders` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_tenant_status` ON `orders` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_orders_tenant_agent` ON `orders` (`tenant_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_tenant_date` ON `orders` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_orders_shop` ON `orders` (`shop_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_agent` ON `orders` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_status` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `idx_orders_created_at` ON `orders` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_orders_tenant_deleted` ON `orders` (`tenant_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_orders_courier_date` ON `orders` (`tenant_id`,`courier_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_orders_deleted_at` ON `orders` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_orders_payment_method` ON `orders` (`tenant_id`,`payment_method`);--> statement-breakpoint
CREATE INDEX `idx_reset_user` ON `password_reset_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_tenant` ON `payments` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_shop` ON `payments` (`shop_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_order` ON `payments` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_tenant_shop` ON `payments` (`tenant_id`,`shop_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_created_at` ON `payments` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_pl_assignments_list` ON `price_list_assignments` (`price_list_id`);--> statement-breakpoint
CREATE INDEX `idx_pl_assignments_shop` ON `price_list_assignments` (`shop_id`);--> statement-breakpoint
CREATE INDEX `idx_price_list_items_list` ON `price_list_items` (`price_list_id`);--> statement-breakpoint
CREATE INDEX `idx_price_list_items_product` ON `price_list_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_price_lists_tenant` ON `price_lists` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_price_lists_type` ON `price_lists` (`type`);--> statement-breakpoint
CREATE INDEX `idx_products_tenant` ON `products` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_products_barcode` ON `products` (`barcode`);--> statement-breakpoint
CREATE INDEX `idx_products_tenant_category` ON `products` (`tenant_id`,`category`);--> statement-breakpoint
CREATE INDEX `idx_products_tenant_status` ON `products` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_return_items_return` ON `return_items` (`return_id`);--> statement-breakpoint
CREATE INDEX `idx_return_items_product` ON `return_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_returns_tenant` ON `returns` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_returns_agent_date` ON `returns` (`tenant_id`,`agent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_returns_order` ON `returns` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_returns_shop` ON `returns` (`shop_id`);--> statement-breakpoint
CREATE INDEX `idx_returns_status` ON `returns` (`status`);--> statement-breakpoint
CREATE INDEX `idx_sales_targets_tenant` ON `sales_targets` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_targets_user_period` ON `sales_targets` (`user_id`,`period_type`,`period_start`);--> statement-breakpoint
CREATE INDEX `idx_sales_targets_tenant_period` ON `sales_targets` (`tenant_id`,`period_type`,`period_start`);--> statement-breakpoint
CREATE INDEX `idx_sales_targets_territory` ON `sales_targets` (`territory_id`);--> statement-breakpoint
CREATE INDEX `idx_filters_user` ON `saved_filters` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_shops_tenant` ON `shops` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_shops_city` ON `shops` (`city`);--> statement-breakpoint
CREATE INDEX `idx_shops_district` ON `shops` (`district`);--> statement-breakpoint
CREATE INDEX `idx_shops_agent` ON `shops` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_shops_tenant_status` ON `shops` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_movements_tenant` ON `stock_movements` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_movements_product` ON `stock_movements` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_movements_warehouse` ON `stock_movements` (`warehouse_id`);--> statement-breakpoint
CREATE INDEX `idx_movements_tenant_product` ON `stock_movements` (`tenant_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `idx_movements_tenant_created` ON `stock_movements` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_transfers_tenant` ON `stock_transfers` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_transfers_from` ON `stock_transfers` (`from_warehouse_id`);--> statement-breakpoint
CREATE INDEX `idx_transfers_to` ON `stock_transfers` (`to_warehouse_id`);--> statement-breakpoint
CREATE INDEX `idx_transfers_status` ON `stock_transfers` (`status`);--> statement-breakpoint
CREATE INDEX `idx_sub_tenant` ON `subscriptions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sub_stripe` ON `subscriptions` (`stripe_subscription_id`);--> statement-breakpoint
CREATE INDEX `idx_supplier_payments_tenant` ON `supplier_payments` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_supplier_payments_supply` ON `supplier_payments` (`supply_id`);--> statement-breakpoint
CREATE INDEX `idx_supplier_payments_tenant_supplier` ON `supplier_payments` (`tenant_id`,`supplier_id`,`paid_at`);--> statement-breakpoint
CREATE INDEX `idx_suppliers_tenant` ON `suppliers` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_suppliers_tenant_status` ON `suppliers` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_supplies_tenant` ON `supplies` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_supplies_tenant_supplier_date` ON `supplies` (`tenant_id`,`supplier_id`,`supply_date`);--> statement-breakpoint
CREATE INDEX `idx_supplies_tenant_due` ON `supplies` (`tenant_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_sync_status_tenant` ON `sync_status` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sync_status_entity` ON `sync_status` (`tenant_id`,`entity_type`);--> statement-breakpoint
CREATE INDEX `idx_branding_tenant` ON `tenant_branding` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_territories_tenant` ON `territories` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_users_tenant` ON `users` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_vr_tenant_shop` ON `visit_reports` (`tenant_id`,`shop_id`);--> statement-breakpoint
CREATE INDEX `idx_vr_tenant_plan` ON `visit_reports` (`tenant_id`,`plan_id`);--> statement-breakpoint
CREATE INDEX `idx_vr_tenant_user` ON `visit_reports` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_visit_reports_user_date` ON `visit_reports` (`tenant_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_schedules_tenant` ON `visit_schedules` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_schedules_agent` ON `visit_schedules` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_schedules_shop` ON `visit_schedules` (`shop_id`);--> statement-breakpoint
CREATE INDEX `idx_schedules_tenant_agent` ON `visit_schedules` (`tenant_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_stock_tenant` ON `warehouse_stock` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_stock_warehouse` ON `warehouse_stock` (`warehouse_id`);--> statement-breakpoint
CREATE INDEX `idx_warehouses_tenant` ON `warehouses` (`tenant_id`);