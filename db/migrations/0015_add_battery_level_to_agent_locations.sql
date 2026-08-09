-- Add battery_level column to agent_locations table
-- Stores phone battery percentage (0-100) at time of location update

ALTER TABLE `agent_locations`
ADD COLUMN `battery_level` int AFTER `accuracy`;
