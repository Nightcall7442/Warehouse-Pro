-- Migration 0018: Add performance indexes for KPI queries
-- Targets: agent_locations, returns, visit_reports for date-range agent lookups

CREATE INDEX idx_returns_agent_date ON returns(tenant_id, agent_id, created_at);
--> statement-breakpoint
CREATE INDEX idx_agent_locations_agent_date ON agent_locations(tenant_id, agent_id, created_at);
--> statement-breakpoint
CREATE INDEX idx_visit_reports_user_date ON visit_reports(tenant_id, user_id, created_at);
--> statement-breakpoint
CREATE INDEX idx_orders_courier_date ON orders(tenant_id, courier_id, created_at);
