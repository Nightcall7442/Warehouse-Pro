CREATE TABLE `tare_movements` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`tare_type_id` bigint unsigned NOT NULL,
	`holder_kind` enum('warehouse','shop') NOT NULL,
	`holder_id` bigint unsigned NOT NULL,
	`delta` decimal(12,3) NOT NULL,
	`reason` enum('follow','return','charge','count','adjust') NOT NULL,
	`reference_id` bigint unsigned,
	`note` varchar(255),
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tare_movements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tare_types` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`name` varchar(100) NOT NULL,
	`deposit_price` decimal(12,2) NOT NULL DEFAULT '0.00',
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tare_types_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `products` ADD `tare_type_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `products` ADD `tare_per_unit` decimal(10,3) DEFAULT '1.000' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `tare_enabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tare_movements` ADD CONSTRAINT `tare_movements_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tare_movements` ADD CONSTRAINT `tare_movements_tare_type_id_tare_types_id_fk` FOREIGN KEY (`tare_type_id`) REFERENCES `tare_types`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tare_movements` ADD CONSTRAINT `tare_movements_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tare_types` ADD CONSTRAINT `tare_types_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_tare_movements_holder` ON `tare_movements` (`tenant_id`,`holder_kind`,`holder_id`,`tare_type_id`);--> statement-breakpoint
CREATE INDEX `idx_tare_types_tenant` ON `tare_types` (`tenant_id`);