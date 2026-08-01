DROP INDEX IF EXISTS `idx_orders_tenant_deleted` ON `orders`;
CREATE INDEX `idx_orders_tenant_deleted` ON `orders` (`tenant_id`, `deleted_at`);
