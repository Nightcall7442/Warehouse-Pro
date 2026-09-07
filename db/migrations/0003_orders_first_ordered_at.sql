ALTER TABLE `tenant_branding` MODIFY COLUMN `favicon_url` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `first_ordered_at` timestamp;