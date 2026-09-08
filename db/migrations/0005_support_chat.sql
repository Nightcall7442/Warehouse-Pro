CREATE TABLE `support_messages` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`from_platform` boolean NOT NULL DEFAULT false,
	`author_id` bigint unsigned,
	`body` varchar(4000) NOT NULL,
	`read_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `support_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `support_messages` ADD CONSTRAINT `support_messages_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `support_messages` ADD CONSTRAINT `support_messages_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `support_messages` ADD CONSTRAINT `support_messages_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_support_thread` ON `support_messages` (`tenant_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_support_unread` ON `support_messages` (`user_id`,`from_platform`,`read_at`);