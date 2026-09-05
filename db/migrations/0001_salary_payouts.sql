CREATE TABLE `salary_payouts` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`kind` enum('payout','advance') NOT NULL DEFAULT 'payout',
	`amount` decimal(14,2) NOT NULL,
	`paid_at` timestamp NOT NULL DEFAULT (now()),
	`note` varchar(255),
	`created_by` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `salary_payouts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `salary_payouts` ADD CONSTRAINT `salary_payouts_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `salary_payouts` ADD CONSTRAINT `salary_payouts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `salary_payouts` ADD CONSTRAINT `salary_payouts_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_salary_payouts_tenant` ON `salary_payouts` (`tenant_id`,`paid_at`);--> statement-breakpoint
CREATE INDEX `idx_salary_payouts_user` ON `salary_payouts` (`user_id`,`paid_at`);