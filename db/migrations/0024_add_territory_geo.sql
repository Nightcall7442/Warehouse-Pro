ALTER TABLE `territories`
  ADD COLUMN `center_lat` decimal(10,8) DEFAULT NULL AFTER `color`,
  ADD COLUMN `center_lng` decimal(11,8) DEFAULT NULL AFTER `center_lat`,
  ADD COLUMN `radius_km` decimal(6,2) DEFAULT '10.00' AFTER `center_lng`;
