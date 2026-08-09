-- Migration: Change TEXT columns to MEDIUMTEXT for base64 image storage
-- TEXT = 64KB, MEDIUMTEXT = 16MB
-- base64 images can exceed 64KB easily

ALTER TABLE `users` MODIFY COLUMN `avatar` MEDIUMTEXT;
--> statement-breakpoint
ALTER TABLE `shops` MODIFY COLUMN `photo_url` MEDIUMTEXT;
--> statement-breakpoint
ALTER TABLE `products` MODIFY COLUMN `photo_url` MEDIUMTEXT;
--> statement-breakpoint
ALTER TABLE `daily_plans` MODIFY COLUMN `photo_url` MEDIUMTEXT;
