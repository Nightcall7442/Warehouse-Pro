CREATE TABLE `order_shortages` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned,
	`amount` decimal(12,2) NOT NULL,
	`note` varchar(300),
	`recorded_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_shortages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `order_shortages` ADD CONSTRAINT `order_shortages_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_shortages` ADD CONSTRAINT `order_shortages_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_shortages` ADD CONSTRAINT `order_shortages_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_shortages` ADD CONSTRAINT `order_shortages_recorded_by_users_id_fk` FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_order_shortages_tenant_at` ON `order_shortages` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_order_shortages_user_at` ON `order_shortages` (`tenant_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_order_shortages_order` ON `order_shortages` (`order_id`);
