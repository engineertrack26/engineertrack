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
  code_last_rotated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS code_last_rotated_at TIMESTAMPTZ DEFAULT now();

-- Enforce one institution per admin
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'institutions_admin_id_unique'
  ) THEN
    CREATE UNIQUE INDEX institutions_admin_id_unique ON institutions(admin_id);
  END IF;
END;
$$;

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

-- 5. Departments table (single-level)
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  department_code TEXT UNIQUE NOT NULL DEFAULT generate_random_code(6),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Add institution_id to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;

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

-- 8. Helper function: admin can access only own institution
CREATE OR REPLACE FUNCTION is_admin_of_institution(target_user UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    JOIN admin_profiles ap ON ap.id = auth.uid()
    WHERE p.id = target_user
      AND ap.institution_id IS NOT NULL
      AND p.institution_id = ap.institution_id
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 9. RPC: validate institution code without exposing full table
CREATE OR REPLACE FUNCTION validate_institution_code(p_code TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  type TEXT,
  faculty TEXT,
  department TEXT,
  city TEXT,
  country TEXT
) AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
    SELECT i.id, i.name, i.type, i.faculty, i.department, i.city, i.country
    FROM institutions i
    WHERE i.institution_code = upper(trim(p_code))
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. RPC: join institution by code
CREATE OR REPLACE FUNCTION join_institution_by_code(p_code TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  type TEXT,
  faculty TEXT,
  department TEXT,
  city TEXT,
  country TEXT
) AS $$
DECLARE
  inst_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT i.id INTO inst_id
  FROM institutions i
  WHERE i.institution_code = upper(trim(p_code))
  LIMIT 1;

  IF inst_id IS NULL THEN
    RAISE EXCEPTION 'Invalid institution code';
  END IF;

  UPDATE profiles
  SET institution_id = inst_id
  WHERE id = auth.uid();

  RETURN QUERY
    SELECT i.id, i.name, i.type, i.faculty, i.department, i.city, i.country
    FROM institutions i
    WHERE i.id = inst_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 11. RPC: link student by code
-- Advisors must share the same institution as the student (university-side).
-- Mentors are company supervisors and have no institution requirement;
-- the student code itself is the security mechanism.
CREATE OR REPLACE FUNCTION link_student_by_code(p_code TEXT, p_role TEXT)
RETURNS TABLE (student_id UUID, student_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
  student_uuid UUID;
  caller_role TEXT;
  caller_institution UUID;
  student_institution UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role, institution_id INTO caller_role, caller_institution
  FROM profiles WHERE id = auth.uid();

  IF caller_role NOT IN ('mentor', 'advisor') THEN
    RAISE EXCEPTION 'Only mentor or advisor can link students';
  END IF;

  SELECT sc.student_id INTO student_uuid
  FROM student_codes sc
  WHERE sc.code = upper(trim(p_code)) AND sc.is_active = true
  LIMIT 1;

  IF student_uuid IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired student code';
  END IF;

  -- Institution check: only enforced for advisors (university-side).
  -- Mentors are company supervisors; no institution membership required.
  IF caller_role = 'advisor' THEN
    SELECT institution_id INTO student_institution
    FROM profiles WHERE id = student_uuid;

    IF caller_institution IS NULL OR student_institution IS NULL OR caller_institution <> student_institution THEN
      RAISE EXCEPTION 'Institution mismatch';
    END IF;
  END IF;

  IF caller_role = 'mentor' THEN
    UPDATE student_profiles SET mentor_id = auth.uid() WHERE id = student_uuid;
  ELSE
    UPDATE student_profiles SET advisor_id = auth.uid() WHERE id = student_uuid;
  END IF;

  RETURN QUERY
    SELECT p.id, trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
    FROM profiles p WHERE p.id = student_uuid;
END;
$func$;

-- 12. RPC: regenerate institution code (rate-limited to 24h)
CREATE OR REPLACE FUNCTION regenerate_institution_code(p_institution_id UUID)
RETURNS TEXT AS $$
DECLARE
  last_rotated TIMESTAMPTZ;
  new_code TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT code_last_rotated_at INTO last_rotated
  FROM institutions
  WHERE id = p_institution_id AND admin_id = auth.uid();

  IF last_rotated IS NULL THEN
    RAISE EXCEPTION 'Institution not found or not owned by admin';
  END IF;

  IF last_rotated > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'Code can be regenerated once every 24 hours';
  END IF;

  new_code := generate_random_code(8);

  UPDATE institutions
  SET institution_code = new_code,
      code_last_rotated_at = now(),
      updated_at = now()
  WHERE id = p_institution_id AND admin_id = auth.uid();

  RETURN new_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 13. RPC: validate department code
CREATE OR REPLACE FUNCTION validate_department_code(p_code TEXT)
RETURNS TABLE (
  id UUID,
  institution_id UUID,
  name TEXT,
  department_code TEXT
) AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
    SELECT d.id, d.institution_id, d.name, d.department_code
    FROM departments d
    WHERE d.department_code = upper(trim(p_code))
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 14. RPC: join department by code (also sets institution_id)
CREATE OR REPLACE FUNCTION join_department_by_code(p_code TEXT)
RETURNS TABLE (
  id UUID,
  institution_id UUID,
  name TEXT,
  department_code TEXT
) AS $$
DECLARE
  dept_id UUID;
  inst_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT d.id, d.institution_id
  INTO dept_id, inst_id
  FROM departments d
  WHERE d.department_code = upper(trim(p_code))
  LIMIT 1;

  IF dept_id IS NULL THEN
    RAISE EXCEPTION 'Invalid department code';
  END IF;

  UPDATE profiles
  SET institution_id = inst_id,
      department_id = dept_id
  WHERE id = auth.uid();

  RETURN QUERY
    SELECT d.id, d.institution_id, d.name, d.department_code
    FROM departments d
    WHERE d.id = dept_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RLS Policies
-- ============================================

-- Enable RLS
ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

-- Institutions: admin manages own, members can read their institution only
DROP POLICY IF EXISTS "Anyone can read institutions" ON institutions;
CREATE POLICY "Institution members read" ON institutions
  FOR SELECT TO authenticated USING (
    admin_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.institution_id = institutions.id
    )
  );

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
  FOR ALL TO authenticated USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

-- Code lookup happens via RPC (link_student_by_code); no public select.
DROP POLICY IF EXISTS "Anyone can search codes" ON student_codes;

-- Departments: members can read, admin can manage
CREATE POLICY "Department members read" ON departments
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.institution_id = departments.institution_id
    )
  );

