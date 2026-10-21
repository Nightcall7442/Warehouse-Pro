CREATE TABLE `delivery_events` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	`courier_id` bigint unsigned,
	`kind` enum('delivered','failed','rescheduled') NOT NULL,
	`reason_code` enum('shop_closed','no_owner','no_money','refused','wrong_goods','damaged','address_not_found','no_answer','asked_reschedule','no_time','vehicle_issue','short_stock','other'),
	`note` varchar(300),
	`rescheduled_to` date,
	`photos` json,
	`signature` json,
	`recipient_name` varchar(120),
	`lat` decimal(10,8),
	`lng` decimal(11,8),
	`recorded_at` timestamp NOT NULL DEFAULT (now()),
	`idempotency_key` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `delivery_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_delivery_events_idem` UNIQUE(`tenant_id`,`idempotency_key`)
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `planned_delivery_date` date;--> statement-breakpoint
ALTER TABLE `orders` ADD `route_seq` smallint;--> statement-breakpoint
ALTER TABLE `delivery_events` ADD CONSTRAINT `delivery_events_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `delivery_events` ADD CONSTRAINT `delivery_events_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `delivery_events` ADD CONSTRAINT `delivery_events_courier_id_users_id_fk` FOREIGN KEY (`courier_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_de_order` ON `delivery_events` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_de_tenant_kind_recorded` ON `delivery_events` (`tenant_id`,`kind`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `idx_de_courier_recorded` ON `delivery_events` (`tenant_id`,`courier_id`,`recorded_at`);