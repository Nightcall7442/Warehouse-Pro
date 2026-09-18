UPDATE `orders` SET `closed_at` = COALESCE(`delivered_at`, `updated_at`, `created_at`) WHERE `status` = 'delivered' AND `closed_at` IS NULL;
-- История до расчёта по заказу (18.09.2026): доставленные заказы считаются
-- рассчитанными днём доставки — иначе вся история встала бы в очередь
-- «ждут расчёта». Идемпотентно: повтор после обрыва ничего не меняет.