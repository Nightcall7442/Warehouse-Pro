CREATE TABLE `stock_transfer_docs` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`number` varchar(30) NOT NULL,
	`from_warehouse_id` bigint unsigned NOT NULL,
	`to_warehouse_id` bigint unsigned NOT NULL,
	`mode` enum('instant','transit') NOT NULL DEFAULT 'instant',
	`status` enum('in_transit','received','received_short','cancelled') NOT NULL,
	`notes` text,
	`shortage_cost` decimal(14,2),
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`received_by` bigint unsigned,
	`received_at` timestamp,
	`cancelled_by` bigint unsigned,
	`cancelled_at` timestamp,
	CONSTRAINT `stock_transfer_docs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_transfer_docs_tenant_number` UNIQUE(`tenant_id`,`number`)
);
--> statement-breakpoint
ALTER TABLE `settings` ADD `transfer_two_step` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD `doc_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD `batch_number` varchar(64);--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD `expires_at` date;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD `batch_cost` decimal(12,2);--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD `arrival_item_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD `received_quantity` decimal(12,2);--> statement-breakpoint
ALTER TABLE `stock_transfer_docs` ADD CONSTRAINT `stock_transfer_docs_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transfer_docs` ADD CONSTRAINT `stock_transfer_docs_from_warehouse_id_warehouses_id_fk` FOREIGN KEY (`from_warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transfer_docs` ADD CONSTRAINT `stock_transfer_docs_to_warehouse_id_warehouses_id_fk` FOREIGN KEY (`to_warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transfer_docs` ADD CONSTRAINT `stock_transfer_docs_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transfer_docs` ADD CONSTRAINT `stock_transfer_docs_received_by_users_id_fk` FOREIGN KEY (`received_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transfer_docs` ADD CONSTRAINT `stock_transfer_docs_cancelled_by_users_id_fk` FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_transfer_docs_tenant_status` ON `stock_transfer_docs` (`tenant_id`,`status`);--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD CONSTRAINT `stock_transfers_doc_id_stock_transfer_docs_id_fk` FOREIGN KEY (`doc_id`) REFERENCES `stock_transfer_docs`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_transfers_doc` ON `stock_transfers` (`doc_id`);