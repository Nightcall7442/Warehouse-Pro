ALTER TABLE `orders` ADD `price_list_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `price_lists` ADD `markup_pct` decimal(6,2);--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_price_list_id_price_lists_id_fk` FOREIGN KEY (`price_list_id`) REFERENCES `price_lists`(`id`) ON DELETE set null ON UPDATE no action;