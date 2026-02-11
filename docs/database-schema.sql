-- ============================================
-- EngineerTrack Database Schema
-- Supabase (PostgreSQL)
-- Run this in Supabase Dashboard > SQL Editor
-- ============================================

-- ============================================
-- 1. TABLES
-- ============================================

-- User profiles (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'mentor', 'advisor')),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'tr', 'sr', 'el', 'it', 'ro', 'de')),
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Public profile fields (safe for wider visibility)
CREATE TABLE IF NOT EXISTS profiles_public (
  id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'student',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Public leaderboard snapshot
CREATE TABLE IF NOT EXISTS leaderboard_public (
  id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  total_xp INTEGER NOT NULL DEFAULT 0,
  current_level INTEGER NOT NULL DEFAULT 1,
  current_streak INTEGER NOT NULL DEFAULT 0,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Student-specific profile data
CREATE TABLE IF NOT EXISTS student_profiles (
  id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  university TEXT NOT NULL,
  faculty TEXT,
  department TEXT NOT NULL,
  department_branch TEXT,
  student_id TEXT NOT NULL,
  mentor_id UUID REFERENCES profiles(id),
  advisor_id UUID REFERENCES profiles(id),
  internship_start_date DATE NOT NULL,
  internship_end_date DATE NOT NULL,
  company_name TEXT NOT NULL,
  company_address TEXT,
  company_sector TEXT,
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

-- Daily logs
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

-- Self assessments
CREATE TABLE IF NOT EXISTS self_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  competency_ratings JSONB NOT NULL DEFAULT '{}',
  reflection_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mentor feedback
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

-- Revision history
CREATE TABLE IF NOT EXISTS revision_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  previous_content TEXT NOT NULL,
  new_content TEXT NOT NULL,
  reason TEXT NOT NULL,
  revised_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Earned badges
CREATE TABLE IF NOT EXISTS earned_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  badge_key TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, badge_key)
);

-- XP transactions
CREATE TABLE IF NOT EXISTS xp_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  log_id UUID REFERENCES daily_logs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Notifications
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
-- 2. INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_daily_logs_student ON daily_logs(student_id);
CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(date);
CREATE INDEX IF NOT EXISTS idx_daily_logs_status ON daily_logs(status);
CREATE INDEX IF NOT EXISTS idx_log_photos_log ON log_photos(log_id);
CREATE INDEX IF NOT EXISTS idx_log_documents_log ON log_documents(log_id);
CREATE INDEX IF NOT EXISTS idx_self_assessments_log ON self_assessments(log_id);
CREATE INDEX IF NOT EXISTS idx_mentor_feedbacks_log ON mentor_feedbacks(log_id);
CREATE INDEX IF NOT EXISTS idx_mentor_feedbacks_mentor ON mentor_feedbacks(mentor_id);
CREATE INDEX IF NOT EXISTS idx_revision_history_log ON revision_history(log_id);
CREATE INDEX IF NOT EXISTS idx_earned_badges_student ON earned_badges(student_id);
CREATE INDEX IF NOT EXISTS idx_xp_transactions_student ON xp_transactions(student_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

-- ============================================
-- 3. UPDATED_AT TRIGGER
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_daily_logs_updated_at
  BEFORE UPDATE ON daily_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Keep profiles_public in sync with profiles
CREATE OR REPLACE FUNCTION sync_profiles_public()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles_public (id, first_name, last_name, avatar_url, role, updated_at)
  VALUES (NEW.id, NEW.first_name, NEW.last_name, NEW.avatar_url, NEW.role, NOW())
  ON CONFLICT (id) DO UPDATE SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    avatar_url = EXCLUDED.avatar_url,
    role = EXCLUDED.role,
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER tr_profiles_public_sync
  AFTER INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION sync_profiles_public();

-- Keep leaderboard_public in sync with student_profiles
CREATE OR REPLACE FUNCTION sync_leaderboard_public_from_student()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO leaderboard_public (
    id, total_xp, current_level, current_streak, first_name, last_name, avatar_url, updated_at
  )
  SELECT
    NEW.id,
    NEW.total_xp,
    NEW.current_level,
    NEW.current_streak,
    COALESCE(p.first_name, ''),
    COALESCE(p.last_name, ''),
    p.avatar_url,
    NOW()
  FROM profiles_public p
  WHERE p.id = NEW.id
  ON CONFLICT (id) DO UPDATE SET
    total_xp = EXCLUDED.total_xp,
    current_level = EXCLUDED.current_level,
    current_streak = EXCLUDED.current_streak,
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    avatar_url = EXCLUDED.avatar_url,
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER tr_leaderboard_public_sync_student
  AFTER INSERT OR UPDATE ON student_profiles
  FOR EACH ROW EXECUTE FUNCTION sync_leaderboard_public_from_student();

-- Refresh leaderboard names when profile changes
CREATE OR REPLACE FUNCTION sync_leaderboard_public_from_profile()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE leaderboard_public
  SET first_name = COALESCE(NEW.first_name, ''),
      last_name = COALESCE(NEW.last_name, ''),
      avatar_url = NEW.avatar_url,
      updated_at = NOW()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER tr_leaderboard_public_sync_profile
  AFTER UPDATE ON profiles_public
  FOR EACH ROW EXECUTE FUNCTION sync_leaderboard_public_from_profile();

-- Initial backfill for public tables
INSERT INTO profiles_public (id, first_name, last_name, avatar_url, role, updated_at)
SELECT id, first_name, last_name, avatar_url, role, NOW()
FROM profiles
ON CONFLICT (id) DO UPDATE SET
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  avatar_url = EXCLUDED.avatar_url,
  role = EXCLUDED.role,
  updated_at = NOW();

INSERT INTO leaderboard_public (id, total_xp, current_level, current_streak, first_name, last_name, avatar_url, updated_at)
SELECT
  sp.id,
  sp.total_xp,
  sp.current_level,
  sp.current_streak,
  COALESCE(pp.first_name, ''),
  COALESCE(pp.last_name, ''),
  pp.avatar_url,
  NOW()
FROM student_profiles sp
JOIN profiles_public pp ON pp.id = sp.id
ON CONFLICT (id) DO UPDATE SET
  total_xp = EXCLUDED.total_xp,
  current_level = EXCLUDED.current_level,
  current_streak = EXCLUDED.current_streak,
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  avatar_url = EXCLUDED.avatar_url,
  updated_at = NOW();

-- ============================================
-- 4. AUTO-CREATE PROFILE ON SIGNUP TRIGGER
-- ============================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role, first_name, last_name, language)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'student'),
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'language', 'en')
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================
-- 5. ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles_public ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_public ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE advisor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE log_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE log_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE self_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentor_feedbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE revision_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE earned_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE xp_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Helper: get current user's role
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: check if mentor is assigned to student
CREATE OR REPLACE FUNCTION is_mentor_of(student_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM student_profiles
    WHERE id = student_uuid AND mentor_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: check if advisor is assigned to student
CREATE OR REPLACE FUNCTION is_advisor_of(student_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM student_profiles
    WHERE id = student_uuid AND advisor_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: check if current admin belongs to the target user's institution
CREATE OR REPLACE FUNCTION is_admin_of_institution(target_user UUID)
RETURNS BOOLEAN AS $$
DECLARE
  has_table BOOLEAN;
  result BOOLEAN;
BEGIN
  SELECT to_regclass('public.admin_profiles') IS NOT NULL INTO has_table;
  IF NOT has_table THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    JOIN admin_profiles ap ON ap.id = auth.uid()
    WHERE p.id = target_user
      AND ap.institution_id IS NOT NULL
      AND p.institution_id = ap.institution_id
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ---- PROFILES ----
-- Profiles: only self or assigned mentor/advisor (or admin)
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (
    auth.uid() = id
    OR is_mentor_of(id)
    OR is_advisor_of(id)
    OR is_admin_of_institution(id)
  );

-- Users can update their own profile
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Public profiles: anyone authenticated can read
CREATE POLICY "profiles_public_select" ON profiles_public
  FOR SELECT TO authenticated USING (true);

-- Public leaderboard: anyone authenticated can read
CREATE POLICY "leaderboard_public_select" ON leaderboard_public
  FOR SELECT TO authenticated USING (true);

-- ---- STUDENT PROFILES ----
CREATE POLICY "student_profiles_select" ON student_profiles
  FOR SELECT USING (
    auth.uid() = id
    OR is_mentor_of(id)
    OR is_advisor_of(id)
  );

CREATE POLICY "student_profiles_insert_own" ON student_profiles
  FOR INSERT WITH CHECK (
    auth.uid() = id
    AND get_user_role() = 'student'
  );

CREATE POLICY "student_profiles_update_own" ON student_profiles
  FOR UPDATE USING (auth.uid() = id);

-- ---- MENTOR PROFILES ----
CREATE POLICY "mentor_profiles_select" ON mentor_profiles
  FOR SELECT USING (true);

CREATE POLICY "mentor_profiles_update_own" ON mentor_profiles
  FOR UPDATE USING (auth.uid() = id);

-- ---- ADVISOR PROFILES ----
CREATE POLICY "advisor_profiles_select" ON advisor_profiles
  FOR SELECT USING (true);

CREATE POLICY "advisor_profiles_update_own" ON advisor_profiles
  FOR UPDATE USING (auth.uid() = id);

-- ---- DAILY LOGS ----
-- Students see their own, mentors/advisors see assigned students' logs
CREATE POLICY "daily_logs_select" ON daily_logs
  FOR SELECT USING (
    auth.uid() = student_id
    OR is_mentor_of(student_id)
    OR is_advisor_of(student_id)
  );

-- Only students can insert their own logs
CREATE POLICY "daily_logs_insert" ON daily_logs
  FOR INSERT WITH CHECK (
    auth.uid() = student_id
    AND get_user_role() = 'student'
  );

-- Students can update their own draft/revised logs
CREATE POLICY "daily_logs_update_student" ON daily_logs
  FOR UPDATE USING (
    auth.uid() = student_id
    AND status IN ('draft', 'needs_revision')
  );

-- Mentors can update status of assigned students' logs
CREATE POLICY "daily_logs_update_mentor" ON daily_logs
  FOR UPDATE USING (
    is_mentor_of(student_id)
    AND get_user_role() = 'mentor'
  );

-- Advisors can validate assigned students' logs
CREATE POLICY "daily_logs_update_advisor" ON daily_logs
  FOR UPDATE USING (
    is_advisor_of(student_id)
    AND get_user_role() = 'advisor'
  );

-- ---- LOG PHOTOS ----
CREATE POLICY "log_photos_select" ON log_photos
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND (daily_logs.student_id = auth.uid()
        OR is_mentor_of(daily_logs.student_id)
        OR is_advisor_of(daily_logs.student_id)))
  );

