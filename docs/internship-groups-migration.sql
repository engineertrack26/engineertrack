-- docs/internship-groups-migration.sql
-- Replaces the admin/institution/department hierarchy with advisor-owned
-- internship groups. See docs/superpowers/specs/2026-08-19-internship-groups-design.md
--
-- BEFORE RUNNING THIS: delete every admin account from the Supabase dashboard
-- (Authentication -> Users). profiles.id references auth.users ON DELETE
-- CASCADE and institutions.admin_id references profiles ON DELETE CASCADE, so
-- removing the auth user removes its profile, its institution and that
-- institution's departments in one step. The guard below refuses to run until
-- that is done. It deliberately does NOT delete accounts for you: a migration
-- that silently destroys user accounts is one nobody can safely re-run.
--
-- This migration is destructive by design — the project chose a clean start.
-- Existing institutions, departments, admin profiles and join-issue reports
-- are dropped along with their data.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM profiles WHERE role = 'admin') THEN
    RAISE EXCEPTION 'Admin profiles still exist. Delete those accounts in Supabase Auth first, then re-run.';
  END IF;
END $$;

-- ============================================
-- 1. Internship groups
-- ============================================
CREATE TABLE IF NOT EXISTS internship_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advisor_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  term        TEXT,
  join_code   TEXT UNIQUE NOT NULL DEFAULT generate_random_code(6),
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No unique index on advisor_id. An advisor owns as many groups as they like,
-- one per term or course. This is the deliberate opposite of the dropped
-- institutions_admin_id_unique.
CREATE INDEX IF NOT EXISTS internship_groups_advisor_idx
  ON internship_groups(advisor_id);

CREATE TABLE IF NOT EXISTS group_memberships (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES internship_groups(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at    TIMESTAMPTZ
);

-- The ENTIRE "one active group per student, history preserved" rule lives
-- here. A plain unique index would forbid history; no index at all would let
-- two active memberships exist and NOTHING would visibly break — the student
-- would simply appear in two advisors' lists. Verification row 3 exists
-- specifically to prove this index is present and correct.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_group_per_student
  ON group_memberships(student_id) WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS group_memberships_group_idx
  ON group_memberships(group_id) WHERE left_at IS NULL;

-- ============================================
-- 2. RLS
-- ============================================
ALTER TABLE internship_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "group owner and members read" ON internship_groups;
CREATE POLICY "group owner and members read" ON internship_groups
  FOR SELECT TO authenticated USING (
    advisor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM group_memberships m
      WHERE m.group_id = internship_groups.id
        AND m.student_id = auth.uid()
        AND m.left_at IS NULL
    )
  );

DROP POLICY IF EXISTS "advisor creates own group" ON internship_groups;
CREATE POLICY "advisor creates own group" ON internship_groups
  FOR INSERT TO authenticated WITH CHECK (
    advisor_id = auth.uid()
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'advisor')
  );

DROP POLICY IF EXISTS "advisor updates own group" ON internship_groups;
CREATE POLICY "advisor updates own group" ON internship_groups
  FOR UPDATE TO authenticated USING (advisor_id = auth.uid());

-- No DELETE policy. Archiving (is_archived) is the retirement mechanism;
-- deleting a group would cascade its memberships away and orphan the term's
-- history, which is the one thing the membership table exists to keep.

-- No INSERT policy on group_memberships: join_group_by_code is the only write
-- path. It is SECURITY DEFINER and runs as the table owner, so it writes
-- regardless. A direct INSERT would let a client join any group by guessing a
-- UUID, skipping the archived-group check entirely.
DROP POLICY IF EXISTS "membership insert" ON group_memberships;

DROP POLICY IF EXISTS "membership read" ON group_memberships;
CREATE POLICY "membership read" ON group_memberships
  FOR SELECT TO authenticated USING (
    student_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM internship_groups g
      WHERE g.id = group_memberships.group_id AND g.advisor_id = auth.uid()
    )
  );

-- The advisor closes a membership by setting left_at. Never a delete: the
-- student's logs and their term history hang off this row.
DROP POLICY IF EXISTS "advisor closes membership" ON group_memberships;
CREATE POLICY "advisor closes membership" ON group_memberships
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM internship_groups g
      WHERE g.id = group_memberships.group_id AND g.advisor_id = auth.uid()
    )
  );

-- ============================================
-- 3. Polls move from institution scope to group scope
-- ============================================
-- The "Users can view active polls" policy reads polls.institution_id
-- (docs/phase5-polls-realtime-migration.sql:192-213). Postgres records a hard
-- dependency from a policy's qual to the columns it names, so DROP COLUMN
-- without CASCADE fails with 2BP01 and halts the script. Drop the policy
-- first, then recreate it group-scoped.
--
-- The index idx_polls_institution also reads the column, but an index is
-- dropped automatically with its column and does not need handling.
DROP POLICY IF EXISTS "Users can view active polls" ON polls;

