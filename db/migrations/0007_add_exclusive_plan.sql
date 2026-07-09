-- Add 'exclusive' to plan enum in tenants and subscriptions tables
ALTER TABLE `tenants` MODIFY COLUMN `plan` enum('trial','basic','pro','exclusive') NOT NULL DEFAULT 'trial';
--> statement-breakpoint
ALTER TABLE `subscriptions` MODIFY COLUMN `plan` enum('trial','basic','pro','exclusive') NOT NULL DEFAULT 'trial';
