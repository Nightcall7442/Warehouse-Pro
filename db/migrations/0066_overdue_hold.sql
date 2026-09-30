ALTER TABLE `settings` ADD `overdue_hold_enabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `overdue_grace_days` int DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE `shops` ADD `payment_grace_days` int;