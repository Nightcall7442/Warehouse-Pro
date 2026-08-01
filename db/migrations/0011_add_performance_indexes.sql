-- Performance indexes for common query patterns

-- Orders: list by tenant+status+date (most common filter)
CREATE INDEX idx_orders_tenant_status_date ON orders (tenant_id, status, created_at);
--> statement-breakpoint
-- Orders: payment method analytics
CREATE INDEX idx_orders_tenant_payment_created ON orders (tenant_id, payment_method, created_at);
--> statement-breakpoint
-- Order items: joins with orders and products
CREATE INDEX idx_order_items_order_product ON order_items (order_id, product_id);
--> statement-breakpoint
-- Warehouse stock: product lookups per warehouse
CREATE INDEX idx_stock_product_warehouse_tenant ON warehouse_stock (product_id, warehouse_id, tenant_id);
--> statement-breakpoint
-- Stock movements: product history
CREATE INDEX idx_movements_tenant_product_created ON stock_movements (tenant_id, product_id, created_at);
--> statement-breakpoint
-- Products: category + status filtering
CREATE INDEX idx_products_tenant_category_status ON products (tenant_id, category, status);
--> statement-breakpoint
-- Shops: agent filtering
CREATE INDEX idx_shops_tenant_agent_status ON shops (tenant_id, agent_id, status);
--> statement-breakpoint
-- Daily plans: agent + date (most common query)
CREATE INDEX idx_plans_agent_date ON daily_plans (agent_id, plan_date);
--> statement-breakpoint
-- Agent locations: recent locations for GPS tracking
CREATE INDEX idx_locations_agent_created ON agent_locations (agent_id, created_at);
