ALTER TABLE `products` ADD `ikpu` varchar(17);--> statement-breakpoint
ALTER TABLE `products` ADD `package_code` varchar(30);--> statement-breakpoint
ALTER TABLE `products` ADD `vat_rate` enum('vat12','vat0','exempt');--> statement-breakpoint
ALTER TABLE `shops` ADD `tax_id` varchar(14);--> statement-breakpoint
ALTER TABLE `shops` ADD `vat_payer` boolean DEFAULT false NOT NULL;