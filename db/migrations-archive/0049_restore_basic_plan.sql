-- Вернуть тариф Basic в перечисление: владелец отменил решение убрать его.
--
-- ── Почему не откатом миграции 0047 ──────────────────────────────────────────
--
-- Код возвращён через `git revert` коммита, убравшего Basic. Но 0047 к тому
-- моменту УЖЕ применилась на боевой базе: perечисление там сузилось до
-- ('trial','pro','exclusive'). Удалить файл 0047 из истории вместе с кодом
-- было бы неправдой — миграция выполнялась, запись о ней в
-- __drizzle_migrations стоит, и на чистой базе порядок должен воспроизводиться
-- как было. Поэтому 0047 остаётся как есть, а перечисление раздвигается
-- обратно отдельным шагом. История читается честно: сузили, потом передумали.
--
-- ── Про сохранность данных ───────────────────────────────────────────────────
--
-- Расширение перечисления ничего не теряет: ни одна существующая строка своё
-- значение не меняет, ни trial, ни pro, ни exclusive. Добавляется лишь ещё
-- одно допустимое. Обратный порядок (сужение) опасен — там MySQL молча кладёт
-- пустую строку в строки с исчезающим значением, — но здесь как раз обратный
-- случай.
--
-- Порядок значений в перечислении важен: он должен совпадать с db/schema.ts,
-- иначе drizzle при следующем generate увидит расхождение и предложит лишнюю
-- миграцию. Basic возвращается на своё исходное место, вторым.
--
-- ── Про вид записи ───────────────────────────────────────────────────────────
--
-- MODIFY COLUMN не имеет IF-формы, поэтому смена типа завёрнута в проверку
-- information_schema: повторный прогон миграции должен быть безобидным. Тот же
-- приём, что в 0046, 0047 и 0048.

-- ── tenants ──────────────────────────────────────────────────────────────────
SET @нет_basic := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tenants'
    AND COLUMN_NAME = 'plan'
    AND COLUMN_TYPE NOT LIKE '%basic%'
);
--> statement-breakpoint
SET @ddl := IF(@нет_basic > 0,
  'ALTER TABLE `tenants` MODIFY COLUMN `plan` ENUM(''trial'',''basic'',''pro'',''exclusive'') NOT NULL DEFAULT ''trial''',
  'DO 0');
--> statement-breakpoint
PREPARE вернуть_tenants FROM @ddl;
--> statement-breakpoint
EXECUTE вернуть_tenants;
--> statement-breakpoint
DEALLOCATE PREPARE вернуть_tenants;
--> statement-breakpoint

-- ── subscriptions ────────────────────────────────────────────────────────────
SET @нет_basic_sub := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'subscriptions'
    AND COLUMN_NAME = 'plan'
    AND COLUMN_TYPE NOT LIKE '%basic%'
);
--> statement-breakpoint
SET @ddl := IF(@нет_basic_sub > 0,
  'ALTER TABLE `subscriptions` MODIFY COLUMN `plan` ENUM(''trial'',''basic'',''pro'',''exclusive'') NOT NULL DEFAULT ''trial''',
  'DO 0');
--> statement-breakpoint
PREPARE вернуть_subs FROM @ddl;
--> statement-breakpoint
EXECUTE вернуть_subs;
--> statement-breakpoint
DEALLOCATE PREPARE вернуть_subs;
