-- Контрагенты: поставщики, поставки и платежи им.
--
-- Зеркало долга магазина. Там считается, сколько должны НАМ; здесь — сколько
-- должны МЫ: завод привёз товар на сумму, оплатили часть, остаток висит долгом.
-- До этого поставщика в системе не было вовсе: приход (arrivals) описывает
-- разгрузку машины, но не того, у кого товар куплен и сколько за него
-- причитается. Разбор устройства — в db/schema.ts рядом с определениями таблиц.
--
-- ── Почему этот файл не просто `CREATE TABLE` трижды ────────────────────────
--
-- 1 сентября 2026 миграция под этим номером уже гонялась на боевой базе — как
-- дырый прогон через START TRANSACTION/ROLLBACK, задуманный проверкой "не
-- сломается ли". MySQL фиксирует DDL сразу, ROLLBACK его не отменяет — все три
-- таблицы, их внешние ключи и индексы создались и остались, а сама миграция в
-- журнал (__drizzle_migrations) не попала. Три недели база жила с этими
-- таблицами вне учёта: пустые, приложение о них не знало.
--
-- Проверено 1 сентября 2026 через information_schema: структура на боевой базе
-- совпадает с этой миграцией колонка в колонку, ключ в ключ. Поэтому здесь не
-- обычный `CREATE TABLE` — каждое создание таблицы, ключа и индекса проверяет
-- information_schema и пропускает шаг, если объект уже есть. На проде это
-- применится вхолостую и впишет отметку в журнал миграций, чего не хватало.
-- На чистой базе создаст всё с нуля тем же способом, что и остальные объекты
-- проекта.
--
-- `CREATE TABLE IF NOT EXISTS` — стандартный MySQL, эта часть без обвязки.
-- Проверка нужна только там, где MySQL `IF NOT EXISTS` не понимает: у
-- `ALTER TABLE ADD CONSTRAINT` и у `CREATE INDEX`. Тот же приём, что и в
-- 0048_onec_tenant_foreign_keys.sql — SET из information_schema, IF, затем
-- PREPARE/EXECUTE/DEALLOCATE одной строкой.

CREATE TABLE IF NOT EXISTS `suppliers` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`contact_name` varchar(255),
	`phone` varchar(32),
	`inn` varchar(32),
	`address` varchar(500),
	`notes` text,
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `suppliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_supplier_name_tenant` UNIQUE(`name`,`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `supplies` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`supplier_id` bigint unsigned NOT NULL,
	`arrival_id` bigint unsigned,
	`supply_number` varchar(50) NOT NULL,
	`amount` decimal(15,2) NOT NULL,
	`currency` enum('UZS','USD') NOT NULL DEFAULT 'UZS',
	`rate_to_uzs` decimal(12,4),
	`supply_date` date NOT NULL,
	`due_date` date,
	`notes` text,
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `supplies_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_supply_number_tenant` UNIQUE(`supply_number`,`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `supplier_payments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`supplier_id` bigint unsigned NOT NULL,
	`supply_id` bigint unsigned NOT NULL,
	`amount` decimal(15,2) NOT NULL,
	`paid_uzs` decimal(15,2),
	`rate_to_uzs` decimal(12,4),
	`payment_method` enum('cash','card','transfer') NOT NULL DEFAULT 'transfer',
	`paid_at` timestamp NOT NULL DEFAULT (now()),
	`notes` text,
	`created_by` bigint unsigned,
	`idempotency_key` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `supplier_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_supplier_payment_idem` UNIQUE(`idempotency_key`,`tenant_id`)
);
--> statement-breakpoint

-- ── Внешние ключи ─────────────────────────────────────────────────────────────

-- suppliers_tenant_id_tenants_id_fk
SET @fk_suppliers_tenant := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'suppliers' AND CONSTRAINT_NAME = 'suppliers_tenant_id_tenants_id_fk'
);
--> statement-breakpoint
SET @ddl := IF(@fk_suppliers_tenant = 0, 'ALTER TABLE `suppliers` ADD CONSTRAINT `suppliers_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT', 'DO 0');
--> statement-breakpoint
PREPARE add_fk_suppliers_tenant FROM @ddl;
--> statement-breakpoint
EXECUTE add_fk_suppliers_tenant;
--> statement-breakpoint
DEALLOCATE PREPARE add_fk_suppliers_tenant;
--> statement-breakpoint

-- supplies_tenant_id_tenants_id_fk
SET @fk_supplies_tenant := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplies' AND CONSTRAINT_NAME = 'supplies_tenant_id_tenants_id_fk'
);
--> statement-breakpoint
SET @ddl := IF(@fk_supplies_tenant = 0, 'ALTER TABLE `supplies` ADD CONSTRAINT `supplies_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT', 'DO 0');
--> statement-breakpoint
PREPARE add_fk_supplies_tenant FROM @ddl;
--> statement-breakpoint
EXECUTE add_fk_supplies_tenant;
--> statement-breakpoint
DEALLOCATE PREPARE add_fk_supplies_tenant;
--> statement-breakpoint

