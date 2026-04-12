-- Migration: Add active_pumps column to devices table
-- Run this in the Supabase SQL Editor
-- Allows admin to set how many pumps are visible per Eve device (1, 2, or 3)

ALTER TABLE devices
ADD COLUMN IF NOT EXISTS active_pumps integer DEFAULT 3
CHECK (active_pumps >= 1 AND active_pumps <= 3);

COMMENT ON COLUMN devices.active_pumps IS 'Number of active pumps for Eve devices (1-3). Inactive pumps are hidden from the UI.';
