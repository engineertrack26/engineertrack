-- Leaderboard Scope Migration
-- Adds university, faculty, department columns to leaderboard_public
-- so the leaderboard can be filtered to show only same-department students.
-- Run this in Supabase SQL Editor.

-- ============================================
-- 1. Add columns to leaderboard_public
-- ============================================
ALTER TABLE leaderboard_public
  ADD COLUMN IF NOT EXISTS university TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS faculty TEXT,
  ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT '';

-- ============================================
-- 2. Replace the sync trigger function to include new columns
-- ============================================
CREATE OR REPLACE FUNCTION sync_leaderboard_public_from_student()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO leaderboard_public (
    id, total_xp, current_level, current_streak,
    first_name, last_name, avatar_url,
    university, faculty, department,
    updated_at
  )
  SELECT
    NEW.id,
    NEW.total_xp,
    NEW.current_level,
    NEW.current_streak,
    COALESCE(p.first_name, ''),
    COALESCE(p.last_name, ''),
    p.avatar_url,
    NEW.university,
    NEW.faculty,
    NEW.department,
    NOW()
  FROM profiles_public p
  WHERE p.id = NEW.id
  ON CONFLICT (id) DO UPDATE SET
    total_xp      = EXCLUDED.total_xp,
    current_level = EXCLUDED.current_level,
    current_streak = EXCLUDED.current_streak,
    first_name    = EXCLUDED.first_name,
    last_name     = EXCLUDED.last_name,
    avatar_url    = EXCLUDED.avatar_url,
    university    = EXCLUDED.university,
    faculty       = EXCLUDED.faculty,
    department    = EXCLUDED.department,
    updated_at    = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 3. Backfill existing rows from student_profiles
-- ============================================
UPDATE leaderboard_public lp
SET
  university = sp.university,
  faculty    = sp.faculty,
  department = sp.department,
  updated_at = NOW()
FROM student_profiles sp
WHERE lp.id = sp.id;