CREATE POLICY "log_photos_insert" ON log_photos
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND daily_logs.student_id = auth.uid())
  );

CREATE POLICY "log_photos_delete" ON log_photos
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND daily_logs.student_id = auth.uid()
      AND daily_logs.status IN ('draft', 'needs_revision'))
  );

-- ---- LOG DOCUMENTS ----
CREATE POLICY "log_documents_select" ON log_documents
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND (daily_logs.student_id = auth.uid()
        OR is_mentor_of(daily_logs.student_id)
        OR is_advisor_of(daily_logs.student_id)))
  );

CREATE POLICY "log_documents_insert" ON log_documents
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND daily_logs.student_id = auth.uid())
  );

CREATE POLICY "log_documents_delete" ON log_documents
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND daily_logs.student_id = auth.uid()
      AND daily_logs.status IN ('draft', 'needs_revision'))
  );

-- ---- SELF ASSESSMENTS ----
CREATE POLICY "self_assessments_select" ON self_assessments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND (daily_logs.student_id = auth.uid()
        OR is_mentor_of(daily_logs.student_id)
        OR is_advisor_of(daily_logs.student_id)))
  );

CREATE POLICY "self_assessments_insert" ON self_assessments
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND daily_logs.student_id = auth.uid())
  );

