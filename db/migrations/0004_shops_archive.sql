ALTER TABLE `shops` ADD `archived_at` timestamp;--> statement-breakpoint
ALTER TABLE `shops` ADD `archived_by` bigint unsigned;--> statement-breakpoint
ALTER TABLE `shops` ADD `archive_reason` varchar(200);--> statement-breakpoint
ALTER TABLE `shops` ADD CONSTRAINT `shops_archived_by_users_id_fk` FOREIGN KEY (`archived_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;