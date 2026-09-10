CREATE TABLE `api_export_log` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`api_key_id` bigint unsigned,
	`endpoint` varchar(64) NOT NULL,
	`mode` varchar(16) NOT NULL,
	`cursor_in` varchar(512),
	`cursor_out` varchar(512),
	`http_status` int NOT NULL,
	`rows` int NOT NULL DEFAULT 0,
	`total_count` int,
	`amount_total` decimal(14,2),
	`duration_ms` int NOT NULL DEFAULT 0,
	`error` varchar(300),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `api_export_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `api_export_log` ADD CONSTRAINT `api_export_log_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_export_log_tenant` ON `api_export_log` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_export_log_key` ON `api_export_log` (`api_key_id`,`created_at`);