-- Partial Workflow Features Migration
-- Run this in Supabase SQL Editor

-- Feature 1: Time Spent Logging
-- Stores total minutes spent (e.g., 90 = 1h 30m)
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS hours_spent INTEGER DEFAULT 0;

-- Feature 3: Areas of Excellence (Mentor feedback)
ALTER TABLE mentor_feedbacks ADD COLUMN IF NOT EXISTS areas_of_excellence TEXT;

-- Feature 4: Advisor Notes + Reject/Send Back
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS advisor_notes TEXT;
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS advisor_validated_at TIMESTAMPTZ;
