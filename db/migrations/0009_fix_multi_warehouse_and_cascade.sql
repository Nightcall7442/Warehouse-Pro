-- Migration 0009: Fix multi-warehouse support and add CASCADE/SET NULL rules
-- This migration fixes critical schema issues:
-- 1. warehouse_stock unique index now includes warehouse_id (multi-warehouse support)
-- 2. warehouse_stock.warehouse_id is now NOT NULL
-- 3. Nullable FKs now have ON DELETE SET NULL
-- 4. id_mappings and sync_status now have FK to tenants
-- 5. warehouses.status and api_keys.status changed to enum

-- Step 1: Drop old unique index and create new one
ALTER TABLE warehouse_stock DROP INDEX uq_stock_product_tenant;
ALTER TABLE warehouse_stock ADD UNIQUE INDEX uq_stock_product_warehouse (product_id, warehouse_id, tenant_id);

-- Step 2: Make warehouse_id NOT NULL (set to default warehouse first)
-- First, ensure default warehouse exists for all tenants
INSERT IGNORE INTO warehouses (tenant_id, name, address, city, is_default, status, created_at, updated_at)
SELECT t.id, 'Основной склад', 'Не указан', t.city, true, 'active', NOW(), NOW()
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.tenant_id = t.id AND w.is_default = true);

-- Update stock records with NULL warehouse_id to use default warehouse
UPDATE warehouse_stock ws
JOIN warehouses w ON w.tenant_id = ws.tenant_id AND w.is_default = true
SET ws.warehouse_id = w.id
WHERE ws.warehouse_id IS NULL;

-- Now make warehouse_id NOT NULL
ALTER TABLE warehouse_stock MODIFY warehouse_id BIGINT UNSIGNED NOT NULL;

-- Step 3: Add ON DELETE SET NULL for nullable FKs
-- shops.agent_id
ALTER TABLE shops DROP FOREIGN KEY shops_ibfk_1;
ALTER TABLE shops ADD CONSTRAINT fk_shops_agent FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE SET NULL;

-- orders.courier_id
ALTER TABLE orders DROP FOREIGN KEY orders_ibfk_2;
ALTER TABLE orders ADD CONSTRAINT fk_orders_courier FOREIGN KEY (courier_id) REFERENCES users(id) ON DELETE SET NULL;

-- daily_plans.created_by
ALTER TABLE daily_plans DROP FOREIGN KEY daily_plans_ibfk_1;
ALTER TABLE daily_plans ADD CONSTRAINT fk_plans_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

-- payments.created_by
ALTER TABLE payments DROP FOREIGN KEY payments_ibfk_1;
ALTER TABLE payments ADD CONSTRAINT fk_payments_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

-- stock_transfers.created_by
ALTER TABLE stock_transfers DROP FOREIGN KEY stock_transfers_ibfk_1;
ALTER TABLE stock_transfers ADD CONSTRAINT fk_transfers_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

-- Step 4: Add FK constraints for id_mappings and sync_status
ALTER TABLE id_mappings ADD CONSTRAINT fk_idmappings_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE sync_status ADD CONSTRAINT fk_syncstatus_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- Step 5: Add FK with CASCADE for warehouse_stock.warehouse_id
ALTER TABLE warehouse_stock DROP FOREIGN KEY warehouse_stock_ibfk_1;
ALTER TABLE warehouse_stock ADD CONSTRAINT fk_stock_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE;

-- Step 6: Change warehouses.status to enum (data already valid)
ALTER TABLE warehouses MODIFY status ENUM('active', 'inactive') DEFAULT 'active' NOT NULL;

-- Step 7: Change api_keys.status to enum (data already valid)
ALTER TABLE api_keys MODIFY status ENUM('active', 'inactive') DEFAULT 'active' NOT NULL;
