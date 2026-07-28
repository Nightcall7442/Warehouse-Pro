CREATE TABLE `visit_schedules` (
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
CREATE INDEX `idx_schedules_tenant` ON `visit_schedules` (`tenant_id`);
CREATE INDEX `idx_schedules_agent` ON `visit_schedules` (`agent_id`);
CREATE INDEX `idx_schedules_shop` ON `visit_schedules` (`shop_id`);
CREATE INDEX `idx_schedules_tenant_agent` ON `visit_schedules` (`tenant_id`, `agent_id`);
