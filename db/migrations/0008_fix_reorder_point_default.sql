-- Migration 0008: Fix reorderPoint default values
-- Products with reorderPoint=10 (old default) that are NOT intentionally low-stock
-- should have reorderPoint set to 0 so they're not counted as "below threshold"
UPDATE products SET reorder_point = 0.00 WHERE reorder_point = 10.00;
