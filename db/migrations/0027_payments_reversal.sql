ALTER TABLE `payments` ADD `reversal_of` bigint unsigned;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `uq_payments_reversal_of` UNIQUE(`reversal_of`);