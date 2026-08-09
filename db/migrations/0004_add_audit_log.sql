-- Audit log — tracks sensitive actions for compliance and debugging
CREATE TABLE `audit_log` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`    BIGINT UNSIGNED NOT NULL,
  `actor_id`     BIGINT UNSIGNED DEFAULT NULL,
  `actor_name`   VARCHAR(100) DEFAULT NULL,
  `action`       VARCHAR(100) NOT NULL,
  `target_type`  VARCHAR(50) DEFAULT NULL,
  `target_id`    BIGINT UNSIGNED DEFAULT NULL,
  `meta`         JSON DEFAULT NULL,
  `ip`           VARCHAR(45) DEFAULT NULL,
  `created_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_audit_tenant_created` (`tenant_id`, `created_at`),
  INDEX `idx_audit_tenant_action` (`tenant_id`, `action`),
  INDEX `idx_audit_actor` (`actor_id`),
  CONSTRAINT `fk_audit_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `fk_audit_actor` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
