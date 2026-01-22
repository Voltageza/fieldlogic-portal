-- ================================================================
-- MIGRATION: Add category column to firmware_releases
-- Run this in Supabase SQL Editor
-- ================================================================

-- Add category column for organizing firmware releases
ALTER TABLE firmware_releases
ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'Production';

-- Add comment for documentation
COMMENT ON COLUMN firmware_releases.category IS 'Firmware category: Production, Beta, Development, Legacy';

-- Create index for faster category queries
CREATE INDEX IF NOT EXISTS idx_firmware_releases_category ON firmware_releases(category);

-- Update existing releases to Production (default)
UPDATE firmware_releases SET category = 'Production' WHERE category IS NULL;
