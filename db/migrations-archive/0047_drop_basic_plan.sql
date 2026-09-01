-- Убрать тариф Basic из перечисления: платных ступеней остаётся две.
--
-- ── Что происходит ───────────────────────────────────────────────────────────
--
-- Линейка сводится к Pro и Exclusive. Trial остаётся: это не витринный тариф, а
-- начальное состояние фирмы после регистрации, и на нём живут действующие
-- фирмы.
--
-- Колонка plan есть в двух таблицах — tenants и subscriptions, — и обе нужно
-- менять вместе. Забыть вторую легко: код читает тариф из tenants, и
-- рассинхрон вылезет не сразу, а на первом же вебхуке Stripe, который попробует
-- записать в subscriptions значение, которого в перечислении уже нет.
--
-- ── Про сохранность данных ───────────────────────────────────────────────────
--
-- На момент написания на Basic не было ни одной фирмы — проверено запросом к
-- боевой базе: exclusive 6, pro 4, trial 3, итого 13. Переносить некого.
--
-- И всё же перенос написан. Между этой строкой и выкладкой лежит время, за
-- которое кто-то может успеть оформить Basic; а MySQL при смене перечисления не
-- отказывается от строк с исчезающим значением — он молча кладёт туда пустую
-- строку. Фирма осталась бы с тарифом «», то есть без лимитов и без понимания,
-- что оплачено. Поэтому сначала перенос, потом смена типа.
--
-- Перенос именно на Pro, а не на Trial: фирма платила за тариф, который мы
-- закрыли по своей воле, и дешёвая платная ступень — наименьшее, что ей
-- полагается. Лишить оплаченного из-за нашей же перестановки нельзя.
--
-- ── Про вид записи ───────────────────────────────────────────────────────────
--
-- Смена типа завёрнута в проверку information_schema: MODIFY COLUMN не имеет
-- IF-формы, а повторный прогон миграции должен быть безобидным. Заодно это
-- страхует от случая, когда колонку уже поправили руками.

-- ── tenants ──────────────────────────────────────────────────────────────────
UPDATE `tenants` SET `plan` = 'pro' WHERE `plan` = 'basic';
--> statement-breakpoint
SET @есть_basic := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tenants'
    AND COLUMN_NAME = 'plan'
    AND COLUMN_TYPE LIKE '%basic%'
);
--> statement-breakpoint
SET @ddl := IF(@есть_basic > 0,
  'ALTER TABLE `tenants` MODIFY COLUMN `plan` ENUM(''trial'',''pro'',''exclusive'') NOT NULL DEFAULT ''trial''',
  'DO 0');
--> statement-breakpoint
PREPARE смена_tenants FROM @ddl;
--> statement-breakpoint
EXECUTE смена_tenants;
--> statement-breakpoint
DEALLOCATE PREPARE смена_tenants;
--> statement-breakpoint

-- ── subscriptions ────────────────────────────────────────────────────────────
UPDATE `subscriptions` SET `plan` = 'pro' WHERE `plan` = 'basic';
--> statement-breakpoint
SET @есть_basic_sub := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'subscriptions'
    AND COLUMN_NAME = 'plan'
    AND COLUMN_TYPE LIKE '%basic%'
);
--> statement-breakpoint
SET @ddl := IF(@есть_basic_sub > 0,
  'ALTER TABLE `subscriptions` MODIFY COLUMN `plan` ENUM(''trial'',''pro'',''exclusive'') NOT NULL DEFAULT ''trial''',
  'DO 0');
--> statement-breakpoint
PREPARE смена_subs FROM @ddl;
--> statement-breakpoint
EXECUTE смена_subs;
--> statement-breakpoint
DEALLOCATE PREPARE смена_subs;
