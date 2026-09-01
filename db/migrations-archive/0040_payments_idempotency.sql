-- Ключ идемпотентности для платежей.
--
-- Оплата, отправленная дважды, до сих пор записывалась двумя строками, и долг
-- магазина уменьшался вдвое. Поводов для повтора хватает: сорванная связь и
-- ретрай, второй клик по кнопке, две открытые вкладки, повторная отправка из
-- 1С. Проверка «нет ли уже такого платежа» была только в 1С-вебхуке, стояла
-- вне транзакции и сравнивала текст заметки — два одновременных ретрая
-- проходили её оба.
--
-- Столбец необязательный, и это ключевое условие безопасности самой миграции:
-- в MySQL уникальный индекс не считает NULL-ы одинаковыми, поэтому строки с
-- пустым ключом не конфликтуют ни друг с другом, ни со сколькими угодно
-- прежними дублями. Индекс встаёт на живую таблицу без разбора старых данных
-- и не может уронить запуск сервера — в отличие от уникального индекса по
-- сумме и магазину, который на первом же существующем дубле отказался бы
-- создаваться, а вместе с ним не поднялось бы и приложение.
--
-- Побочный эффект такого выбора: старые платежи задним числом не
-- дедуплицируются. Это осознанно — отличить случайный повтор от двух честных
-- оплат одинаковой суммы можно только глазами владельца, и молча стирать
-- чужие деньги миграция не вправе.
--
-- Идемпотентность самой миграции сделана переносимо: проверка по
-- information_schema и подготовленный запрос. Простое ADD COLUMN упало бы при
-- повторном прогоне, а `IF NOT EXISTS` — синтаксис MariaDB, которого MySQL не
-- понимает; на этом уже спотыкалась миграция 0038.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'payments'
    AND COLUMN_NAME = 'idempotency_key'
);
--> statement-breakpoint
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE `payments` ADD COLUMN `idempotency_key` varchar(100) NULL',
  'DO 0');
--> statement-breakpoint
PREPARE add_idem_col FROM @ddl;
--> statement-breakpoint
EXECUTE add_idem_col;
--> statement-breakpoint
DEALLOCATE PREPARE add_idem_col;
--> statement-breakpoint
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'payments'
    AND INDEX_NAME = 'uq_payments_idempotency'
);
--> statement-breakpoint
SET @ddl_idx := IF(@idx_exists = 0,
  'CREATE UNIQUE INDEX `uq_payments_idempotency` ON `payments` (`tenant_id`, `idempotency_key`)',
  'DO 0');
--> statement-breakpoint
PREPARE add_idem_idx FROM @ddl_idx;
--> statement-breakpoint
EXECUTE add_idem_idx;
--> statement-breakpoint
DEALLOCATE PREPARE add_idem_idx;