-- supplies_supplier_id_suppliers_id_fk
SET @fk_supplies_supplier := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplies' AND CONSTRAINT_NAME = 'supplies_supplier_id_suppliers_id_fk'
);
--> statement-breakpoint
SET @ddl := IF(@fk_supplies_supplier = 0, 'ALTER TABLE `supplies` ADD CONSTRAINT `supplies_supplier_id_suppliers_id_fk` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT', 'DO 0');
--> statement-breakpoint
PREPARE add_fk_supplies_supplier FROM @ddl;
--> statement-breakpoint
EXECUTE add_fk_supplies_supplier;
--> statement-breakpoint
DEALLOCATE PREPARE add_fk_supplies_supplier;
--> statement-breakpoint

-- supplies_arrival_id_arrivals_id_fk
SET @fk_supplies_arrival := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplies' AND CONSTRAINT_NAME = 'supplies_arrival_id_arrivals_id_fk'
);
--> statement-breakpoint
SET @ddl := IF(@fk_supplies_arrival = 0, 'ALTER TABLE `supplies` ADD CONSTRAINT `supplies_arrival_id_arrivals_id_fk` FOREIGN KEY (`arrival_id`) REFERENCES `arrivals`(`id`) ON DELETE SET NULL', 'DO 0');
--> statement-breakpoint
PREPARE add_fk_supplies_arrival FROM @ddl;
--> statement-breakpoint
EXECUTE add_fk_supplies_arrival;
--> statement-breakpoint
DEALLOCATE PREPARE add_fk_supplies_arrival;
--> statement-breakpoint

-- supplies_created_by_users_id_fk
SET @fk_supplies_createdby := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplies' AND CONSTRAINT_NAME = 'supplies_created_by_users_id_fk'
);
--> statement-breakpoint
SET @ddl := IF(@fk_supplies_createdby = 0, 'ALTER TABLE `supplies` ADD CONSTRAINT `supplies_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT', 'DO 0');
--> statement-breakpoint
PREPARE add_fk_supplies_createdby FROM @ddl;
--> statement-breakpoint
EXECUTE add_fk_supplies_createdby;
--> statement-breakpoint
DEALLOCATE PREPARE add_fk_supplies_createdby;
--> statement-breakpoint

-- supplier_payments_tenant_id_tenants_id_fk
SET @fk_suppay_tenant := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_payments' AND CONSTRAINT_NAME = 'supplier_payments_tenant_id_tenants_id_fk'
);
--> statement-breakpoint
SET @ddl := IF(@fk_suppay_tenant = 0, 'ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payments_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT', 'DO 0');
--> statement-breakpoint
PREPARE add_fk_suppay_tenant FROM @ddl;
--> statement-breakpoint
EXECUTE add_fk_suppay_tenant;
--> statement-breakpoint
DEALLOCATE PREPARE add_fk_suppay_tenant;
--> statement-breakpoint

