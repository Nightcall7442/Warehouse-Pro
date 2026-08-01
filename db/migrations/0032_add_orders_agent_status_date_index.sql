-- P2.1: covering index for the agent efficiency/performance reports.
--
-- They filter on agent_id + status and then range-scan created_at. The existing
-- idx_orders_tenant_agent stops at agent_id and idx_orders_tenant_status stops at
-- status, so MySQL read the agent's whole order history and sorted it.
CREATE INDEX `idx_orders_agent_status_date` ON `orders` (`agent_id`, `status`, `created_at`);
