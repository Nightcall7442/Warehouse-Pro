-- P1.4: per-tenant 1C webhook secret.
--
-- Left NULL on purpose: MySQL's RAND() is not a cryptographic RNG, so secrets are
-- issued by the application (onec.rotateWebhookSecret) instead of being generated
-- here. A tenant with NULL still authenticates against the global
-- ONEC_WEBHOOK_SECRET, and every such request is logged as deprecated.
ALTER TABLE `onec_config` ADD COLUMN `webhook_secret` VARCHAR(64) NULL AFTER `password`;
