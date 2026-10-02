CREATE TABLE `markdowns` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`batch_id` bigint unsigned NOT NULL,
	`price` decimal(10,2) NOT NULL,
	`ends_on` date NOT NULL,
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `markdowns_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_markdown_tenant_product` UNIQUE(`tenant_id`,`product_id`)
);
--> statement-breakpoint
ALTER TABLE `markdowns` ADD CONSTRAINT `markdowns_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `markdowns` ADD CONSTRAINT `markdowns_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `markdowns` ADD CONSTRAINT `markdowns_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;