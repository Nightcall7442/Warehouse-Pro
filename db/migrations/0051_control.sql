ALTER TABLE `orders` ADD `shop_confirmed_at` timestamp;--> statement-breakpoint
ALTER TABLE `orders` ADD `shop_disputed_at` timestamp;--> statement-breakpoint
ALTER TABLE `orders` ADD `shop_dispute_note` varchar(300);--> statement-breakpoint
ALTER TABLE `settings` ADD `control_enabled` boolean DEFAULT false NOT NULL;