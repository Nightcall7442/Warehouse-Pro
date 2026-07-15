-- Add payment_method column to orders table
ALTER TABLE orders ADD COLUMN payment_method ENUM('cash','transfer','debt','card') DEFAULT 'cash' NOT NULL AFTER status;

-- Index for payment method analytics queries
CREATE INDEX idx_orders_payment_method ON orders (tenant_id, payment_method);
