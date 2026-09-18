ALTER TABLE `orders` ADD `warehouse_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `return_items` ADD `requested_price` decimal(10,2);--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_warehouse_id_warehouses_id_fk` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE restrict ON UPDATE no action;