-- IF NOT EXISTS on the table. Indexes are created only if missing (checked via
-- information_schema) rather than DROP-then-CREATE: each index is the sole
-- index covering its column's foreign key, and MySQL/MariaDB refuse to drop an
-- index a foreign key depends on ("Cannot drop index ... needed in a foreign
-- key constraint") — confirmed by testing this file against an already-migrated
-- database.
CREATE TABLE IF NOT EXISTS `agent_territories` (
  `id` serial AUTO_INCREMENT NOT NULL,
  `tenant_id` bigint unsigned NOT NULL,
  `agent_id` bigint unsigned NOT NULL,
  `territory_id` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `agent_territories_pk` PRIMARY KEY (`id`),
  CONSTRAINT `at_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict,
  CONSTRAINT `at_agent_fk` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE restrict,
  CONSTRAINT `at_territory_fk` FOREIGN KEY (`territory_id`) REFERENCES `territories`(`id`) ON DELETE restrict,
  CONSTRAINT `uq_agent_territory` UNIQUE (`agent_id`, `territory_id`)
);
--> statement-breakpoint
SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agent_territories' AND INDEX_NAME = 'idx_at_tenant');
--> statement-breakpoint
SET @ddl = IF(@idx_exists = 0, 'CREATE INDEX `idx_at_tenant` ON `agent_territories` (`tenant_id`)', 'SELECT 1');
--> statement-breakpoint
PREPARE stmt FROM @ddl;
--> statement-breakpoint
EXECUTE stmt;
--> statement-breakpoint
DEALLOCATE PREPARE stmt;
--> statement-breakpoint
SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agent_territories' AND INDEX_NAME = 'idx_at_agent');
--> statement-breakpoint
SET @ddl = IF(@idx_exists = 0, 'CREATE INDEX `idx_at_agent` ON `agent_territories` (`agent_id`)', 'SELECT 1');
--> statement-breakpoint
PREPARE stmt FROM @ddl;
--> statement-breakpoint
EXECUTE stmt;
--> statement-breakpoint
DEALLOCATE PREPARE stmt;
--> statement-breakpoint
SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agent_territories' AND INDEX_NAME = 'idx_at_territory');
--> statement-breakpoint
SET @ddl = IF(@idx_exists = 0, 'CREATE INDEX `idx_at_territory` ON `agent_territories` (`territory_id`)', 'SELECT 1');
--> statement-breakpoint
PREPARE stmt FROM @ddl;
--> statement-breakpoint
EXECUTE stmt;
--> statement-breakpoint
DEALLOCATE PREPARE stmt;
