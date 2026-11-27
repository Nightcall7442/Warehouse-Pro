ALTER TABLE `payments` ADD `excess_of_order_id` bigint unsigned;--> statement-breakpoint
CREATE INDEX `idx_payments_excess_of` ON `payments` (`excess_of_order_id`);