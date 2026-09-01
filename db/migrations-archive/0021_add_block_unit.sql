ALTER TABLE `products` MODIFY COLUMN `unit` enum('kg','l','pcs','box','pack','m','block') NOT NULL DEFAULT 'pcs';
