CREATE TABLE `commission_product_rates` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`rate` decimal(5,2) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `commission_product_rates_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_commission_product_rates` UNIQUE(`tenant_id`,`product_id`)
);
--> statement-breakpoint
ALTER TABLE `commissions` ADD `meal_allowance` decimal(12,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `commissions` ADD `travel_allowance` decimal(12,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `salary_payouts` ADD `confirmed_at` timestamp;--> statement-breakpoint
ALTER TABLE `commission_product_rates` ADD CONSTRAINT `commission_product_rates_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `commission_product_rates` ADD CONSTRAINT `commission_product_rates_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;