-- ============================================
-- TELEGRAM GROUP NOTIFICATIONS
-- ============================================
-- Run this in Supabase SQL Editor
-- Adds per-device notification_chat_id for Telegram groups

-- Add notification_chat_id to devices table
ALTER TABLE devices
ADD COLUMN IF NOT EXISTS notification_chat_id VARCHAR(50);

-- Add last_fault_notification for per-device rate limiting
ALTER TABLE devices
ADD COLUMN IF NOT EXISTS last_fault_notification TIMESTAMP WITH TIME ZONE;

-- Allow service role to read notification_chat_id (for Deno bot)
-- The Deno bot uses the service key so RLS doesn't apply,
-- but we add an index for fast lookups
CREATE INDEX IF NOT EXISTS idx_devices_notification_chat ON devices(notification_chat_id)
WHERE notification_chat_id IS NOT NULL;
