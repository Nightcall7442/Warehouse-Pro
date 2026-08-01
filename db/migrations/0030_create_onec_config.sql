-- onec_config exists in db/schema.ts and in the 0021 snapshot (introduced
-- alongside the 1C integration), but was never given a CREATE TABLE migration —
-- it was applied to production via `drizzle-kit push`, so a fresh deploy built
-- from `drizzle-kit migrate` never created it. This backfills that gap.
--
-- Uses IF NOT EXISTS and an inline UNIQUE constraint (rather than a separate
-- CREATE INDEX) so this is a safe no-op on the existing production database,
-- which already has this table — MySQL has no CREATE INDEX IF NOT EXISTS, so
-- a standalone index statement would error there with "Duplicate key name".
CREATE TABLE IF NOT EXISTS `onec_config` (
  `id` serial AUTO_INCREMENT NOT NULL,
  `tenant_id` bigint unsigned NOT NULL,
  `url` varchar(500) NOT NULL,
  `username` varchar(100) NOT NULL,
  `password` varchar(500) NOT NULL,
  `sync_products` boolean DEFAULT true,
  `sync_orders` boolean DEFAULT true,
  `interval_minutes` int DEFAULT 60,
  `last_tested_at` timestamp,
  `last_test_ok` boolean,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `onec_config_pk` PRIMARY KEY (`id`),
  CONSTRAINT `uq_onec_config_tenant` UNIQUE (`tenant_id`),
  CONSTRAINT `onec_config_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade
);
