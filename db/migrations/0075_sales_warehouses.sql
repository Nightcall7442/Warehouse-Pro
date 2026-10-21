ALTER TABLE `users` ADD `warehouse_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `warehouses` ADD `is_sales_point` boolean DEFAULT false NOT NULL;