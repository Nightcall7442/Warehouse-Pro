-- courier.completeDelivery (api/courier-router.ts) has written orders.delivery_result
-- and orders.delivery_notes since it was added — those columns exist on the live
-- production DB (built via `drizzle-kit push`) but, like onec_config (0030) before
-- them, were never captured by a migration — found by running the full 0000-0034
-- set against a scratch DB and diffing the result with `drizzle-kit generate`.
-- IF NOT EXISTS added by hand after generation so this is a safe no-op against
-- production and any existing dev DB, which already has both columns via push.
-- The status enum re-statement is drizzle-kit's own diff output, a no-op
-- (identical to what 0034 already set) — left as generated.
ALTER TABLE `orders` MODIFY COLUMN `status` enum('new','processing','shipped','pending','delivered','cancelled','returned') NOT NULL DEFAULT 'new';--> statement-breakpoint
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `delivery_result` varchar(30);--> statement-breakpoint
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `delivery_notes` text;