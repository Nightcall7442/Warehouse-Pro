CREATE INDEX `idx_locations_tenant_agent_created` ON `agent_locations` (`tenant_id`,`agent_id`,`created_at`);--> statement-breakpoint
DROP INDEX `idx_locations_tenant_agent` ON `agent_locations`;