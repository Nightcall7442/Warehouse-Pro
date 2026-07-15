-- Migration 0012: Add soft delete support for orders
-- Adds deleted_at column for soft delete functionality

ALTER TABLE orders ADD COLUMN deleted_at TIMESTAMP NULL AFTER delivered_at;

CREATE INDEX idx_orders_deleted_at ON orders(deleted_at);
