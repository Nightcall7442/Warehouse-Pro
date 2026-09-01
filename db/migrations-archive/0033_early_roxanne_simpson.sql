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
ALTER TABLE `orders` MODIFY COLUMN `status` enum('new','processing','completed','cancelled','partially_delivered','partially_paid') NOT NULL DEFAULT 'new';--> statement-breakpoint
ALTER TABLE `order_items` ADD `delivered_quantity` decimal(10,2);--> statement-breakpoint
ALTER TABLE `order_items` ADD `return_reason` varchar(100);--> statement-breakpoint
ALTER TABLE `order_items` ADD `return_photos` json;--> statement-breakpoint
ALTER TABLE `payments` ADD `order_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `payments` ADD `payment_method` enum('cash','card','transfer') DEFAULT 'cash';--> statement-breakpoint
ALTER TABLE `payments` ADD `status` varchar(30) DEFAULT 'paid';--> statement-breakpoint
ALTER TABLE `payments` ADD `total_order_amount` decimal(15,2);--> statement-breakpoint
ALTER TABLE `payments` ADD `paid_amount` decimal(15,2);--> statement-breakpoint
ALTER TABLE `payments` ADD `debt_amount` decimal(15,2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `payments` ADD `debt_due_date` date;--> statement-breakpoint
ALTER TABLE `payments` ADD `paid_at` timestamp;--> statement-breakpoint
ALTER TABLE `debt_reminders` ADD CONSTRAINT `debt_reminders_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `debt_reminders` ADD CONSTRAINT `debt_reminders_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `debt_reminders` ADD CONSTRAINT `debt_reminders_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_adjustments` ADD CONSTRAINT `order_adjustments_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_adjustments` ADD CONSTRAINT `order_adjustments_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_adjustments` ADD CONSTRAINT `order_adjustments_adjusted_by_users_id_fk` FOREIGN KEY (`adjusted_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_reminders_tenant` ON `debt_reminders` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_reminders_shop` ON `debt_reminders` (`shop_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_reminders_due` ON `debt_reminders` (`due_date`,`status`);--> statement-breakpoint
CREATE INDEX `idx_adjustments_order` ON `order_adjustments` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_adjustments_tenant` ON `order_adjustments` (`tenant_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_payments_order` ON `payments` (`order_id`);