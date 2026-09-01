-- Ключ идемпотентности для магазинов.
--
-- Создание магазина было голой вставкой: ни проверки на уже существующий, ни
-- ключа попытки, ни уникального индекса — в отличие от заказа, у которого
-- защит три (предварительная проверка ключа, уникальный индекс и разбор
-- ER_DUP_ENTRY). Поэтому заказы не двоятся, а магазины двоятся.
--
-- Сценарий из поля: агент жмёт «Создать магазин», запрос доходит и строка
-- коммитится, но ответ не возвращается — связь оборвалась. Клиент показывает
-- ошибку, форма остаётся заполненной, агент жмёт снова. На момент этой
-- миграции в базе 114 таких групп, созданных из приложения одним и тем же
-- агентом с интервалом от нуля до десяти секунд, и ещё 55 групп из массового
-- импорта. Всего 178 лишних строк на 3163 магазина.
--
-- Столбец необязательный, и это условие безопасности самой миграции: в MySQL
-- уникальный индекс не считает NULL-ы одинаковыми, поэтому 3163 существующие
-- строки без ключа не конфликтуют ни друг с другом, ни с уже имеющимися
-- дублями. Индекс встаёт на живую таблицу и не может уронить запуск сервера —
-- в отличие от уникального индекса по (tenant_id, name), который отказался бы
-- создаваться на первой же существующей паре и утащил бы за собой деплой.
--
-- Уже накопленные дубликаты эта миграция не трогает. Отличить повтор от двух
-- честных магазинов с одинаковым названием на разных улицах может только
-- человек, знающий район; молча склеивать чужой справочник миграция не вправе.
-- Их разбор — отдельная задача с глазами владельца.
--
-- Идемпотентность миграции сделана переносимо, через information_schema и
-- подготовленный запрос: `ADD COLUMN IF NOT EXISTS` — синтаксис MariaDB,
-- MySQL его отвергает, и на этом уже спотыкалась миграция 0038.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'shops'
    AND COLUMN_NAME = 'idempotency_key'
);
--> statement-breakpoint
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE `shops` ADD COLUMN `idempotency_key` varchar(64) NULL',
  'DO 0');
--> statement-breakpoint
PREPARE add_shop_idem_col FROM @ddl;
--> statement-breakpoint
EXECUTE add_shop_idem_col;
--> statement-breakpoint
DEALLOCATE PREPARE add_shop_idem_col;
--> statement-breakpoint
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'shops'
    AND INDEX_NAME = 'uq_shops_idempotency'
);
--> statement-breakpoint
SET @ddl_idx := IF(@idx_exists = 0,
  'CREATE UNIQUE INDEX `uq_shops_idempotency` ON `shops` (`tenant_id`, `idempotency_key`)',
  'DO 0');
--> statement-breakpoint
PREPARE add_shop_idem_idx FROM @ddl_idx;
--> statement-breakpoint
EXECUTE add_shop_idem_idx;
--> statement-breakpoint
DEALLOCATE PREPARE add_shop_idem_idx;
