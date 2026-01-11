-- ============================================
-- FIELDLOGIC DATABASE SCHEMA
-- ============================================
-- Run this SQL in Supabase SQL Editor to create the required tables
-- Go to: Supabase Dashboard > SQL Editor > New Query

-- Devices table: stores user-device relationships
CREATE TABLE IF NOT EXISTS devices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  device_id VARCHAR(20) NOT NULL,
  name VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Each user can only register a device once
  UNIQUE(user_id, device_id)
);

-- Enable Row Level Security (RLS)
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own devices
CREATE POLICY "Users can view own devices" ON devices
  FOR SELECT USING (auth.uid() = user_id);

-- Policy: Users can insert their own devices
CREATE POLICY "Users can insert own devices" ON devices
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own devices
CREATE POLICY "Users can update own devices" ON devices
  FOR UPDATE USING (auth.uid() = user_id);

-- Policy: Users can delete their own devices
CREATE POLICY "Users can delete own devices" ON devices
  FOR DELETE USING (auth.uid() = user_id);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices(device_id);

-- Optional: Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at
CREATE TRIGGER update_devices_updated_at
  BEFORE UPDATE ON devices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
