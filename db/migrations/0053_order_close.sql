DROP TABLE `cash_categories`;--> statement-breakpoint
DROP TABLE `cash_days`;--> statement-breakpoint
DROP TABLE `cash_documents`;--> statement-breakpoint
ALTER TABLE `orders` ADD `closed_at` timestamp;--> statement-breakpoint
ALTER TABLE `orders` ADD `closed_by` bigint unsigned;--> statement-breakpoint
ALTER TABLE `orders` ADD `courier_shortage` decimal(12,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `shortage_user_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `orders` ADD `shortage_note` varchar(300);--> statement-breakpoint
ALTER TABLE `payments` ADD `received_at` timestamp;--> statement-breakpoint
ALTER TABLE `payments` ADD `received_by` bigint unsigned;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_closed_by_users_id_fk` FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_shortage_user_id_users_id_fk` FOREIGN KEY (`shortage_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_received_by_users_id_fk` FOREIGN KEY (`received_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `cash_limit`;--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `cash_deadline`;--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `cash_start_day`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `cash_pin_hash`;