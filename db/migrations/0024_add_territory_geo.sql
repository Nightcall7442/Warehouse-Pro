-- IF NOT EXISTS per column so this is a safe no-op if already applied.
ALTER TABLE `territories` ADD COLUMN IF NOT EXISTS `center_lat` decimal(10,8) DEFAULT NULL AFTER `color`;
ALTER TABLE `territories` ADD COLUMN IF NOT EXISTS `center_lng` decimal(11,8) DEFAULT NULL AFTER `center_lat`;
ALTER TABLE `territories` ADD COLUMN IF NOT EXISTS `radius_km` decimal(6,2) DEFAULT '10.00' AFTER `center_lng`;
