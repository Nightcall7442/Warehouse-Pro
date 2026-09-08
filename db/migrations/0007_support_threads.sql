CREATE TABLE `support_threads` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`opened_at` timestamp NOT NULL DEFAULT (now()),
	`closed_at` timestamp NULL,
	`closed_by` enum('client','platform','silence'),
	`purged_at` timestamp NULL,
	`message_count` int NOT NULL DEFAULT 0,
	CONSTRAINT `support_threads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `support_threads` ADD CONSTRAINT `support_threads_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `support_threads` ADD CONSTRAINT `support_threads_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_support_thread_pair` ON `support_threads` (`tenant_id`,`user_id`,`opened_at`);--> statement-breakpoint
CREATE INDEX `idx_support_thread_due` ON `support_threads` (`purged_at`,`closed_at`);--> statement-breakpoint
INSERT INTO `support_threads` (`tenant_id`, `user_id`, `opened_at`) SELECT `tenant_id`, `user_id`, MIN(`created_at`) FROM `support_messages` GROUP BY `tenant_id`, `user_id`