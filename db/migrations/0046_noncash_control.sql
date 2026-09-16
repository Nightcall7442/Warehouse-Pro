ALTER TABLE `payments` ADD `bank_confirmed_at` timestamp;--> statement-breakpoint
ALTER TABLE `payments` ADD `bank_confirmed_by` bigint unsigned;--> statement-breakpoint
ALTER TABLE `payments` ADD `bank_ref` varchar(64);--> statement-breakpoint
ALTER TABLE `settings` ADD `bank_confirm_days` int DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_bank_confirmed_by_users_id_fk` FOREIGN KEY (`bank_confirmed_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;