-- Migration 0009: Fix multi-warehouse support and add CASCADE/SET NULL rules
-- This migration fixes critical schema issues:
-- 1. warehouse_stock unique index now includes warehouse_id (multi-warehouse support)
-- 2. warehouse_stock.warehouse_id is now NOT NULL
-- 3. Nullable FKs now have ON DELETE SET NULL
-- 4. id_mappings and sync_status now have FK to tenants
-- 5. warehouses.status and api_keys.status changed to enum

-- Step 1: сначала СОЗДАЁМ новый индекс, потом удаляем старый.
--
-- Обратный порядок (как было здесь изначально) на чистой базе падает:
--
--   ER_DROP_INDEX_FK (1553): Cannot drop index 'uq_stock_product_tenant':
--   needed in a foreign key constraint
--
-- У product_id есть внешний ключ на products.id, а uq_stock_product_tenant —
-- единственный индекс, который его покрывает. MySQL не даёт снять последнюю
-- опору внешнего ключа. Новый индекс начинается с того же product_id, поэтому
-- после его создания старый снимается свободно.
--
-- Ту же поломку позже обошли в миграции 0029 — но до неё цепочка на чистой
-- базе просто не доходила: она умирала здесь. Продакшн жив потому, что его
-- схема собиралась постепенно, а не накатом с нуля.
ALTER TABLE warehouse_stock ADD UNIQUE INDEX uq_stock_product_warehouse (product_id, warehouse_id, tenant_id);
--> statement-breakpoint
ALTER TABLE warehouse_stock DROP INDEX uq_stock_product_tenant;
--> statement-breakpoint
-- Step 2: Make warehouse_id NOT NULL (set to default warehouse first)
-- First, ensure default warehouse exists for all tenants
INSERT IGNORE INTO warehouses (tenant_id, name, address, city, is_default, status, created_at, updated_at)
SELECT t.id, 'Основной склад', 'Не указан', t.city, true, 'active', NOW(), NOW()
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.tenant_id = t.id AND w.is_default = true);
--> statement-breakpoint
-- Update stock records with NULL warehouse_id to use default warehouse
UPDATE warehouse_stock ws
JOIN warehouses w ON w.tenant_id = ws.tenant_id AND w.is_default = true
SET ws.warehouse_id = w.id
WHERE ws.warehouse_id IS NULL;
--> statement-breakpoint
-- Now make warehouse_id NOT NULL
ALTER TABLE warehouse_stock MODIFY warehouse_id BIGINT UNSIGNED NOT NULL;
--> statement-breakpoint
-- Step 3: Add ON DELETE SET NULL for nullable FKs
-- shops.agent_id
ALTER TABLE shops DROP FOREIGN KEY shops_ibfk_1;
--> statement-breakpoint
ALTER TABLE shops ADD CONSTRAINT fk_shops_agent FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
-- orders.courier_id
ALTER TABLE orders DROP FOREIGN KEY orders_ibfk_2;
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT fk_orders_courier FOREIGN KEY (courier_id) REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
-- daily_plans.created_by
ALTER TABLE daily_plans DROP FOREIGN KEY daily_plans_ibfk_1;
--> statement-breakpoint
ALTER TABLE daily_plans ADD CONSTRAINT fk_plans_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
-- payments.created_by
ALTER TABLE payments DROP FOREIGN KEY payments_ibfk_1;
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT fk_payments_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
-- stock_transfers.created_by
ALTER TABLE stock_transfers DROP FOREIGN KEY stock_transfers_ibfk_1;
--> statement-breakpoint
ALTER TABLE stock_transfers ADD CONSTRAINT fk_transfers_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
-- Step 4: Add FK constraints for id_mappings and sync_status
ALTER TABLE id_mappings ADD CONSTRAINT fk_idmappings_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE sync_status ADD CONSTRAINT fk_syncstatus_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
--> statement-breakpoint
-- Step 5: Add FK with CASCADE for warehouse_stock.warehouse_id
ALTER TABLE warehouse_stock DROP FOREIGN KEY warehouse_stock_ibfk_1;
--> statement-breakpoint
ALTER TABLE warehouse_stock ADD CONSTRAINT fk_stock_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE;
--> statement-breakpoint
-- Step 6: Change warehouses.status to enum (data already valid)
ALTER TABLE warehouses MODIFY status ENUM('active', 'inactive') DEFAULT 'active' NOT NULL;
--> statement-breakpoint
-- Step 7: Change api_keys.status to enum (data already valid)
ALTER TABLE api_keys MODIFY status ENUM('active', 'inactive') DEFAULT 'active' NOT NULL;
