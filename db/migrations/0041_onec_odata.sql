CREATE TABLE `onec_journal` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`entity_type` varchar(30) NOT NULL,
	`entity_id` bigint unsigned NOT NULL,
	`direction` varchar(10) NOT NULL,
	`status` varchar(12) NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`next_at` timestamp,
	`external_id` varchar(100),
	`last_error` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `onec_journal_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_onec_journal_entity` UNIQUE(`tenant_id`,`entity_type`,`entity_id`,`direction`)
);
--> statement-breakpoint
ALTER TABLE `onec_config` ADD `preset` varchar(20) DEFAULT 'bp_uz' NOT NULL;--> statement-breakpoint
ALTER TABLE `onec_config` ADD `name_overrides` json;--> statement-breakpoint
ALTER TABLE `onec_config` ADD `organization_key` varchar(36);--> statement-breakpoint
ALTER TABLE `onec_config` ADD `warehouse_key` varchar(36);--> statement-breakpoint
ALTER TABLE `onec_config` ADD `price_type_key` varchar(36);--> statement-breakpoint
ALTER TABLE `onec_config` ADD `enabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `onec_config` ADD `sync_counterparties` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `onec_config` ADD `sync_payments` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `onec_config` ADD `last_sync_at` timestamp;--> statement-breakpoint
ALTER TABLE `onec_journal` ADD CONSTRAINT `onec_journal_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_onec_journal_due` ON `onec_journal` (`status`,`next_at`);