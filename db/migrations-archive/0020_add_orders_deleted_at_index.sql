-- Migration 0020: Add missing index for soft-delete queries on orders
-- WHERE deleted_at IS NULL queries run without an index since 0012_friendly_silvermane

CREATE INDEX idx_orders_deleted_at ON orders(deleted_at);
