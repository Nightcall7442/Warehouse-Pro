-- Idempotency key for order creation — prevents duplicate orders from retries
ALTER TABLE `orders`
  ADD COLUMN `idempotency_key` varchar(64) DEFAULT NULL AFTER `notes`;

-- Unique index: same key + same tenant = same order (nullable keys don't conflict)
CREATE UNIQUE INDEX `uq_orders_idempotency` ON `orders` (`idempotency_key`, `tenant_id`);
