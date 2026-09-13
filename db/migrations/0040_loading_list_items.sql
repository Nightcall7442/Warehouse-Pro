CREATE TABLE `loading_list_items` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`list_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`required_qty` decimal(12,2) NOT NULL,
	`picked_qty` decimal(12,2),
	`batches` json,
	CONSTRAINT `loading_list_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_lli_list_product` UNIQUE(`list_id`,`product_id`)
);
--> statement-breakpoint
ALTER TABLE `loading_list_items` ADD CONSTRAINT `loading_list_items_list_id_loading_lists_id_fk` FOREIGN KEY (`list_id`) REFERENCES `loading_lists`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loading_list_items` ADD CONSTRAINT `loading_list_items_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE restrict ON UPDATE no action;