CREATE TABLE `cash_categories` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`code` varchar(64) NOT NULL,
	`name` varchar(100) NOT NULL,
	`monthly_limit` decimal(15,2),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cash_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_cash_category` UNIQUE(`tenant_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `cash_days` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`day` date NOT NULL,
	`system_balance` decimal(15,2) NOT NULL,
	`counted_balance` decimal(15,2) NOT NULL,
	`discrepancy` decimal(15,2) NOT NULL,
	`closed_by` bigint unsigned NOT NULL,
	`closed_at` timestamp NOT NULL DEFAULT (now()),
	`reopened_by` bigint unsigned,
	`reopened_at` timestamp,
	CONSTRAINT `cash_days_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_cash_day` UNIQUE(`tenant_id`,`day`)
);
--> statement-breakpoint
CREATE TABLE `cash_documents` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`kind` enum('pko','rko') NOT NULL,
	`year` int NOT NULL,
	`number` int NOT NULL,
	`debit` varchar(64) NOT NULL,
	`credit` varchar(64) NOT NULL,
	`amount` decimal(15,2) NOT NULL,
	`expected_amount` decimal(15,2),
	`discrepancy` decimal(15,2),
	`from_user_id` bigint unsigned,
	`to_user_id` bigint unsigned,
	`category` varchar(64),
	`note` varchar(500),
	`denominations` json,
	`photo_url` text,
	`pin_confirmed_at` timestamp,
	`paper_signed` boolean NOT NULL DEFAULT false,
	`storno_of_id` bigint unsigned,
	`prev_hash` varchar(64),
	`hash` varchar(64) NOT NULL,
	`created_by` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cash_documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_cash_doc_number` UNIQUE(`tenant_id`,`year`,`kind`,`number`)
);
--> statement-breakpoint
ALTER TABLE `settings` ADD `cash_limit` decimal(15,2) DEFAULT '5000000.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `cash_deadline` varchar(5) DEFAULT '19:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `cash_pin_hash` varchar(255);--> statement-breakpoint
ALTER TABLE `cash_categories` ADD CONSTRAINT `cash_categories_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cash_days` ADD CONSTRAINT `cash_days_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cash_days` ADD CONSTRAINT `cash_days_closed_by_users_id_fk` FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cash_days` ADD CONSTRAINT `cash_days_reopened_by_users_id_fk` FOREIGN KEY (`reopened_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cash_documents` ADD CONSTRAINT `cash_documents_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cash_documents` ADD CONSTRAINT `cash_documents_from_user_id_users_id_fk` FOREIGN KEY (`from_user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cash_documents` ADD CONSTRAINT `cash_documents_to_user_id_users_id_fk` FOREIGN KEY (`to_user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cash_documents` ADD CONSTRAINT `cash_documents_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_cash_doc_tenant_at` ON `cash_documents` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_cash_doc_from` ON `cash_documents` (`from_user_id`);