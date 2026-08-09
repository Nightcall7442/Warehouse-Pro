-- Add photo_url column to daily_plans table
-- This stores the visit proof photo URL submitted by agents

ALTER TABLE `daily_plans`
ADD COLUMN `photo_url` text AFTER `status`;
