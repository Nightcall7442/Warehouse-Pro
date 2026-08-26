-- Один товар — одна строка в заказе.
--
-- Схема ввода order.create не требовала уникальности productId, и две строки
-- с одним товаром проходили все проверки. Дальше их встречал вот такой SQL:
--
--   reserved = reserved + CASE
--     WHEN product_id = 7 THEN 60
--     WHEN product_id = 7 THEN 60   -- MySQL берёт ТОЛЬКО первый совпавший WHEN
--   ELSE 0 END
--
-- В order_items ложилось 120 единиц, в reserved уходило 60. Проверка достатка
-- при этом тоже пропускала обе строки: она шла в цикле и каждую сверяла с одним
-- и тем же available. Итог — заказ на товар, которого нет, и завышенный на
-- величину дубля остаток, который следующий заказ тоже «продаст».
--
-- Тот же приём CASE ... WHEN product_id повторяется в updateStatus, cancel,
-- delete и restore — везде, где заказ двигает склад. Починить только create
-- значило бы оставить четыре других пути незакрытыми, поэтому запрет ставится
-- в базе: он действует на любой код, включая тот, который напишут завтра.
--
-- Индекс встаёт на живую таблицу: в боевой базе 2031 строка order_items и ни
-- одной пары (order_id, product_id) с повтором — проверено перед миграцией. То
-- же самое верно для arrival_items и return_items, но там CASE-обновлений нет,
-- и лишний индекс им не нужен.
--
-- Идемпотентность сделана переносимо, через information_schema и подготовленный
-- запрос: `CREATE INDEX IF NOT EXISTS` — синтаксис MariaDB, MySQL его отвергает,
-- и на этом уже спотыкалась миграция 0038.

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_items'
    AND INDEX_NAME = 'uq_order_items_order_product'
);
--> statement-breakpoint
SET @ddl := IF(@idx_exists = 0,
  'CREATE UNIQUE INDEX `uq_order_items_order_product` ON `order_items` (`order_id`, `product_id`)',
  'DO 0');
--> statement-breakpoint
PREPARE add_oi_uq FROM @ddl;
--> statement-breakpoint
EXECUTE add_oi_uq;
--> statement-breakpoint
DEALLOCATE PREPARE add_oi_uq;
