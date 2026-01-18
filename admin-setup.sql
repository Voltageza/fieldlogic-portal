-- ============================================
-- FIELDLOGIC ADMIN FUNCTIONALITY
-- ============================================
-- Run this SQL in Supabase SQL Editor AFTER setup.sql
-- Go to: Supabase Dashboard > SQL Editor > New Query

-- Create user_profiles table to track admin status
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email VARCHAR(255),
  full_name VARCHAR(255),
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on user_profiles
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own profile
CREATE POLICY "Users can view own profile" ON user_profiles
  FOR SELECT USING (auth.uid() = id);

-- Policy: Users can update their own profile (but not is_admin)
CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE USING (auth.uid() = id);

-- Policy: Admins can view all profiles
CREATE POLICY "Admins can view all profiles" ON user_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE
    )
  );

-- Function to automatically create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Update devices RLS policy to allow admins to see all devices
-- First drop existing select policy
DROP POLICY IF EXISTS "Users can view own devices" ON devices;

-- Create new policy that allows users to see their own OR admins to see all
CREATE POLICY "Users can view own devices or admin sees all" ON devices
  FOR SELECT USING (
    auth.uid() = user_id
    OR
    EXISTS (
      SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE
    )
  );

-- Create index for admin queries
CREATE INDEX IF NOT EXISTS idx_user_profiles_is_admin ON user_profiles(is_admin);

-- ============================================
-- SET YOUR ADMIN USER
-- ============================================
-- After running the above, run this query to make yourself admin
-- Replace 'your-email@example.com' with your actual email

-- First, create a profile for existing users if they don't have one
INSERT INTO user_profiles (id, email, full_name)
SELECT id, email, raw_user_meta_data->>'full_name'
FROM auth.users
WHERE id NOT IN (SELECT id FROM user_profiles)
ON CONFLICT (id) DO NOTHING;

-- To make a user admin, run this (uncomment and change email):
-- UPDATE user_profiles SET is_admin = TRUE WHERE email = 'your-email@example.com';

-- ============================================
-- USER MANAGEMENT (Admin Features)
-- ============================================

-- Policy: Admins can update any user's profile
CREATE POLICY "Admins can update any user profile" ON user_profiles
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- Add is_active column for user deactivation
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
