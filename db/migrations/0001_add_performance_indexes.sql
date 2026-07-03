-- Performance indexes for order_items and stock_movements
-- These indexes speed up foreign key lookups used in order queries and stock movement queries

CREATE INDEX `idx_order_items_order` ON `order_items` (`order_id`);
CREATE INDEX `idx_order_items_product` ON `order_items` (`product_id`);
CREATE INDEX `idx_movements_product` ON `stock_movements` (`product_id`);