-- supplier_payments_supplier_id_suppliers_id_fk
SET @fk_suppay_supplier := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_payments' AND CONSTRAINT_NAME = 'supplier_payments_supplier_id_suppliers_id_fk'
);
--> statement-breakpoint
SET @ddl := IF(@fk_suppay_supplier = 0, 'ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payments_supplier_id_suppliers_id_fk` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT', 'DO 0');
--> statement-breakpoint
PREPARE add_fk_suppay_supplier FROM @ddl;
--> statement-breakpoint
EXECUTE add_fk_suppay_supplier;
--> statement-breakpoint
DEALLOCATE PREPARE add_fk_suppay_supplier;
--> statement-breakpoint

-- supplier_payments_supply_id_supplies_id_fk
SET @fk_suppay_supply := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_payments' AND CONSTRAINT_NAME = 'supplier_payments_supply_id_supplies_id_fk'
);
--> statement-breakpoint
SET @ddl := IF(@fk_suppay_supply = 0, 'ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payments_supply_id_supplies_id_fk` FOREIGN KEY (`supply_id`) REFERENCES `supplies`(`id`) ON DELETE RESTRICT', 'DO 0');
--> statement-breakpoint
PREPARE add_fk_suppay_supply FROM @ddl;
--> statement-breakpoint
EXECUTE add_fk_suppay_supply;
--> statement-breakpoint
DEALLOCATE PREPARE add_fk_suppay_supply;
--> statement-breakpoint

-- supplier_payments_created_by_users_id_fk
SET @fk_suppay_createdby := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_payments' AND CONSTRAINT_NAME = 'supplier_payments_created_by_users_id_fk'
);
--> statement-breakpoint
SET @ddl := IF(@fk_suppay_createdby = 0, 'ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payments_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT', 'DO 0');
--> statement-breakpoint
PREPARE add_fk_suppay_createdby FROM @ddl;
--> statement-breakpoint
EXECUTE add_fk_suppay_createdby;
--> statement-breakpoint
DEALLOCATE PREPARE add_fk_suppay_createdby;
--> statement-breakpoint



-- ── Индексы ──────────────────────────────────────────────────────────────────

-- idx_suppliers_tenant
SET @idx_suppliers_tenant := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'suppliers' AND INDEX_NAME = 'idx_suppliers_tenant'
);
--> statement-breakpoint
SET @ddl := IF(@idx_suppliers_tenant = 0, 'CREATE INDEX `idx_suppliers_tenant` ON `suppliers` (`tenant_id`)', 'DO 0');
--> statement-breakpoint
PREPARE add_idx_suppliers_tenant FROM @ddl;
--> statement-breakpoint
EXECUTE add_idx_suppliers_tenant;
--> statement-breakpoint
DEALLOCATE PREPARE add_idx_suppliers_tenant;
--> statement-breakpoint

-- idx_suppliers_tenant_status
SET @idx_suppliers_tenant_status := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'suppliers' AND INDEX_NAME = 'idx_suppliers_tenant_status'
);
--> statement-breakpoint
SET @ddl := IF(@idx_suppliers_tenant_status = 0, 'CREATE INDEX `idx_suppliers_tenant_status` ON `suppliers` (`tenant_id`,`status`)', 'DO 0');
--> statement-breakpoint
PREPARE add_idx_suppliers_tenant_status FROM @ddl;
--> statement-breakpoint
EXECUTE add_idx_suppliers_tenant_status;
--> statement-breakpoint
DEALLOCATE PREPARE add_idx_suppliers_tenant_status;
--> statement-breakpoint

-- idx_supplies_tenant
SET @idx_supplies_tenant := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplies' AND INDEX_NAME = 'idx_supplies_tenant'
);
--> statement-breakpoint
SET @ddl := IF(@idx_supplies_tenant = 0, 'CREATE INDEX `idx_supplies_tenant` ON `supplies` (`tenant_id`)', 'DO 0');
--> statement-breakpoint
PREPARE add_idx_supplies_tenant FROM @ddl;
--> statement-breakpoint
EXECUTE add_idx_supplies_tenant;
--> statement-breakpoint
DEALLOCATE PREPARE add_idx_supplies_tenant;
--> statement-breakpoint

