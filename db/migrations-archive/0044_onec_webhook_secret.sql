-- Секрет вебхука 1С — свой у каждой организации.
--
-- Вебхук проверял ОДИН секрет на всю платформу (ONEC_WEBHOOK_SECRET), а
-- организацию брал из тела запроса:
--
--   if (!safeEqual(header, env.onecWebhookSecret)) return 401;
--   const tenantId = Number(body.tenantId);          -- и ему верили
--
-- Секрет такого рода известен каждому клиенту с интеграцией и каждому
-- подрядчику, который её настраивал. Любой из них мог прислать чужой tenantId
-- и провести платёж по чужому магазину (уменьшив его долг) или переписать
-- чужие остатки через /stock. Изоляция организаций, выстроенная во всём
-- остальном приложении, здесь не работала. В коде это было признано строкой
-- `TODO: Replace global secret with per-tenant webhook secret for proper
-- isolation`.
--
-- Теперь хранится SHA-256 секрета, поиск конфигурации идёт по хешу, а
-- организация берётся из найденной строки. Тело запроса перестаёт быть
-- источником доверия: подделать чужой tenantId нельзя, не зная её секрета.
--
-- Хеш, а не сам секрет, — тот же приём, что у ключей публичного API
-- (api_keys.key_hash): утечка дампа не отдаёт действующие секреты.
--
-- Колонка необязательная и уникальная. NULL-ы в MySQL уникальный индекс не
-- считает одинаковыми, поэтому организации без интеграции (на момент миграции
-- таблица onec_config пуста) не конфликтуют между собой. Отсутствие секрета
-- означает «вебхук для этой организации выключен» — это и есть безопасное
-- умолчание: включается он явным действием в настройках.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'onec_config'
    AND COLUMN_NAME = 'webhook_secret_hash'
);
--> statement-breakpoint
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE `onec_config` ADD COLUMN `webhook_secret_hash` varchar(64) NULL',
  'DO 0');
--> statement-breakpoint
PREPARE add_onec_secret_col FROM @ddl;
--> statement-breakpoint
EXECUTE add_onec_secret_col;
--> statement-breakpoint
DEALLOCATE PREPARE add_onec_secret_col;
--> statement-breakpoint
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'onec_config'
    AND INDEX_NAME = 'uq_onec_webhook_secret'
);
--> statement-breakpoint
SET @ddl_idx := IF(@idx_exists = 0,
  'CREATE UNIQUE INDEX `uq_onec_webhook_secret` ON `onec_config` (`webhook_secret_hash`)',
  'DO 0');
--> statement-breakpoint
PREPARE add_onec_secret_idx FROM @ddl_idx;
--> statement-breakpoint
EXECUTE add_onec_secret_idx;
--> statement-breakpoint
DEALLOCATE PREPARE add_onec_secret_idx;
