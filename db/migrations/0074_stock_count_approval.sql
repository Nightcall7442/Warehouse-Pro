ALTER TABLE `stock_counts` MODIFY COLUMN `status` enum('draft','submitted','applied','cancelled') NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE `stock_count_items` ADD `book_at_submit` decimal(12,2);--> statement-breakpoint
ALTER TABLE `stock_counts` ADD `scope` varchar(20) DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE `stock_counts` ADD `scope_category` varchar(100);--> statement-breakpoint
ALTER TABLE `stock_counts` ADD `origin` varchar(20) DEFAULT 'count' NOT NULL;--> statement-breakpoint
ALTER TABLE `stock_counts` ADD `adjust_type` varchar(20);--> statement-breakpoint
ALTER TABLE `stock_counts` ADD `submitted_by` bigint unsigned;--> statement-breakpoint
ALTER TABLE `stock_counts` ADD `submitted_at` timestamp;--> statement-breakpoint
ALTER TABLE `stock_counts` ADD `review_note` varchar(500);--> statement-breakpoint
ALTER TABLE `stock_counts` ADD `reviewed_by` bigint unsigned;--> statement-breakpoint
ALTER TABLE `stock_counts` ADD `reviewed_at` timestamp;--> statement-breakpoint
ALTER TABLE `stock_counts` ADD CONSTRAINT `stock_counts_submitted_by_users_id_fk` FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_counts` ADD CONSTRAINT `stock_counts_reviewed_by_users_id_fk` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_stock_counts_status` ON `stock_counts` (`tenant_id`,`status`);