-- idx_supplies_tenant_supplier_date
SET @idx_supplies_tenant_supplier_date := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplies' AND INDEX_NAME = 'idx_supplies_tenant_supplier_date'
);
--> statement-breakpoint
SET @ddl := IF(@idx_supplies_tenant_supplier_date = 0, 'CREATE INDEX `idx_supplies_tenant_supplier_date` ON `supplies` (`tenant_id`,`supplier_id`,`supply_date`)', 'DO 0');
--> statement-breakpoint
PREPARE add_idx_supplies_tenant_supplier_date FROM @ddl;
--> statement-breakpoint
EXECUTE add_idx_supplies_tenant_supplier_date;
--> statement-breakpoint
DEALLOCATE PREPARE add_idx_supplies_tenant_supplier_date;
--> statement-breakpoint

-- idx_supplies_tenant_due
SET @idx_supplies_tenant_due := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplies' AND INDEX_NAME = 'idx_supplies_tenant_due'
);
--> statement-breakpoint
SET @ddl := IF(@idx_supplies_tenant_due = 0, 'CREATE INDEX `idx_supplies_tenant_due` ON `supplies` (`tenant_id`,`due_date`)', 'DO 0');
--> statement-breakpoint
PREPARE add_idx_supplies_tenant_due FROM @ddl;
--> statement-breakpoint
EXECUTE add_idx_supplies_tenant_due;
--> statement-breakpoint
DEALLOCATE PREPARE add_idx_supplies_tenant_due;
--> statement-breakpoint

-- idx_supplier_payments_tenant
SET @idx_suppay_tenant := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_payments' AND INDEX_NAME = 'idx_supplier_payments_tenant'
);
--> statement-breakpoint
SET @ddl := IF(@idx_suppay_tenant = 0, 'CREATE INDEX `idx_supplier_payments_tenant` ON `supplier_payments` (`tenant_id`)', 'DO 0');
--> statement-breakpoint
PREPARE add_idx_suppay_tenant FROM @ddl;
--> statement-breakpoint
EXECUTE add_idx_suppay_tenant;
--> statement-breakpoint
DEALLOCATE PREPARE add_idx_suppay_tenant;
--> statement-breakpoint

-- idx_supplier_payments_supply
SET @idx_suppay_supply := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_payments' AND INDEX_NAME = 'idx_supplier_payments_supply'
);
--> statement-breakpoint
SET @ddl := IF(@idx_suppay_supply = 0, 'CREATE INDEX `idx_supplier_payments_supply` ON `supplier_payments` (`supply_id`)', 'DO 0');
--> statement-breakpoint
PREPARE add_idx_suppay_supply FROM @ddl;
--> statement-breakpoint
EXECUTE add_idx_suppay_supply;
--> statement-breakpoint
DEALLOCATE PREPARE add_idx_suppay_supply;
--> statement-breakpoint

-- idx_supplier_payments_tenant_supplier
SET @idx_suppay_tenant_supplier := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_payments' AND INDEX_NAME = 'idx_supplier_payments_tenant_supplier'
);
--> statement-breakpoint
SET @ddl := IF(@idx_suppay_tenant_supplier = 0, 'CREATE INDEX `idx_supplier_payments_tenant_supplier` ON `supplier_payments` (`tenant_id`,`supplier_id`,`paid_at`)', 'DO 0');
--> statement-breakpoint
PREPARE add_idx_suppay_tenant_supplier FROM @ddl;
--> statement-breakpoint
EXECUTE add_idx_suppay_tenant_supplier;
--> statement-breakpoint
DEALLOCATE PREPARE add_idx_suppay_tenant_supplier;
--> statement-breakpoint
