-- Снять устаревший уникальный индекс на остатках и доложить индексы под запросы KPI.
--
-- ── Зачем снимать uq_stock_product_tenant ────────────────────────────────────
--
-- В warehouse_stock лежат ДВА уникальных индекса сразу:
--
--   uq_stock_product_warehouse_tenant (product_id, warehouse_id, tenant_id) — нужный
--   uq_stock_product_tenant           (product_id, tenant_id)               — старый
--
-- Второй должна была снять миграция 0019, но она не применилась: её первая
-- строка — `DROP INDEX IF EXISTS ... ON ...`, а это синтаксис MariaDB, MySQL его
-- отвергает. Ровно та же ловушка, на которой встала 0038 с `ADD COLUMN IF NOT
-- EXISTS`. Нужные ей индексы в базе всё-таки есть, но появились они позже сами
-- собой, через `drizzle push`, и потому названы по-другому:
-- shops_territory_id_territories_id_fk вместо idx_shops_territory и так далее.
-- А вот DROP выполнить было некому.
--
-- Что это значит на деле: пара (товар, фирма) обязана быть уникальной, то есть
-- ОДИН ТОВАР МОЖЕТ ЛЕЖАТЬ ТОЛЬКО НА ОДНОМ СКЛАДЕ. Пока ни у одной фирмы нет
-- второго склада, поэтому никто не наткнулся. Первая же фирма, которая заведёт
-- второй склад и положит туда товар с первого, получит отказ по дублю ключа —
-- и увидит его как невнятную ошибку добавления, без единого намёка на причину.
--
-- Снимать безопасно: проверено на боевой базе перед миграцией — товаров,
-- лежащих больше чем на одном складе, ноль, дублей по тройке ноль. Внешний ключ
-- warehouse_stock_product_id_products_id_fk без индекса не останется:
-- uq_stock_product_warehouse_tenant начинается с product_id, и MySQL берёт его.
--
-- ── Зачем три индекса, а не четыре ───────────────────────────────────────────
--
-- Миграция 0018 задумывала четыре индекса под запросы KPI и тоже не применилась.
-- Три из них ложатся на реальные запросы точно:
--
--   returns(tenant_id, agent_id, created_at)
--     api/services/kpi.ts — равенство по фирме и агенту, диапазон по дате;
--   visit_reports(tenant_id, user_id, created_at)
--     api/services/kpi.ts — то же самое, сейчас есть только (tenant_id, user_id);
--   orders(tenant_id, courier_id, created_at)
--     api/courier-router.ts — равенство по фирме и курьеру, затем
--     ORDER BY created_at DESC LIMIT 50; третья колонка снимает сортировку.
--
-- Четвёртый, agent_locations(tenant_id, agent_id, created_at), НЕ добавляется.
-- Ни один запрос под него не подходит: там, где есть диапазон по дате, агент не
-- сравнивается на равенство, а группируется — и такому запросу нужен
-- (tenant_id, created_at), который уже стоит как idx_locations_tenant_created.
-- Остальные выборки фильтруют по COALESCE(recorded_at, created_at); это
-- выражение, и обычный индекс по колонке к нему неприменим в принципе. Класть
-- индекс, который никогда не выберет оптимизатор, значит платить за него на
-- каждой записи впустую.
--
-- Таблицы маленькие (agent_locations 3175 строк, orders 1179, returns и
-- visit_reports пустые), так что индексы встают мгновенно и делаются на вырост,
-- а не ради сегодняшней скорости.
--
-- ── Почему такой громоздкий вид ──────────────────────────────────────────────
--
-- Каждый шаг сперва смотрит в information_schema и лишь потом решает. Коротких
-- `IF EXISTS` в MySQL для индексов нет — именно на них споткнулись 0019 и 0038.
-- Заодно миграция становится повторяемой: применённая дважды, второй раз она
-- ничего не делает.

-- ── 1. Снять старый уникальный индекс ────────────────────────────────────────
SET @stale_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'warehouse_stock'
    AND INDEX_NAME = 'uq_stock_product_tenant'
);
--> statement-breakpoint
SET @ddl := IF(@stale_idx > 0,
  'DROP INDEX `uq_stock_product_tenant` ON `warehouse_stock`',
  'DO 0');
--> statement-breakpoint
PREPARE drop_stale_stock_idx FROM @ddl;
--> statement-breakpoint
EXECUTE drop_stale_stock_idx;
--> statement-breakpoint
DEALLOCATE PREPARE drop_stale_stock_idx;
--> statement-breakpoint

-- ── 2. returns(tenant_id, agent_id, created_at) ──────────────────────────────
SET @idx_returns := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'returns'
    AND INDEX_NAME = 'idx_returns_agent_date'
);
--> statement-breakpoint
SET @ddl := IF(@idx_returns = 0,
  'CREATE INDEX `idx_returns_agent_date` ON `returns` (`tenant_id`, `agent_id`, `created_at`)',
  'DO 0');
--> statement-breakpoint
PREPARE add_returns_idx FROM @ddl;
--> statement-breakpoint
EXECUTE add_returns_idx;
--> statement-breakpoint
DEALLOCATE PREPARE add_returns_idx;
--> statement-breakpoint

-- ── 3. visit_reports(tenant_id, user_id, created_at) ─────────────────────────
SET @idx_visits := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'visit_reports'
    AND INDEX_NAME = 'idx_visit_reports_user_date'
);
--> statement-breakpoint
SET @ddl := IF(@idx_visits = 0,
  'CREATE INDEX `idx_visit_reports_user_date` ON `visit_reports` (`tenant_id`, `user_id`, `created_at`)',
  'DO 0');
--> statement-breakpoint
PREPARE add_visits_idx FROM @ddl;
--> statement-breakpoint
EXECUTE add_visits_idx;
--> statement-breakpoint
DEALLOCATE PREPARE add_visits_idx;
--> statement-breakpoint

-- ── 4. orders(tenant_id, courier_id, created_at) ─────────────────────────────
SET @idx_courier := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND INDEX_NAME = 'idx_orders_courier_date'
);
--> statement-breakpoint
SET @ddl := IF(@idx_courier = 0,
  'CREATE INDEX `idx_orders_courier_date` ON `orders` (`tenant_id`, `courier_id`, `created_at`)',
  'DO 0');
--> statement-breakpoint
PREPARE add_courier_idx FROM @ddl;
--> statement-breakpoint
EXECUTE add_courier_idx;
--> statement-breakpoint
DEALLOCATE PREPARE add_courier_idx;