ALTER TABLE polls DROP COLUMN IF EXISTS institution_id;
ALTER TABLE polls
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES internship_groups(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_polls_group ON polls(group_id);

-- Same shape as the policy it replaces: active, role-targeted, and scoped.
-- Only the scope clause changes. A poll with no group_id is unscoped and
-- visible to everyone whose role matches, which is how mentors — who belong
-- to no group — still see polls at all.
CREATE POLICY "Users can view active polls"
  ON polls FOR SELECT
  USING (
    is_active = TRUE
    AND (
      target_role = 'all'
      OR EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = polls.target_role
      )
    )
    AND (
      polls.group_id IS NULL
      OR EXISTS (
        SELECT 1 FROM group_memberships m
        WHERE m.student_id = auth.uid()
          AND m.left_at IS NULL
          AND m.group_id = polls.group_id
      )
      OR EXISTS (
        SELECT 1 FROM internship_groups g
        WHERE g.id = polls.group_id
          AND g.advisor_id = auth.uid()
      )
    )
  );

-- ============================================
-- 4. Leaderboard drops its free-text university scoping
-- ============================================
-- The columns were copied from student_profiles and matched as strings, so a
-- student who typed "BTU" never appeared alongside one who typed "Bursa
-- Teknik Universitesi". Group scoping replaces them (get_my_group_leaderboard
-- in docs/internship-groups-rpcs.sql). Replace the sync function BEFORE
-- dropping the columns it writes.
CREATE OR REPLACE FUNCTION sync_leaderboard_public_from_student()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO leaderboard_public (
    id, total_xp, current_level, current_streak,
    first_name, last_name, avatar_url, updated_at
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
    total_xp       = EXCLUDED.total_xp,
    current_level  = EXCLUDED.current_level,
    current_streak = EXCLUDED.current_streak,
    first_name     = EXCLUDED.first_name,
    last_name      = EXCLUDED.last_name,
    avatar_url     = EXCLUDED.avatar_url,
    updated_at     = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TABLE leaderboard_public DROP COLUMN IF EXISTS university;
ALTER TABLE leaderboard_public DROP COLUMN IF EXISTS faculty;
ALTER TABLE leaderboard_public DROP COLUMN IF EXISTS department;

-- ============================================
-- 5. Retire the institution hierarchy
-- ============================================
-- The profiles_select policy (docs/admin-migration.sql:433-439) calls
-- is_admin_of_institution(id). Postgres records a hard dependency from a
-- policy's qual to the functions it calls, so DROP FUNCTION without CASCADE
-- fails and halts the whole script before the table drops. Replace the policy
-- first, minus the admin disjunct — there are no admins any more.
--
-- Mirrors is_advisor_of, but keyed on group membership rather than
-- student_profiles.advisor_id. student_profiles has NOT NULL columns and its
-- row only appears once the student completes the internship form, so
-- advisor_id is still unset for a student who has just joined a group.
CREATE OR REPLACE FUNCTION is_group_advisor_of(target UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_memberships m
    JOIN internship_groups g ON g.id = m.group_id
    WHERE m.student_id = target
      AND m.left_at IS NULL
      AND g.advisor_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (
    auth.uid() = id
    OR is_mentor_of(id)
    OR is_advisor_of(id)
    OR is_group_advisor_of(id)
  );

-- These two read profiles.institution_id and join institutions/departments,
-- so they break the moment the columns below are dropped. Dropping rather
-- than leaving them broken also lets docs/internship-groups-rpcs.sql recreate
-- get_my_student_code with a one-column result: CREATE OR REPLACE cannot
-- change a function's return type, so it MUST be dropped first.
DROP FUNCTION IF EXISTS get_my_student_code();
DROP FUNCTION IF EXISTS link_student_by_code(TEXT, TEXT);

DROP FUNCTION IF EXISTS report_join_issue(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS join_institution_by_code(TEXT);
DROP FUNCTION IF EXISTS validate_institution_code(TEXT);
DROP FUNCTION IF EXISTS join_department_by_code(TEXT);
DROP FUNCTION IF EXISTS validate_department_code(TEXT);
DROP FUNCTION IF EXISTS regenerate_institution_code(UUID);
DROP FUNCTION IF EXISTS is_admin_of_institution(UUID);
DROP FUNCTION IF EXISTS is_admin();

ALTER TABLE profiles DROP COLUMN IF EXISTS institution_id;
ALTER TABLE profiles DROP COLUMN IF EXISTS department_id;

DROP TABLE IF EXISTS join_issue_reports;
DROP TABLE IF EXISTS admin_profiles;
DROP TABLE IF EXISTS departments;
DROP TABLE IF EXISTS institutions;

-- Only now, with no admin rows and no admin-only objects left.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('student', 'mentor', 'advisor'));
