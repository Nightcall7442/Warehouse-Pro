ALTER TABLE `users` ADD `totp_secret` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `totp_enabled_at` timestamp;