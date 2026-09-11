ALTER TABLE `agent_locations` ADD `mocked` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `commissions` ADD `fraud_deduction` decimal(14,2);