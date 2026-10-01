CREATE TABLE `announcement_dismissals` (
	`announcement_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`dismissed_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `announcement_dismissals_announcement_id_user_id_pk` PRIMARY KEY(`announcement_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`title` varchar(160) NOT NULL,
	`body` text NOT NULL,
	`title_uz` varchar(160),
	`body_uz` text,
	`level` enum('info','warning') NOT NULL DEFAULT 'info',
	`audience` enum('all','plans','tenants') NOT NULL DEFAULT 'all',
	`plans` json,
	`tenant_ids` json,
	`starts_at` timestamp NOT NULL,
	`ends_at` timestamp,
	`ended_at` timestamp,
	`created_by_id` bigint unsigned,
	`created_by_name` varchar(100),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `announcements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `platform_audit` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`actor_id` bigint unsigned,
	`actor_name` varchar(100),
	`action` varchar(64) NOT NULL,
	`tenant_id` bigint unsigned,
	`tenant_name` varchar(200),
	`target_type` varchar(50),
	`target_id` bigint unsigned,
	`target_label` varchar(200),
	`before` json,
	`after` json,
	`meta` json,
	`ip` varchar(45),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `platform_audit_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subscription_payments` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`tenant_name` varchar(200) NOT NULL,
	`amount` bigint unsigned NOT NULL,
	`paid_at` date NOT NULL,
	`method` enum('cash','transfer','card','payme','click','other') NOT NULL,
	`plan` enum('basic','pro','exclusive') NOT NULL,
	`months` int NOT NULL,
	`period_from` date NOT NULL,
	`period_to` date NOT NULL,
	`note` varchar(500),
	`recorded_by_id` bigint unsigned,
	`recorded_by_name` varchar(100),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `subscription_payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `announcement_dismissals` ADD CONSTRAINT `announcement_dismissals_announcement_id_announcements_id_fk` FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `announcement_dismissals` ADD CONSTRAINT `announcement_dismissals_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `announcement_dismissals` ADD CONSTRAINT `announcement_dismissals_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_announcement_dismissals_user` ON `announcement_dismissals` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_announcement_dismissals_tenant` ON `announcement_dismissals` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_announcements_live` ON `announcements` (`ended_at`,`ends_at`);--> statement-breakpoint
CREATE INDEX `idx_platform_audit_tenant` ON `platform_audit` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_platform_audit_created` ON `platform_audit` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_platform_audit_action` ON `platform_audit` (`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_sub_payments_tenant` ON `subscription_payments` (`tenant_id`,`paid_at`);--> statement-breakpoint
CREATE INDEX `idx_sub_payments_paid` ON `subscription_payments` (`paid_at`);--> statement-breakpoint
CREATE INDEX `idx_sub_payments_period` ON `subscription_payments` (`period_to`,`period_from`);