-- ---- MENTOR FEEDBACKS ----
CREATE POLICY "mentor_feedbacks_select" ON mentor_feedbacks
  FOR SELECT USING (
    auth.uid() = mentor_id
    OR EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND daily_logs.student_id = auth.uid())
    OR EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND is_advisor_of(daily_logs.student_id))
  );

CREATE POLICY "mentor_feedbacks_insert" ON mentor_feedbacks
  FOR INSERT WITH CHECK (
    auth.uid() = mentor_id
    AND get_user_role() = 'mentor'
  );

-- ---- REVISION HISTORY ----
CREATE POLICY "revision_history_select" ON revision_history
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND (daily_logs.student_id = auth.uid()
        OR is_mentor_of(daily_logs.student_id)
        OR is_advisor_of(daily_logs.student_id)))
  );

CREATE POLICY "revision_history_insert" ON revision_history
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND daily_logs.student_id = auth.uid())
  );

-- ---- EARNED BADGES ----
CREATE POLICY "earned_badges_select" ON earned_badges
  FOR SELECT USING (true);

CREATE POLICY "earned_badges_insert" ON earned_badges
  FOR INSERT WITH CHECK (auth.uid() = student_id);

-- ---- XP TRANSACTIONS ----
CREATE POLICY "xp_transactions_select" ON xp_transactions
  FOR SELECT USING (
    auth.uid() = student_id
    OR is_mentor_of(student_id)
    OR is_advisor_of(student_id)
  );

CREATE POLICY "xp_transactions_insert" ON xp_transactions
  FOR INSERT WITH CHECK (auth.uid() = student_id);

-- ---- NOTIFICATIONS ----
CREATE POLICY "notifications_select" ON notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "notifications_insert" ON notifications
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    OR is_mentor_of(user_id)
    OR is_advisor_of(user_id)
  );

CREATE POLICY "notifications_update" ON notifications
  FOR UPDATE USING (auth.uid() = user_id);

-- ============================================
-- 6. STORAGE BUCKETS
-- ============================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('log-photos', 'log-photos', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('log-documents', 'log-documents', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: log-photos
CREATE POLICY "log_photos_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'log-photos'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "log_photos_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'log-photos'
    AND auth.role() = 'authenticated'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR is_mentor_of((storage.foldername(name))[1]::uuid)
      OR is_advisor_of((storage.foldername(name))[1]::uuid)
    )
  );

CREATE POLICY "log_photos_delete_own" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'log-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Storage policies: log-documents
CREATE POLICY "log_documents_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'log-documents'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "log_documents_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'log-documents'
    AND auth.role() = 'authenticated'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR is_mentor_of((storage.foldername(name))[1]::uuid)
      OR is_advisor_of((storage.foldername(name))[1]::uuid)
    )
  );

CREATE POLICY "log_documents_delete_own" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'log-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Storage policies: avatars (public bucket)
CREATE POLICY "avatars_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "avatars_update_own" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_delete_own" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
