-- Повторная попытка добавить daily_plans.visited_at.
--
-- Миграция 0038 не применилась и не могла: у записи 0020 в журнале стоит метка
-- 1786600000000 — выдуманная дата 13 августа, проставленная вручную. Drizzle
-- применяет только записи новее последней применённой, поэтому всё с 0021 по
-- 0038 он пропускает молча. Здесь метка выше 1786600000000, иначе эта миграция
-- была бы пропущена так же.
--
-- Вторая причина: 0038 написана как `ADD COLUMN IF NOT EXISTS`. Это синтаксис
-- MariaDB, MySQL его не понимает, так что даже дойди до неё очередь — она бы
-- упала. Идемпотентность здесь сделана переносимо: проверка по
-- information_schema и подготовленный запрос, который в случае уже
-- существующей колонки не делает ничего.
--
-- Следствие отсутствия колонки было не косметическим: любая вставка в
-- daily_plans падала с ER_BAD_FIELD_ERROR, потому что drizzle перечисляет во
-- вставке все колонки схемы. Супервайзер не мог назначить ни одного плана
-- визита — ни с телефона, ни из веба.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'daily_plans'
    AND COLUMN_NAME = 'visited_at'
);
--> statement-breakpoint
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE `daily_plans` ADD COLUMN `visited_at` timestamp NULL',
  'DO 0');
--> statement-breakpoint
PREPARE add_visited_at FROM @ddl;
--> statement-breakpoint
EXECUTE add_visited_at;
--> statement-breakpoint
DEALLOCATE PREPARE add_visited_at;
