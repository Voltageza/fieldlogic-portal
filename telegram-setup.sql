-- ============================================
-- TELEGRAM NOTIFICATIONS SETUP
-- ============================================
-- Run this SQL in Supabase SQL Editor AFTER setup.sql and admin-setup.sql
-- Go to: Supabase Dashboard > SQL Editor > New Query

-- ============================================
-- 1. Update user_profiles for Telegram
-- ============================================
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(50),
ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(100),
ADD COLUMN IF NOT EXISTS telegram_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS telegram_linked_at TIMESTAMP WITH TIME ZONE;

-- Index for telegram lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_telegram ON user_profiles(telegram_chat_id);

-- ============================================
-- 2. Telegram Link Codes (temporary codes for linking)
-- ============================================
CREATE TABLE IF NOT EXISTS telegram_link_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  code VARCHAR(8) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE telegram_link_codes ENABLE ROW LEVEL SECURITY;

-- Users can view their own codes
CREATE POLICY "Users can view own link codes" ON telegram_link_codes
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own codes
CREATE POLICY "Users can insert own link codes" ON telegram_link_codes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own codes
CREATE POLICY "Users can update own link codes" ON telegram_link_codes
  FOR UPDATE USING (auth.uid() = user_id);

-- Index for code lookups
CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_code ON telegram_link_codes(code);
CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_expires ON telegram_link_codes(expires_at);

-- ============================================
-- 3. Notification Preferences (per-device)
-- ============================================
CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  device_id VARCHAR(20) NOT NULL,

  -- Notification types
  telegram_fault_enabled BOOLEAN DEFAULT TRUE,
  telegram_offline_enabled BOOLEAN DEFAULT FALSE,
  telegram_recovery_enabled BOOLEAN DEFAULT FALSE,

  -- Rate limiting
  last_fault_notification TIMESTAMP WITH TIME ZONE,
  last_offline_notification TIMESTAMP WITH TIME ZONE,
  notification_cooldown_minutes INT DEFAULT 15,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(user_id, device_id)
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notification preferences" ON notification_preferences
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own notification preferences" ON notification_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own notification preferences" ON notification_preferences
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own notification preferences" ON notification_preferences
  FOR DELETE USING (auth.uid() = user_id);

-- Update trigger for updated_at
CREATE TRIGGER update_notification_preferences_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 4. Notifications Log
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  device_id VARCHAR(20) NOT NULL,

  -- Notification details
  notification_type VARCHAR(50) NOT NULL, -- 'fault', 'offline', 'recovery'
  channel VARCHAR(20) DEFAULT 'telegram',

  -- Content
  message_body TEXT,
  device_name VARCHAR(100),
  device_state VARCHAR(20),

  -- Status
  status VARCHAR(20) DEFAULT 'sent', -- 'sent', 'failed'
  error_message TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can view their own notifications
CREATE POLICY "Users can view own notifications" ON notifications
  FOR SELECT USING (auth.uid() = user_id);

-- Admins can view all notifications
CREATE POLICY "Admins can view all notifications" ON notifications
  FOR SELECT USING (is_admin());

-- Index for queries
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_device ON notifications(device_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);

-- ============================================
-- 5. Function to clean up expired link codes
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_expired_link_codes()
RETURNS void AS $$
BEGIN
  DELETE FROM telegram_link_codes
  WHERE expires_at < NOW() OR used = TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