CREATE POLICY "Admin manages departments" ON departments
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM institutions i
      WHERE i.id = departments.institution_id AND i.admin_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM institutions i
      WHERE i.id = departments.institution_id AND i.admin_id = auth.uid()
    )
  );

-- ============================================
-- Update profiles select policy for admin
-- ============================================
-- Admins can only read users within their own institution
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_select'
  ) THEN
    EXECUTE 'DROP POLICY profiles_select ON profiles';
  END IF;
END;
$$;

CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (
    auth.uid() = id
    OR is_mentor_of(id)
    OR is_advisor_of(id)
    OR is_admin_of_institution(id)
  );

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

-- ============================================================
-- PATCH: Fix link_student_by_code — remove institution check for mentors
-- Run this in Supabase SQL Editor to apply the fix.
-- ============================================================

CREATE OR REPLACE FUNCTION link_student_by_code(p_code TEXT, p_role TEXT)
RETURNS TABLE (student_id UUID, student_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
  student_uuid UUID;
  caller_role TEXT;
  caller_institution UUID;
  student_institution UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role, institution_id INTO caller_role, caller_institution
  FROM profiles WHERE id = auth.uid();

  IF caller_role NOT IN ('mentor', 'advisor') THEN
    RAISE EXCEPTION 'Only mentor or advisor can link students';
  END IF;

  SELECT sc.student_id INTO student_uuid
  FROM student_codes sc
  WHERE sc.code = upper(trim(p_code)) AND sc.is_active = true
  LIMIT 1;

  IF student_uuid IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired student code';
  END IF;

  IF caller_role = 'advisor' THEN
    SELECT institution_id INTO student_institution
    FROM profiles WHERE id = student_uuid;

    IF caller_institution IS NULL OR student_institution IS NULL OR caller_institution <> student_institution THEN
      RAISE EXCEPTION 'Institution mismatch';
    END IF;
  END IF;

  IF caller_role = 'mentor' THEN
    UPDATE student_profiles SET mentor_id = auth.uid() WHERE id = student_uuid;
  ELSE
    UPDATE student_profiles SET advisor_id = auth.uid() WHERE id = student_uuid;
  END IF;

  RETURN QUERY
    SELECT p.id, trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
    FROM profiles p WHERE p.id = student_uuid;
END;
$func$;
-- $$ LANGUAGE plpgsql SECURITY DEFINER;
