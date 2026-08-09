-- API Keys for public REST API (Exclusive tier)
CREATE TABLE `api_keys` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`name` varchar(100) NOT NULL,
	`key_hash` varchar(64) NOT NULL,
	`key_prefix` varchar(12) NOT NULL,
	`scopes` varchar(500) NOT NULL DEFAULT 'read',
	`rate_limit` int NOT NULL DEFAULT 100,
	`last_used_at` timestamp,
	`expires_at` timestamp,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_apikey_hash` UNIQUE(`key_hash`)
);
--> statement-breakpoint
CREATE INDEX `idx_apikey_tenant` ON `api_keys` (`tenant_id`);
--> statement-breakpoint
CREATE INDEX `idx_apikey_prefix` ON `api_keys` (`key_prefix`);
