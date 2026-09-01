-- Заявки с лендинга.
--
-- ВАЖНО: этот файл написан руками, а не тем, что выдал `drizzle-kit generate`.
--
-- Генератор сравнивает схему со СНИМКОМ, а снимок разошёлся с тем, что
-- миграции делали на самом деле: рядом с таблицей заявок он предложил заново
-- добавить recorded_at, visited_at, webhook_secret_hash, idempotency_key,
-- warehouse_id и четыре ограничения — всё это уже добавлено миграциями 0003,
-- 0012, 0017, 0027, 0037, 0038, 0041, 0043 и 0044.
--
-- На боевой базе первый же такой ADD COLUMN упал бы с «Duplicate column», а
-- приложение при старте применяет миграции и отказывается стартовать, если
-- они не прошли (api/boot.ts). То есть выпуск такого файла означал бы
-- недоступный сайт.
--
-- Снимок 0045 при этом оставлен как есть: он описывает схему верно, и
-- следующая генерация уже не предложит добавлять существующее.
CREATE TABLE `leads` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`company` varchar(200),
	`phone` varchar(32) NOT NULL,
	`comment` text,
	`source` varchar(64),
	`notified` boolean NOT NULL DEFAULT false,
	`handled_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_leads_created` ON `leads` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_leads_notified` ON `leads` (`notified`);
