CREATE TABLE `agent_territories` (
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
CREATE INDEX `idx_at_tenant` ON `agent_territories` (`tenant_id`);
CREATE INDEX `idx_at_agent` ON `agent_territories` (`agent_id`);
CREATE INDEX `idx_at_territory` ON `agent_territories` (`territory_id`);
