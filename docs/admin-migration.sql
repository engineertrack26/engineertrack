-- ============================================
-- EngineerTrack: Admin Role & Code-Based Linking
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Helper function: generate random alphanumeric code
CREATE OR REPLACE FUNCTION generate_random_code(length INT)
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no I,O,0,1 to avoid confusion
  result TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..length LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 2. Institutions table
CREATE TABLE IF NOT EXISTS institutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'university' CHECK (type IN ('university', 'vocational_school', 'other')),
  faculty TEXT,
  department TEXT,
  city TEXT,
  country TEXT NOT NULL DEFAULT '',
  admin_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  institution_code TEXT UNIQUE NOT NULL DEFAULT generate_random_code(8),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Admin profiles table
CREATE TABLE IF NOT EXISTS admin_profiles (
  id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
  edu_email TEXT NOT NULL,
  edu_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Student codes table
CREATE TABLE IF NOT EXISTS student_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL DEFAULT generate_random_code(6),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Add institution_id to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL;

-- 6. Update role CHECK constraint to include 'admin'
-- Drop existing constraint first (name may vary)
DO $$
BEGIN
  -- Try to drop the existing constraint
  ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
  ALTER TABLE profiles DROP CONSTRAINT IF EXISTS check_role;
  -- Add new constraint including 'admin'
  ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('student', 'mentor', 'advisor', 'admin'));
EXCEPTION
  WHEN OTHERS THEN
    -- If constraint doesn't exist or different name, just add
    ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
      CHECK (role IN ('student', 'mentor', 'advisor', 'admin'));
END;
$$;

-- 7. Helper function: is_admin()
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RLS Policies
-- ============================================

-- Enable RLS
ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_codes ENABLE ROW LEVEL SECURITY;

-- Institutions: anyone authenticated can read (for code lookup), admin manages own
CREATE POLICY "Anyone can read institutions" ON institutions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin can insert own institution" ON institutions
  FOR INSERT TO authenticated WITH CHECK (admin_id = auth.uid());

CREATE POLICY "Admin can update own institution" ON institutions
  FOR UPDATE TO authenticated USING (admin_id = auth.uid());

-- Admin profiles: admin reads/manages own
CREATE POLICY "Admin reads own profile" ON admin_profiles
  FOR SELECT TO authenticated USING (id = auth.uid());

CREATE POLICY "Admin inserts own profile" ON admin_profiles
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

CREATE POLICY "Admin updates own profile" ON admin_profiles
  FOR UPDATE TO authenticated USING (id = auth.uid());

-- Student codes: student manages own, mentor/advisor can search by code
CREATE POLICY "Student manages own codes" ON student_codes
  FOR ALL TO authenticated USING (student_id = auth.uid());

CREATE POLICY "Anyone can search codes" ON student_codes
  FOR SELECT TO authenticated USING (true);

-- ============================================
-- Update auth trigger to handle admin role
-- ============================================
-- Note: The existing trigger should already create a profiles row.
-- If you have a custom trigger for role-specific profile creation,
-- update it to also create admin_profiles when role = 'admin'.
-- Example (adjust based on your actual trigger):
--
-- CREATE OR REPLACE FUNCTION handle_new_user()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   INSERT INTO profiles (id, email, role, first_name, last_name, language)
--   VALUES (
--     NEW.id,
--     NEW.email,
--     COALESCE(NEW.raw_user_meta_data->>'role', 'student'),
--     COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
--     COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
--     COALESCE(NEW.raw_user_meta_data->>'language', 'en')
--   );
--
--   IF (NEW.raw_user_meta_data->>'role') = 'student' THEN
--     INSERT INTO student_profiles (id) VALUES (NEW.id);
--   ELSIF (NEW.raw_user_meta_data->>'role') = 'admin' THEN
--     INSERT INTO admin_profiles (id, edu_email)
--     VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'edu_email', NEW.email));
--   END IF;
--
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql SECURITY DEFINER;
