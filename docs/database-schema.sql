-- EngineerTrack Database Schema
-- Supabase (PostgreSQL)
-- TODO: Implement in Phase 1 - Backend Setup

-- ============================================
-- USERS & PROFILES
-- ============================================

-- User profiles (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'mentor', 'advisor')),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'tr', 'el', 'es', 'it', 'de')),
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Student-specific profile data
CREATE TABLE IF NOT EXISTS student_profiles (
  id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  university TEXT NOT NULL,
  department TEXT NOT NULL,
  student_id TEXT NOT NULL,
  mentor_id UUID REFERENCES profiles(id),
  advisor_id UUID REFERENCES profiles(id),
  internship_start_date DATE NOT NULL,
  internship_end_date DATE NOT NULL,
  company_name TEXT NOT NULL,
  total_xp INTEGER NOT NULL DEFAULT 0,
  current_level INTEGER NOT NULL DEFAULT 1,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0
);

-- Mentor-specific profile data
CREATE TABLE IF NOT EXISTS mentor_profiles (
  id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  position TEXT NOT NULL,
  department TEXT NOT NULL
);

-- Advisor-specific profile data
CREATE TABLE IF NOT EXISTS advisor_profiles (
  id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  university TEXT NOT NULL,
  department TEXT NOT NULL,
  title TEXT NOT NULL
);

-- ============================================
-- DAILY LOGS
-- ============================================

CREATE TABLE IF NOT EXISTS daily_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  activities_performed TEXT,
  skills_learned TEXT,
  challenges_faced TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'needs_revision', 'revised', 'validated')),
  xp_earned INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, date)
);

-- Log attachments: photos
CREATE TABLE IF NOT EXISTS log_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  uri TEXT NOT NULL,
  caption TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Log attachments: documents
CREATE TABLE IF NOT EXISTS log_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  uri TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- ASSESSMENTS & FEEDBACK
-- ============================================

CREATE TABLE IF NOT EXISTS self_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  competency_ratings JSONB NOT NULL DEFAULT '{}',
  reflection_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mentor_feedbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  mentor_id UUID NOT NULL REFERENCES profiles(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comments TEXT,
  competency_ratings JSONB NOT NULL DEFAULT '{}',
  is_approved BOOLEAN NOT NULL DEFAULT FALSE,
  revision_required BOOLEAN NOT NULL DEFAULT FALSE,
  revision_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS revision_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  previous_content TEXT NOT NULL,
  new_content TEXT NOT NULL,
  reason TEXT NOT NULL,
  revised_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- GAMIFICATION
-- ============================================

CREATE TABLE IF NOT EXISTS earned_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  badge_key TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, badge_key)
);

CREATE TABLE IF NOT EXISTS xp_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  log_id UUID REFERENCES daily_logs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- NOTIFICATIONS
-- ============================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_daily_logs_student ON daily_logs(student_id);
CREATE INDEX idx_daily_logs_date ON daily_logs(date);
CREATE INDEX idx_daily_logs_status ON daily_logs(status);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX idx_xp_transactions_student ON xp_transactions(student_id);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- TODO: Enable and configure policies
-- ============================================
