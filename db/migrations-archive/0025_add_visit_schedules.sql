-- IF NOT EXISTS on the table. Indexes are created only if missing (checked via
-- information_schema) rather than DROP-then-CREATE: each of these indexes is
-- the sole index covering its column's foreign key, and MySQL/MariaDB refuse
-- to drop an index a foreign key depends on ("Cannot drop index ... needed in
-- a foreign key constraint") — confirmed by testing this file against an
-- already-migrated database.
CREATE TABLE IF NOT EXISTS `visit_schedules` (
  `id` serial AUTO_INCREMENT NOT NULL,
  `tenant_id` bigint unsigned NOT NULL,
  `agent_id` bigint unsigned NOT NULL,
  `shop_id` bigint unsigned NOT NULL,
  `day_of_week` tinyint NOT NULL,
  `active` boolean NOT NULL DEFAULT true,
  `created_by` bigint unsigned,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `visit_schedules_pk` PRIMARY KEY (`id`),
  CONSTRAINT `visit_schedules_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict,
  CONSTRAINT `visit_schedules_agent_id_users_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON DELETE restrict,
  CONSTRAINT `visit_schedules_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict,
  CONSTRAINT `visit_schedules_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE restrict,
  CONSTRAINT `uq_schedule_agent_shop_day` UNIQUE (`agent_id`, `shop_id`, `day_of_week`)
);
--> statement-breakpoint
SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'visit_schedules' AND INDEX_NAME = 'idx_schedules_tenant');
--> statement-breakpoint
SET @ddl = IF(@idx_exists = 0, 'CREATE INDEX `idx_schedules_tenant` ON `visit_schedules` (`tenant_id`)', 'SELECT 1');
--> statement-breakpoint
PREPARE stmt FROM @ddl;
--> statement-breakpoint
EXECUTE stmt;
--> statement-breakpoint
DEALLOCATE PREPARE stmt;
--> statement-breakpoint
SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'visit_schedules' AND INDEX_NAME = 'idx_schedules_agent');
--> statement-breakpoint
SET @ddl = IF(@idx_exists = 0, 'CREATE INDEX `idx_schedules_agent` ON `visit_schedules` (`agent_id`)', 'SELECT 1');
--> statement-breakpoint
PREPARE stmt FROM @ddl;
--> statement-breakpoint
EXECUTE stmt;
--> statement-breakpoint
DEALLOCATE PREPARE stmt;
--> statement-breakpoint
SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'visit_schedules' AND INDEX_NAME = 'idx_schedules_shop');
--> statement-breakpoint
SET @ddl = IF(@idx_exists = 0, 'CREATE INDEX `idx_schedules_shop` ON `visit_schedules` (`shop_id`)', 'SELECT 1');
--> statement-breakpoint
PREPARE stmt FROM @ddl;
--> statement-breakpoint
EXECUTE stmt;
--> statement-breakpoint
DEALLOCATE PREPARE stmt;
--> statement-breakpoint
SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'visit_schedules' AND INDEX_NAME = 'idx_schedules_tenant_agent');
--> statement-breakpoint
SET @ddl = IF(@idx_exists = 0, 'CREATE INDEX `idx_schedules_tenant_agent` ON `visit_schedules` (`tenant_id`, `agent_id`)', 'SELECT 1');
--> statement-breakpoint
PREPARE stmt FROM @ddl;
--> statement-breakpoint
EXECUTE stmt;
--> statement-breakpoint
DEALLOCATE PREPARE stmt;
