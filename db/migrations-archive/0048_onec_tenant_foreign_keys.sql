-- Внешние ключи на tenant_id у таблиц обмена с 1С.
--
-- ── Откуда взялся долг ───────────────────────────────────────────────────────
--
-- Это остаток миграции 0019, которая не применилась целиком: её первая строка
-- `DROP INDEX IF EXISTS ... ON ...` — синтаксис MariaDB, MySQL его отвергает, и
-- выполнение обрывалось на ней. Часть задуманного 0019 всё же появилась позже
-- сама — через `drizzle push`, который создаёт объекты по схеме и даёт им свои
-- имена. Так в базе оказались индексы shops(territory_id), sales_targets(shop_id)
-- и ключ payments.order_id — под именами вида
-- shops_territory_id_territories_id_fk вместо задуманных idx_shops_territory.
--
-- А вот два ключа на tenants не появились ниоткуда: в схеме drizzle их нет, и
-- досыпать их было некому. Они добавляются здесь.
--
-- ── Что это меняет ───────────────────────────────────────────────────────────
--
-- Записи обмена с 1С привязаны к фирме полем tenant_id, но база этого не знала
-- и не проверяла. Удаление фирмы оставляло её сопоставления идентификаторов и
-- состояния синхронизации висеть в таблицах — с указателем на фирму, которой
-- больше нет. Дальше такие строки участвуют в выборках обмена и подсовывают
-- чужие соответствия.
--
-- ON DELETE CASCADE, как и задумывала 0019: сопоставления идентификаторов не
-- имеют смысла отдельно от фирмы, для которой заведены.
--
-- ── Про безопасность применения ──────────────────────────────────────────────
--
-- Проверено на боевой базе перед миграцией: осиротевших строк ноль в обеих
-- таблицах, типы колонок совпадают с tenants.id (bigint unsigned) — то есть
-- ключ встанет, а не упадёт на несовпадении. Третий ключ из 0019,
-- payments.order_id, уже существует под именем payments_order_id_orders_id_fk и
-- здесь не трогается.
--
-- Идемпотентность — через information_schema и подготовленный запрос:
-- `ADD CONSTRAINT IF NOT EXISTS` MySQL не понимает, и именно на такой строке
-- встали 0019 и 0038.

-- ── id_mappings ──────────────────────────────────────────────────────────────
SET @fk_idmap := (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'id_mappings'
    AND COLUMN_NAME = 'tenant_id'
    AND REFERENCED_TABLE_NAME = 'tenants'
);
--> statement-breakpoint
SET @ddl := IF(@fk_idmap = 0,
  'ALTER TABLE `id_mappings` ADD CONSTRAINT `fk_idmappings_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE',
  'DO 0');
--> statement-breakpoint
PREPARE add_fk_idmap FROM @ddl;
--> statement-breakpoint
EXECUTE add_fk_idmap;
--> statement-breakpoint
DEALLOCATE PREPARE add_fk_idmap;
--> statement-breakpoint

-- ── sync_status ──────────────────────────────────────────────────────────────
SET @fk_sync := (
  SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sync_status'
    AND COLUMN_NAME = 'tenant_id'
    AND REFERENCED_TABLE_NAME = 'tenants'
);
--> statement-breakpoint
SET @ddl := IF(@fk_sync = 0,
  'ALTER TABLE `sync_status` ADD CONSTRAINT `fk_syncstatus_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE',
  'DO 0');
--> statement-breakpoint
PREPARE add_fk_sync FROM @ddl;
--> statement-breakpoint
EXECUTE add_fk_sync;
--> statement-breakpoint
DEALLOCATE PREPARE add_fk_sync;
