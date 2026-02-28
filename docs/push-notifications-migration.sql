-- Push Notifications Migration
-- Run this in Supabase SQL Editor

-- Add expo push token column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS expo_push_token TEXT;
