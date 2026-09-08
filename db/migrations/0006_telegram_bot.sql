CREATE TABLE `telegram_outbox` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`chat_id` varchar(50) NOT NULL,
	`body` varchar(3000) NOT NULL,
	`send_after` timestamp NOT NULL,
	`sent_at` timestamp,
	`attempts` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `telegram_outbox_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `telegram_rules` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`event` enum('order.created','stock.low','debt.overdue','delivery.assigned') NOT NULL,
	`role` enum('ceo','operator','supervisor','agent','merchandiser','courier') NOT NULL,
	`enabled` boolean NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `telegram_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_tg_rule` UNIQUE(`tenant_id`,`event`,`role`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `telegram_lang` varchar(2);--> statement-breakpoint
ALTER TABLE `telegram_outbox` ADD CONSTRAINT `telegram_outbox_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `telegram_rules` ADD CONSTRAINT `telegram_rules_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_tg_outbox_due` ON `telegram_outbox` (`sent_at`,`send_after`);