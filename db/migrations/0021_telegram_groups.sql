CREATE TABLE `telegram_groups` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`chat_id` varchar(40) NOT NULL,
	`title` varchar(200),
	`linked_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `telegram_groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_tg_group_tenant` UNIQUE(`tenant_id`)
);
--> statement-breakpoint
ALTER TABLE `telegram_groups` ADD CONSTRAINT `telegram_groups_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `telegram_groups` ADD CONSTRAINT `telegram_groups_linked_by_users_id_fk` FOREIGN KEY (`linked_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_tg_group_chat` ON `telegram_groups` (`chat_id`);