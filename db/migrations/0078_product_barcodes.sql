CREATE TABLE `product_barcodes` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`barcode` varchar(100) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_barcodes_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_product_barcode_tenant` UNIQUE(`tenant_id`,`barcode`)
);
--> statement-breakpoint
ALTER TABLE `product_barcodes` ADD CONSTRAINT `product_barcodes_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_barcodes` ADD CONSTRAINT `product_barcodes_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_product_barcodes_product` ON `product_barcodes` (`product_id`);