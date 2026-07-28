ALTER TABLE `sales_targets`
  ADD COLUMN `territory_id` bigint unsigned DEFAULT NULL AFTER `shop_id`,
  ADD CONSTRAINT `sales_targets_territory_id_territories_id_fk`
    FOREIGN KEY (`territory_id`) REFERENCES `territories`(`id`) ON DELETE restrict;
CREATE INDEX `idx_sales_targets_territory` ON `sales_targets` (`territory_id`);
