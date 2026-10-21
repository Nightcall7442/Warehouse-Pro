CREATE TABLE `purchase_order_items` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`purchase_order_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`quantity` decimal(12,2) NOT NULL,
	`unit_price` decimal(15,2) NOT NULL DEFAULT '0.00',
	`received_qty` decimal(12,2) NOT NULL DEFAULT '0.00',
	`note` varchar(255),
	CONSTRAINT `purchase_order_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_po_item_product` UNIQUE(`purchase_order_id`,`product_id`)
);
--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`number` varchar(30) NOT NULL,
	`supplier_id` bigint unsigned NOT NULL,
	`warehouse_id` bigint unsigned NOT NULL,
	`status` enum('draft','pending_approval','approved','partially_received','received','closed','cancelled') NOT NULL DEFAULT 'draft',
	`currency` enum('UZS','USD') NOT NULL DEFAULT 'UZS',
	`rate_to_uzs` decimal(12,4),
	`payment_terms_days` int,
	`expected_date` date,
	`source` enum('manual','reorder') NOT NULL DEFAULT 'manual',
	`notes` text,
	`reject_note` varchar(500),
	`created_by` bigint unsigned,
	`submitted_at` timestamp,
	`approved_by` bigint unsigned,
	`approved_at` timestamp,
	`closed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `purchase_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_po_number_tenant` UNIQUE(`number`,`tenant_id`)
);
--> statement-breakpoint
ALTER TABLE `arrivals` ADD `purchase_order_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `arrivals` ADD `warehouse_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `products` ADD `default_supplier_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `payment_terms_days` int;--> statement-breakpoint
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `purchase_order_items_purchase_order_id_purchase_orders_id_fk` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `purchase_order_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_supplier_id_suppliers_id_fk` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_warehouse_id_warehouses_id_fk` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_approved_by_users_id_fk` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_po_items_product` ON `purchase_order_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_po_tenant_status` ON `purchase_orders` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_po_tenant_supplier` ON `purchase_orders` (`tenant_id`,`supplier_id`);--> statement-breakpoint
ALTER TABLE `arrivals` ADD CONSTRAINT `arrivals_purchase_order_id_purchase_orders_id_fk` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `arrivals` ADD CONSTRAINT `arrivals_warehouse_id_warehouses_id_fk` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_default_supplier_id_suppliers_id_fk` FOREIGN KEY (`default_supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_arrivals_purchase_order` ON `arrivals` (`purchase_order_id`);